import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Vereinsgeburtstag im Web (S13 #644, B1–B3): Konfetti nur aus der Torte (kein Regen) und nur mit Bewegung; die Karte
// einmal am Tag, die Kerzen gehen nacheinander an, dann fliegt Konfetti - bei „dezent“ brennen sie gleich und es fliegt
// nichts. Die Wimpelketten hängen so tief wie möglich, aber nie über Inhalt; ohne Platz bleiben sie weg. Mitglieder
// holen sich den Jahres-Sticker, andere sehen dafür nichts.

const contextState = { reducedMotion: false, seasons: [] };
const burst = vi.fn();
const space = { free: () => true };
const authState = { user: null };
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("../SeasonContext", () => ({ useSeason: () => contextState }));
vi.mock("../carnival/layer", async (importOriginal) => ({ ...(await importOriginal()), requestBurst: (...args) => burst(...args) }));
vi.mock("../space", () => ({ openSpot: (_doc, x, y) => space.free(x, y) }));
vi.mock("@/components/tls/Logo", () => ({ MascotBadge: () => <img alt="Maskottchen" data-testid="mascot" /> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (url) => url }));

const { Corners, StickerClaimForTest, Toast, cardText, season, skyLayers, yearsOf } = await import("./index.jsx").then(async (module) => ({ ...module, StickerClaimForTest: (await import("./StickerClaim")).StickerClaim }));
const { CARD_DELAY_MS, IGNITE_DELAY_MS, IGNITE_STEP_MS } = await import("./index.jsx");

function birthday(overrides = {}) {
  return { key: "club_birthday", label: "Vereinsgeburtstag", phase: "feier", intensity: "normal", effective: "normal", texts: { greeting: "8 Jahre THE LION SQUAD – danke, dass ihr dabei seid" }, starts_at: "2027-03-01T00:00:00+01:00", ends_at: "2027-03-01T23:59:59+01:00", data: { years: 8, founded_on: "2019-03-01" }, ...overrides };
}

beforeEach(() => {
  contextState.reducedMotion = false;
  burst.mockReset();
  space.free = () => true;
  authState.user = null;
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

test("das Modul: Ecken, Karte und Konfetti-Ebene - Konfetti nur mit Bewegung und Budget, ohne Regen", () => {
  expect(season.key).toBe("club_birthday");
  expect(Object.keys(season).sort()).toEqual(["Corners", "Toast", "key", "skyLayers"]);
  expect(skyLayers({ season: birthday({ effective: "subtle" }), budget: 120 })).toEqual([]);
  expect(skyLayers({ season: birthday(), budget: 120, reducedMotion: true })).toEqual([]);
  expect(skyLayers({ season: birthday(), budget: 0 })).toEqual([]);
  const [layer] = skyLayers({ season: birthday(), budget: 120 });
  expect(layer.kind).toBe("confetti");
  expect(layer.snapshot().flying).toBe(0);
  layer.dispose();
  expect(yearsOf(birthday())).toBe(8);
  expect(yearsOf(birthday({ data: {} }))).toBeNull();
});

test("der Text unter „8 Jahre“: der Gruß ohne die Wiederholung - ein eigener Text bleibt ganz", () => {
  expect(cardText("8 Jahre THE LION SQUAD – danke, dass ihr dabei seid", 8)).toBe("Danke, dass ihr dabei seid");
  expect(cardText("1 Jahr THE LION SQUAD - danke!", 1)).toBe("Danke!");
  expect(cardText("Heute feiern wir!", 8)).toBe("Heute feiern wir!");
  expect(cardText("8 Jahre THE LION SQUAD", 8)).toBe("8 Jahre THE LION SQUAD");
  expect(cardText("Danke!", null)).toBe("Danke!");
});

test("die Karte einmal am Tag: Kerzen nacheinander an, dann Konfetti aus der Torte", async () => {
  vi.useFakeTimers();
  const first = render(<Toast season={birthday()} />);
  expect(screen.queryByTestId("birthday-card")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(CARD_DELAY_MS);
  });
  expect(screen.getByTestId("birthday-card")).toHaveTextContent("8 Jahre");
  expect(screen.getByTestId("birthday-card")).toHaveTextContent("Danke, dass ihr dabei seid");
  expect(screen.getAllByTestId("birthday-candle")).toHaveLength(8);
  expect(screen.getAllByTestId("birthday-candle").filter((candle) => candle.dataset.lit === "1")).toHaveLength(0);
  await act(async () => {
    vi.advanceTimersByTime(IGNITE_DELAY_MS + IGNITE_STEP_MS * 2 + 10);
  });
  expect(screen.getAllByTestId("birthday-candle").filter((candle) => candle.dataset.lit === "1")).toHaveLength(3);
  expect(burst).not.toHaveBeenCalled();
  await act(async () => {
    vi.advanceTimersByTime(IGNITE_STEP_MS * 6 + 600);
  });
  expect(screen.getAllByTestId("birthday-candle").filter((candle) => candle.dataset.lit === "1")).toHaveLength(8);
  expect(burst).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("mascot")).toBeTruthy();
  first.unmount();
  render(<Toast season={birthday()} />);
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.queryByTestId("birthday-card")).toBeNull();
});

test("„dezent“: die Kerzen brennen gleich, kein Konfetti", async () => {
  vi.useFakeTimers();
  render(<Toast season={birthday({ effective: "subtle" })} />);
  await act(async () => {
    vi.advanceTimersByTime(CARD_DELAY_MS);
  });
  expect(screen.getAllByTestId("birthday-candle").every((candle) => candle.dataset.lit === "1")).toBe(true);
  await act(async () => {
    vi.advanceTimersByTime(8000);
  });
  expect(burst).not.toHaveBeenCalled();
});

/** Kopfzeile und Spalte des Inhalts, wie die Probe sie misst. */
function header(width = 390) {
  const node = document.createElement("header");
  const column = document.createElement("div");
  node.append(column);
  document.body.append(node);
  node.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: 64, width, height: 64 });
  column.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: 64, width, height: 64 });
  Object.defineProperty(document.documentElement, "clientWidth", { value: width, configurable: true });
}

test("Wimpelketten: so tief wie möglich - darunter Inhalt heißt flacher, gar kein Platz heißt keine", async () => {
  vi.useFakeTimers();
  header();
  const view = render(<MemoryRouter><Corners season={birthday()} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.getAllByTestId("birthday-garland")).toHaveLength(2);
  const deep = Number(screen.getAllByTestId("birthday-garland")[0].getAttribute("height"));
  view.unmount();

  // Ab 100 px liegt Inhalt: die Ketten hängen flacher.
  space.free = (_x, y) => y < 100;
  const flatter = render(<MemoryRouter><Corners season={birthday()} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  const shallow = Number(screen.getAllByTestId("birthday-garland")[0].getAttribute("height"));
  expect(shallow).toBeLessThan(deep);
  flatter.unmount();

  space.free = () => false;
  render(<MemoryRouter><Corners season={birthday()} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.queryAllByTestId("birthday-garland")).toHaveLength(0);
});

test("„dezent“: die Ketten hängen still - ohne Entfalten und ohne Wehen", async () => {
  vi.useFakeTimers();
  header();
  render(<MemoryRouter><Corners season={birthday({ effective: "subtle" })} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  screen.getAllByTestId("birthday-garland").forEach((garland) => {
    expect(garland.getAttribute("class")).not.toContain("tls-garland--sway");
    expect(garland.getAttribute("class")).not.toContain("tls-garland--unfold");
  });
});

test("der Jahres-Sticker: Gäste und Nicht-Mitglieder sehen nichts, Mitglieder holen ihn ab", async () => {
  const sticker = { id: "fluent-birthday-cake", name: "Geburtstagstorte", pack_name: "Zum Vereinsgeburtstag", url: "/api/stickers/files/fluent/birthday-cake.png" };
  const guest = render(<StickerClaimForTest />);
  expect(guest.container.innerHTML).toBe("");
  expect(apiMock.get).not.toHaveBeenCalled();
  guest.unmount();

  authState.user = { id: "u1", is_club_member: false };
  apiMock.get.mockResolvedValue({ data: { active: true, member: false, claimed: false, sticker: null } });
  const outsider = render(<StickerClaimForTest />);
  await act(async () => {});
  expect(outsider.container.innerHTML).toBe("");
  outsider.unmount();

  authState.user = { id: "u2", is_club_member: true };
  apiMock.get.mockResolvedValue({ data: { active: true, member: true, claimed: false, sticker: null } });
  apiMock.post.mockResolvedValue({ data: { new: true, sticker } });
  render(<StickerClaimForTest />);
  const button = await screen.findByTestId("birthday-sticker-claim");
  await act(async () => {
    fireEvent.click(button);
  });
  expect(apiMock.post).toHaveBeenCalledWith("/seasonal/birthday/sticker", null, undefined);
  const shown = screen.getByTestId("birthday-sticker");
  expect(shown).toHaveTextContent("Dein Jahres-Sticker!");
  expect(shown).toHaveTextContent("Zum Vereinsgeburtstag");
  expect(shown.querySelector("img").getAttribute("alt")).toBe("Geburtstagstorte");
});

test("in der Vorschau fragt der Baustein mit dem Token - nur für den Vereinsgeburtstag", async () => {
  sessionStorage.setItem("tls-season-preview", JSON.stringify({ token: "club_birthday.123.0.sig", expires: Date.now() + 60000 }));
  authState.user = { id: "u3", is_club_member: true };
  apiMock.get.mockResolvedValue({ data: { active: true, member: true, claimed: false, sticker: null, preview: true } });
  render(<StickerClaimForTest />);
  await screen.findByTestId("birthday-sticker-claim");
  expect(apiMock.get).toHaveBeenCalledWith("/seasonal/birthday", { params: { preview: "club_birthday.123.0.sig" } });
});
