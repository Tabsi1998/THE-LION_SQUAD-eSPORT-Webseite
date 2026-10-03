import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Die Eier einer Seite (#646): Knöpfe „Osterei einsammeln“ in den Ecken echter Karten; Gäste werden zum Anmelden
// eingeladen, angemeldet zählt der Fund (Ansage für Screenreader, das Ei verschwindet); zu schnell und abgelaufene
// Schlüssel werden freundlich behandelt.

const apiMock = { fetchEggs: vi.fn(), findEgg: vi.fn(), emitHuntProgress: vi.fn() };
vi.mock("./api", () => ({
  fetchEggs: (...args) => apiMock.fetchEggs(...args),
  findEgg: (...args) => apiMock.findEgg(...args),
  emitHuntProgress: (...args) => apiMock.emitHuntProgress(...args),
}));
const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
const seasonState = { preview: false };
vi.mock("../SeasonContext", () => ({ useSeason: () => seasonState }));
const motion = { reduced: true };
vi.mock("@/hooks/useLiveChanges", () => ({ useReducedMotion: () => motion.reduced }));

const { EasterEggs, eggsNear, fitNote, personality } = await import("./EasterEggs");

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

function mountPage() {
  const main = document.createElement("main");
  main.innerHTML = `<a id="card" data-season-anchor="card">Karte</a><footer id="foot"></footer>`;
  document.body.appendChild(main);
  box(document.getElementById("card"), { left: 40, right: 400, top: 100, bottom: 300 });
  box(document.getElementById("foot"), { left: 0, right: 1200, top: 600, bottom: 760 });
}

const EGGS = { active: true, total: 3, guest: false, eggs: [
  { egg_no: 1, token: "1.999.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", spot: { kind: "card", index: 0, place: "bottom-right" }, pattern: "dots", found: false },
  { egg_no: 2, token: "2.999.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", spot: { kind: "card", index: 0, place: "top-left" }, pattern: "lion", found: true },
] };

function renderEggs() {
  return render(<MemoryRouter initialEntries={["/news"]}><EasterEggs season={{ key: "easter_hunt" }} /></MemoryRouter>);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  apiMock.fetchEggs.mockReset();
  apiMock.findEgg.mockReset();
  apiMock.emitHuntProgress.mockReset();
  apiMock.fetchEggs.mockResolvedValue(EGGS);
  authState.user = null;
  motion.reduced = true;
  seasonState.preview = false;
  sessionStorage.clear();
  mountPage();
});

afterEach(() => {
  // Erst React abbauen (die Eier hängen als Portal am Körper), dann die Seite leeren.
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
}

test("je Ei fest: Neigung und Gemüt - ruhig, neugierig oder lebhaft", () => {
  expect(personality({ egg_no: 3, pattern: "dots" })).toEqual(personality({ egg_no: 3, pattern: "dots" }));
  expect(personality({ egg_no: 3, pattern: "dots" })).toMatchObject({ lively: true, curious: false });
  expect(personality({ egg_no: 4, pattern: "dots" })).toMatchObject({ lively: false, curious: true });
  expect(personality({ egg_no: 5, pattern: "dots" })).toMatchObject({ lively: false, curious: false });
  expect(Math.abs(personality({ egg_no: 1, pattern: "dots" }).tilt)).toBeLessThanOrEqual(8);
  const placed = { 1: { x: 100, y: 100 }, 4: { x: 400, y: 100 }, 3: { x: 110, y: 110 } };
  const eggs = [{ egg_no: 1 }, { egg_no: 3 }, { egg_no: 4 }];
  expect(eggsNear({ x: 150, y: 120 }, eggs, placed)).toEqual([1]);
});

test("Nähe: kommt die Maus an ein neugieriges Ei, wackelt es kurz - bei „Bewegung reduzieren“ nie", async () => {
  motion.reduced = false;
  window.matchMedia = (query) => ({ matches: query === "(pointer: fine)", media: query, addEventListener() {}, removeEventListener() {} });
  try {
    renderEggs();
    await settle();
    const egg = await screen.findByTestId("easter-egg-1");
    act(() => { window.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 360, clientY: 260 })); });
    expect(egg).toHaveClass("tls-egg--near");
    await settle();
    expect(egg).not.toHaveClass("tls-egg--near");
  } finally {
    delete window.matchMedia;
  }
});

test("der Hinweis bleibt im Fenster und weicht unter die Kopfzeile aus", () => {
  // Mittig über dem Ei, wo Platz ist; am Rand bündig 8 px innen; oben unter der Kopfzeile: darunter.
  expect(fitNote({ x: 200, y: 400, width: 120, height: 30 }, { clientWidth: 400, headerBottom: 64 })).toEqual({ left: 140, below: false });
  expect(fitNote({ x: 380, y: 400, width: 260, height: 30 }, { clientWidth: 400, headerBottom: 64 })).toEqual({ left: 132, below: false });
  expect(fitNote({ x: 20, y: 400, width: 260, height: 30 }, { clientWidth: 400, headerBottom: 64 })).toEqual({ left: 8, below: false });
  expect(fitNote({ x: 200, y: 110, width: 120, height: 30 }, { clientWidth: 400, headerBottom: 64 })).toEqual({ left: 140, below: true });
});

test("nur ungefundene Eier der Seite, als Knopf in der Ecke der Karte", async () => {
  renderEggs();
  await settle();
  expect(apiMock.fetchEggs).toHaveBeenCalledWith("/news", null);
  const egg = await screen.findByTestId("easter-egg-1");
  expect(egg).toHaveAttribute("aria-label", "Osterei einsammeln");
  expect(egg.style.left).toBe(`${400 - 6 - 15}px`);
  // Der gezeichnete Kasten (30 × 38, um 55 % angehoben) liegt 6 px innen in der Ecke.
  expect(egg.style.top).toBe(`${Math.round(300 - 6 - 38 * 0.45)}px`);
  expect(screen.queryByTestId("easter-egg-2")).toBeNull();
});

test("Gäste werden zum Anmelden eingeladen - gezählt wird nichts", async () => {
  renderEggs();
  await settle();
  fireEvent.click(await screen.findByTestId("easter-egg-1"));
  const note = await screen.findByTestId("easter-egg-note");
  expect(note).toHaveTextContent("Anmelden, um Eier zu sammeln");
  expect(note.querySelector("a")).toHaveAttribute("href", "/login?next=%2Fnews");
  expect(apiMock.findEgg).not.toHaveBeenCalled();
});

test("angemeldet zählt der Fund: Ansage, Stand für das Widget, das Ei verschwindet", async () => {
  authState.user = { id: "u1" };
  apiMock.findEgg.mockResolvedValue({ found: 2, total: 3, already: false, completed_now: false, rank: null, egg: { egg_no: 1 } });
  renderEggs();
  await settle();
  fireEvent.click(await screen.findByTestId("easter-egg-1"));
  await waitFor(() => expect(apiMock.findEgg).toHaveBeenCalledWith(EGGS.eggs[0].token));
  expect(await screen.findByTestId("easter-eggs-live")).toHaveTextContent("Osterei gefunden: 2 von 3.");
  expect(apiMock.emitHuntProgress).toHaveBeenCalledWith(expect.objectContaining({ found: 2, total: 3, active: true }));
  await settle();
  expect(screen.queryByTestId("easter-egg-1")).toBeNull();
});

test("voller Korb: Platz und Weg zum Korb", async () => {
  authState.user = { id: "u1" };
  apiMock.findEgg.mockResolvedValue({ found: 3, total: 3, already: false, completed_now: true, rank: 2, egg: { egg_no: 1 } });
  renderEggs();
  await settle();
  fireEvent.click(await screen.findByTestId("easter-egg-1"));
  expect(await screen.findByTestId("easter-eggs-live")).toHaveTextContent("dein Korb ist voll, Platz 2");
  // Das Ei ist weg, der Hinweis mit dem Weg zum Korb bleibt, bis man ihn schließt.
  await settle();
  await settle();
  await settle();
  expect(screen.queryByTestId("easter-egg-1")).toBeNull();
  expect(screen.getByTestId("easter-egg-note").querySelector("a")).toHaveAttribute("href", "/ostern");
  fireEvent.click(screen.getByRole("button", { name: "Hinweis schließen" }));
  expect(screen.queryByTestId("easter-egg-note")).toBeNull();
});

test("zu schnell: freundlicher Hinweis; abgelaufener Schlüssel: neu holen und einmal nachfassen", async () => {
  authState.user = { id: "u1" };
  apiMock.findEgg.mockRejectedValueOnce({ response: { status: 429 } });
  renderEggs();
  await settle();
  fireEvent.click(await screen.findByTestId("easter-egg-1"));
  expect(await screen.findByTestId("easter-egg-note")).toHaveTextContent("Langsam – ein Ei nach dem anderen.");

  const fresh = { ...EGGS, eggs: [{ ...EGGS.eggs[0], token: "1.1000.cccccccccccccccccccccccccccccccc" }] };
  apiMock.fetchEggs.mockResolvedValueOnce(fresh);
  apiMock.findEgg.mockRejectedValueOnce({ response: { status: 410 } }).mockResolvedValueOnce({ found: 1, total: 3, already: false, completed_now: false });
  fireEvent.click(screen.getByTestId("easter-egg-1"));
  await waitFor(() => expect(apiMock.findEgg).toHaveBeenLastCalledWith("1.1000.cccccccccccccccccccccccccccccccc"));
});

test("Vorschau aus dem Admin: mit dem Token geladen, antippen zeigt Nummer und Hinweis - gezählt wird nichts", async () => {
  seasonState.preview = true;
  sessionStorage.setItem("tls-season-preview", JSON.stringify({ token: "easter_hunt.9999999999..sig", expires: Date.now() + 60000 }));
  authState.user = { id: "u1" };
  apiMock.fetchEggs.mockResolvedValue({ active: true, preview: true, total: 3, eggs: [{ ...EGGS.eggs[0], token: "", hint: "Schau bei den News." }] });
  renderEggs();
  await settle();
  expect(apiMock.fetchEggs).toHaveBeenCalledWith("/news", "easter_hunt.9999999999..sig");
  fireEvent.click(await screen.findByTestId("easter-egg-1"));
  expect(await screen.findByTestId("easter-egg-note")).toHaveTextContent("Vorschau: Ei 1 – Schau bei den News.");
  expect(apiMock.findEgg).not.toHaveBeenCalled();
});

test("läuft die Suche nicht, liegt nichts", async () => {
  apiMock.fetchEggs.mockResolvedValue({ active: false, eggs: [] });
  renderEggs();
  await settle();
  expect(screen.queryByTestId("easter-eggs")).toBeNull();
});
