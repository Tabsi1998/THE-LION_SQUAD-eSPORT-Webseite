import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Nikolaus im Web (X3, #736): der Stiefel auf der Linie über dem Impressum; ein Klick wackelt, der Gutschein steigt,
// dann die Karte mit dem Sticker vom Server - danach steht der Stiefel benutzt da. Ohne Anmeldung der Weg zum Login,
// am falschen Tag „kommt am 6. Dezember“, bei „dezent“ ohne Wackeln. Der Hinweis „Zum Stiefel“ einmal am Tag, nicht
// für wen, der schon geöffnet hat. Im Footer-Platz bleibt der Stiefel für Screenreader sichtbar.

const apiMock = { get: vi.fn(), post: vi.fn() };
const authState = { user: null };
const seasonState = { ready: true, seasons: [], preview: false, scaresAllowed: false };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (url) => url }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("../SeasonContext", () => ({ useSeason: () => seasonState }));

const { BOOT_ID, Footer, HINT_DELAY_MS, HINT_MS, Toast, loadBootState, resetBootState, season } = await import("./index.jsx");
const { CARD_MS, OPEN_MS } = await import("./boot");
const { SeasonFooterSlot } = await import("../SeasonSlots");

const STICKER = { id: "fluent-ogre", pack_id: "fluent-nikolaus", pack_name: "Vom Nikolaus", name: "Krampus", url: "/api/stickers/files/fluent/ogre.png", width: 256, height: 256 };

function niko(overrides = {}) {
  return { key: "nikolaus", label: "Nikolaus", phase: "stiefel", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: { greeting: "Der Nikolaus war da" }, starts_at: "2026-12-06T00:00:00+01:00", ends_at: "2026-12-06T23:59:59+01:00", forced: false, data: {}, ...overrides };
}

function renderFooter(seasonOverrides = {}) {
  return render(<MemoryRouter><Footer season={niko(seasonOverrides)} /></MemoryRouter>);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  resetBootState();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  authState.user = null;
  seasonState.seasons = [];
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll("footer").forEach((node) => node.remove());
});

test("das Modul: Stiefel im Footer, Hinweis als Gruß, der Footer-Platz versteckt ihn nicht", () => {
  expect(season.key).toBe("nikolaus");
  expect(season.Footer).toBe(Footer);
  expect(season.Toast).toBe(Toast);
  expect(season.footerAccessible).toBe(true);
});

test("angemeldet: Klick wackelt, der Gutschein steigt, dann die Karte mit dem neuen Sticker - danach benutzt", async () => {
  vi.useFakeTimers();
  authState.user = { id: "u1" };
  apiMock.get.mockResolvedValue({ data: { active: true, year: 2026, opened: false, sticker: null } });
  apiMock.post.mockResolvedValue({ data: { year: 2026, new: true, sticker: STICKER } });
  renderFooter();
  await flush();
  expect(apiMock.get).toHaveBeenCalledWith("/seasonal/nikolaus", undefined);
  const boot = screen.getByTestId("nikolaus-boot");
  expect(boot.id).toBe(BOOT_ID);
  expect(boot.getAttribute("aria-label")).toBe("Nikolausstiefel öffnen");
  expect(screen.getByTestId("nikolaus-voucher")).toBeTruthy();
  await act(async () => {
    fireEvent.click(boot);
  });
  expect(apiMock.post).toHaveBeenCalledWith("/seasonal/nikolaus/open", null, undefined);
  expect(boot.className).toContain("tls-nikolaus-boot--opening");
  expect(screen.queryByTestId("nikolaus-card")).toBeNull();
  await advance(OPEN_MS);
  const card = screen.getByTestId("nikolaus-card");
  expect(card.dataset.kind).toBe("new");
  expect(card).toHaveTextContent("Krampus");
  expect(card).toHaveTextContent("Neu in deinen Stickern – im Chat unter „Vom Nikolaus“.");
  expect(screen.getByTestId("nikolaus-card-sticker").getAttribute("src")).toContain("/api/stickers/files/fluent/ogre.png");
  expect(boot.dataset.used).toBe("1");
  expect(screen.queryByTestId("nikolaus-voucher")).toBeNull();
  await advance(CARD_MS);
  expect(screen.queryByTestId("nikolaus-card")).toBeNull();
});

test("Vorschau im Admin: der Stiefel fragt mit dem Token, zeigt den Probe-Sticker und bleibt zu - beliebig oft", async () => {
  vi.useFakeTimers();
  authState.user = { id: "u1" };
  sessionStorage.setItem("tls-season-preview", JSON.stringify({ token: "nikolaus.9999999999..abc", expires: Date.now() + 60000 }));
  apiMock.get.mockResolvedValue({ data: { active: true, year: 2026, opened: false, sticker: null, preview: true } });
  apiMock.post.mockResolvedValue({ data: { year: 2026, new: true, sticker: STICKER, preview: true } });
  renderFooter();
  await flush();
  expect(apiMock.get).toHaveBeenCalledWith("/seasonal/nikolaus", { params: { preview: "nikolaus.9999999999..abc" } });
  const boot = screen.getByTestId("nikolaus-boot");
  await act(async () => {
    fireEvent.click(boot);
  });
  expect(apiMock.post).toHaveBeenCalledWith("/seasonal/nikolaus/open", null, { params: { preview: "nikolaus.9999999999..abc" } });
  await advance(OPEN_MS);
  const card = screen.getByTestId("nikolaus-card");
  expect(card.dataset.kind).toBe("preview");
  expect(card).toHaveTextContent("Vorschau – diesen Sticker bekämst du am 6. Dezember. Vergeben wird nichts.");
  expect(boot.dataset.used).not.toBe("1");
  sessionStorage.removeItem("tls-season-preview");
});

test("heuer schon geöffnet: der Stiefel steht benutzt da, ein Klick zeigt denselben Sticker noch einmal; × schließt", async () => {
  vi.useFakeTimers();
  authState.user = { id: "u1" };
  apiMock.get.mockResolvedValue({ data: { active: true, year: 2026, opened: true, sticker: STICKER } });
  apiMock.post.mockResolvedValue({ data: { year: 2026, new: false, sticker: STICKER } });
  renderFooter();
  await flush();
  const boot = screen.getByTestId("nikolaus-boot");
  expect(boot.dataset.used).toBe("1");
  expect(boot.getAttribute("aria-label")).toContain("schon geöffnet");
  expect(screen.queryByTestId("nikolaus-voucher")).toBeNull();
  await act(async () => {
    fireEvent.click(boot);
  });
  await advance(OPEN_MS);
  expect(screen.getByTestId("nikolaus-card").dataset.kind).toBe("again");
  expect(screen.getByTestId("nikolaus-card")).toHaveTextContent("Den hat dir der Nikolaus heuer gebracht");
  fireEvent.click(screen.getByTestId("nikolaus-card-close"));
  expect(screen.queryByTestId("nikolaus-card")).toBeNull();
});

test("ohne Anmeldung: kein Aufruf am Server, die Karte führt zum Login", async () => {
  vi.useFakeTimers();
  renderFooter();
  await flush();
  await act(async () => {
    fireEvent.click(screen.getByTestId("nikolaus-boot"));
  });
  await advance(OPEN_MS);
  expect(apiMock.get).not.toHaveBeenCalled();
  expect(apiMock.post).not.toHaveBeenCalled();
  expect(screen.getByTestId("nikolaus-card").dataset.kind).toBe("guest");
  expect(screen.getByTestId("nikolaus-card-login").getAttribute("href")).toBe("/login");
});

test("am falschen Tag (Vorschau) „kommt am 6. Dezember“, bei Netzfehlern „klemmt“ - der Stiefel bleibt voll", async () => {
  vi.useFakeTimers();
  authState.user = { id: "u1" };
  apiMock.get.mockResolvedValue({ data: { active: false, opened: false, sticker: null } });
  apiMock.post.mockRejectedValueOnce({ response: { status: 409 } }).mockRejectedValueOnce(new Error("offline"));
  renderFooter();
  await flush();
  const boot = screen.getByTestId("nikolaus-boot");
  await act(async () => {
    fireEvent.click(boot);
  });
  await advance(OPEN_MS);
  expect(screen.getByTestId("nikolaus-card").dataset.kind).toBe("closed");
  await act(async () => {
    fireEvent.click(boot);
  });
  await advance(OPEN_MS);
  expect(screen.getByTestId("nikolaus-card").dataset.kind).toBe("error");
  expect(boot.dataset.used).toBeUndefined();
});

test("„dezent“: kein Wackeln, die Karte steht gleich da; der Stiefel steht auf der Linie über dem Impressum", async () => {
  vi.useFakeTimers();
  const footer = document.createElement("footer");
  const line = document.createElement("div");
  line.setAttribute("data-season-line", "footer");
  Object.defineProperty(line, "offsetTop", { value: 412 });
  footer.appendChild(line);
  document.body.appendChild(footer);
  authState.user = { id: "u1" };
  apiMock.get.mockResolvedValue({ data: { active: true, year: 2026, opened: false, sticker: null } });
  apiMock.post.mockResolvedValue({ data: { year: 2026, new: true, sticker: STICKER } });
  renderFooter({ effective: "subtle" });
  await flush();
  expect(screen.getByTestId("nikolaus-scene").style.top).toBe("412px");
  const boot = screen.getByTestId("nikolaus-boot");
  expect(boot.className).toContain("tls-nikolaus-boot--still");
  await act(async () => {
    fireEvent.click(boot);
  });
  expect(boot.className).not.toContain("tls-nikolaus-boot--opening");
  await advance(0);
  expect(screen.getByTestId("nikolaus-card").dataset.kind).toBe("new");
});

test("Hinweis: einmal am Tag nach kurzer Zeit, „Zum Stiefel“ scrollt hin und gibt ihm den Fokus", async () => {
  vi.useFakeTimers();
  const boot = document.createElement("button");
  boot.id = BOOT_ID;
  boot.scrollIntoView = vi.fn();
  boot.focus = vi.fn();
  document.body.appendChild(boot);
  const view = render(<MemoryRouter><Toast season={niko()} now={new Date(2026, 11, 6, 9)} /></MemoryRouter>);
  await flush();
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
  await advance(HINT_DELAY_MS);
  const hint = screen.getByTestId("nikolaus-hint");
  expect(hint).toHaveTextContent("Der Nikolaus war da");
  expect(hint).toHaveTextContent("Wer angemeldet ist, findet darin einen Sticker.");
  fireEvent.click(screen.getByTestId("nikolaus-hint-go"));
  expect(boot.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  expect(boot.focus).toHaveBeenCalled();
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
  view.unmount();
  boot.remove();
  render(<MemoryRouter><Toast season={niko()} now={new Date(2026, 11, 6, 15)} /></MemoryRouter>);
  await flush();
  await advance(HINT_DELAY_MS + HINT_MS);
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
});

test("Hinweis nicht für wen, der heuer schon geöffnet hat; sonst nach zwölf Sekunden wieder weg", async () => {
  vi.useFakeTimers();
  authState.user = { id: "u1" };
  apiMock.get.mockResolvedValue({ data: { active: true, year: 2026, opened: true, sticker: STICKER } });
  const view = render(<MemoryRouter><Toast season={niko()} now={new Date(2026, 11, 6, 9)} /></MemoryRouter>);
  await flush();
  await advance(HINT_DELAY_MS);
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
  view.unmount();
  resetBootState();
  localStorage.clear();
  apiMock.get.mockResolvedValue({ data: { active: true, year: 2026, opened: false, sticker: null } });
  render(<MemoryRouter><Toast season={niko()} now={new Date(2026, 11, 6, 9)} /></MemoryRouter>);
  await flush();
  await advance(HINT_DELAY_MS);
  expect(screen.getByTestId("nikolaus-hint")).toHaveTextContent("Unten auf der Seite steht dein Stiefel");
  await advance(HINT_MS);
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
});

test("Footer und Hinweis fragen den Server einmal gemeinsam - je Person", async () => {
  apiMock.get.mockResolvedValue({ data: { active: true, opened: false } });
  await Promise.all([loadBootState("u1"), loadBootState("u1")]);
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  await loadBootState("u2");
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  expect(await loadBootState(null)).toBeNull();
});

test("im Footer-Platz bleibt der Stiefel für Screenreader sichtbar", async () => {
  seasonState.seasons = [niko()];
  render(<MemoryRouter><SeasonFooterSlot /></MemoryRouter>);
  expect(await screen.findByTestId("nikolaus-boot")).toBeTruthy();
  expect(screen.getByTestId("season-footer-slot").getAttribute("aria-hidden")).toBeNull();
});
