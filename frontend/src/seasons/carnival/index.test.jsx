import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Fasching im Web (S12, F1–F3): Konfetti nur mit Bewegung und Budget, der Regen einmal am Tag (in der Vorschau jedes
// Mal, ohne den Tag zu verbrauchen), der Hut wirft Konfetti höchstens alle zehn Sekunden und ist bei „dezent“ nur ein
// Bild, die Luftschlangen hängen nur, wo darunter nichts steht, der große Hut weicht der Schrift über dem Löwen aus.

const previewState = { token: null };
const burst = vi.fn();
vi.mock("../preview", async (importOriginal) => ({ ...(await importOriginal()), readPreviewToken: () => previewState.token }));
vi.mock("./layer", async (importOriginal) => ({ ...(await importOriginal()), requestBurst: (...args) => burst(...args) }));

const {
  Corners, HAT_COOLDOWN_MS, RAIN_KEY, STREAMER_GAP, Toast, firstTimeToday, openSpot, season, skyLayers, streamerLength, streamerX,
} = await import("./index.jsx");

function carnival(overrides = {}) {
  return { key: "carnival", label: "Fasching", phase: "deko", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: { greeting: "Schönen Fasching" }, starts_at: "2027-02-09T00:00:00+01:00", ends_at: "2027-02-09T23:59:59+01:00", forced: false, data: {}, ...overrides };
}

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
}

beforeEach(() => {
  previewState.token = null;
  burst.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  // Erst React abbauen (die Portale hängen am body), dann die Bühne leeren.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

test("das Modul: Ecken, Gruß und Konfetti-Ebene", () => {
  expect(season.key).toBe("carnival");
  expect(Object.keys(season).sort()).toEqual(["Corners", "Toast", "key", "skyLayers"]);
});

test("Konfetti nur mit Bewegung und Budget; der Regen einmal am Tag", () => {
  expect(skyLayers({ season: carnival({ effective: "subtle" }), budget: 120 })).toEqual([]);
  expect(skyLayers({ season: carnival(), budget: 120, reducedMotion: true })).toEqual([]);
  expect(skyLayers({ season: carnival(), budget: 0 })).toEqual([]);
  const [first] = skyLayers({ season: carnival(), budget: 120 });
  expect(first.kind).toBe("confetti");
  expect(first.snapshot().flying).toBe(150);
  const [second] = skyLayers({ season: carnival(), budget: 120 });
  expect(second.snapshot().flying).toBe(0);
  expect(second.idle()).toBe(true);
  first.dispose();
  second.dispose();
});

test("einmal am Tag je Gerät - am nächsten Tag wieder; in der Vorschau jedes Mal, ohne den Tag zu verbrauchen", () => {
  const storage = memoryStorage();
  const tuesday = new Date(2027, 1, 9, 10, 0);
  expect(firstTimeToday(RAIN_KEY, storage, tuesday)).toBe(true);
  expect(firstTimeToday(RAIN_KEY, storage, new Date(2027, 1, 9, 23, 59))).toBe(false);
  expect(firstTimeToday(RAIN_KEY, storage, new Date(2027, 1, 10, 0, 1))).toBe(true);
  previewState.token = "carnival.123.0.sig";
  const fresh = memoryStorage();
  expect(firstTimeToday(RAIN_KEY, fresh, tuesday)).toBe(true);
  expect(firstTimeToday(RAIN_KEY, fresh, tuesday)).toBe(true);
  expect(fresh.getItem(RAIN_KEY)).toBeNull();
  // Ohne Speicher (privates Fenster): lieber einmal zu oft als nie.
  expect(firstTimeToday(RAIN_KEY, { getItem: () => { throw new Error("blocked"); } }, tuesday)).toBe(true);
});

test("Luftschlangen: so lang, wie über die ganze Breite nichts im Weg ist - mit Luft darunter; zu kurz = keine", () => {
  const streamer = { length: 120, curl: 8 };
  expect(streamerLength(streamer, 20, 80, () => true)).toBe(120);
  // Ab 70 px unter dem Kopf steht etwas: Ende mit Abstand davor.
  const blockedFrom = (limit) => (_x, y) => y - 80 < limit;
  const length = streamerLength(streamer, 20, 80, blockedFrom(70));
  expect(length).toBeLessThanOrEqual(70 - STREAMER_GAP);
  expect(length).toBeGreaterThanOrEqual(70 - STREAMER_GAP - 6);
  expect(streamerLength(streamer, 20, 80, blockedFrom(30))).toBe(0);
  // Auch neben der Mitte: rechts im Ausschlag liegt etwas, in der Mitte nicht.
  const sideBlocked = (x, y) => !(x > 32 + 4 && y - 80 > 50);
  expect(streamerLength(streamer, 20, 80, sideBlocked)).toBeLessThan(60);
});

test("Luftschlangen am Fensterrand - auf breiten Schirmen außen an der Spalte des Inhalts", () => {
  const left = { side: "left", offset: 20 };
  const right = { side: "right", offset: 20 };
  expect(streamerX(left, 1440, { left: 80, right: 1360 })).toBe(20);
  expect(streamerX(right, 1440, { left: 80, right: 1360 })).toBe(1440 - 20 - 24);
  expect(streamerX(left, 2560, { left: 640, right: 1920 })).toBe(640 - 20 - 24);
  expect(streamerX(right, 2560, { left: 640, right: 1920 })).toBe(1920 + 20);
  expect(streamerX(left, 390, null)).toBe(20);
});

test("frei für eine Luftschlange: nur, wo eine seitenbreite Fläche liegt - kein Chip, keine Karte", () => {
  const section = document.createElement("section");
  const chip = document.createElement("div");
  document.body.append(section, chip);
  section.getBoundingClientRect = () => ({ width: 1300, left: 0, right: 1300, top: 0, bottom: 600 });
  chip.getBoundingClientRect = () => ({ width: 240, left: 16, right: 256, top: 140, bottom: 170 });
  document.elementFromPoint = (x, y) => (y > 140 && y < 170 && x < 256 ? chip : section);
  expect(openSpot(document, 30, 100, 1440)).toBe(true);
  expect(openSpot(document, 30, 150, 1440)).toBe(false);
  delete document.elementFromPoint;
});

/** Kopf mit Logo und der große Löwe, beide „geladen“ und vermessen. */
function stage() {
  const header = document.createElement("header");
  const column = document.createElement("div");
  const logo = document.createElement("img");
  logo.dataset.testid = "tls-logo";
  column.append(logo);
  header.append(column);
  const anchor = document.createElement("div");
  anchor.dataset.seasonAnchor = "lion";
  const lion = document.createElement("img");
  anchor.append(lion);
  document.body.append(header, anchor);
  const loaded = (img, rect) => {
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: rect.width * 2 });
    Object.defineProperty(img, "naturalHeight", { value: rect.height * 2 });
    img.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  };
  loaded(logo, { left: 40, top: 16, width: 160, height: 48 });
  loaded(lion, { left: 1000, top: 220, width: 220, height: 260 });
  header.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1440, height: 80, right: 1440, bottom: 80 });
  column.getBoundingClientRect = () => ({ left: 80, top: 0, width: 1280, height: 80, right: 1360, bottom: 80 });
}

test("Hüte im Kopf und auf dem Löwen; Antippen wirft Konfetti und wippt - höchstens alle zehn Sekunden", () => {
  stage();
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  render(<MemoryRouter><Corners season={carnival()} /></MemoryRouter>);
  expect(screen.getByTestId("carnival-hat").tagName).toBe("BUTTON");
  const hero = screen.getByTestId("carnival-hero-hat");
  expect(hero).toHaveAccessibleName("Partyhut – Konfetti werfen");
  fireEvent.click(hero);
  expect(burst).toHaveBeenCalledTimes(1);
  // Platz und Knopf kommen aus seasons/mascot (#855) - dort sitzt auch die Rechnung samt Tests.
  expect(hero.className).toContain("tls-mascot-hat--wiggle");
  expect(hero.className).toContain("tls-party-hat--hero");
  expect(screen.getByTestId("carnival-hat").closest("header")).not.toBeNull();
  now.mockReturnValue(1_000_000 + HAT_COOLDOWN_MS - 1);
  fireEvent.click(hero);
  expect(burst).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1_000_000 + HAT_COOLDOWN_MS);
  fireEvent.click(hero);
  expect(burst).toHaveBeenCalledTimes(2);
  // Jeder Hut hat seinen eigenen Zuschnitt (keine doppelten Kennungen auf der Seite).
  const clips = [...document.querySelectorAll("clipPath")].map((clip) => clip.id);
  expect(new Set(clips).size).toBe(clips.length);
});

test("dezent: die Hüte sind nur Bilder - nichts zum Antippen, die Luftschlangen schwingen nicht", () => {
  vi.useFakeTimers();
  stage();
  render(<MemoryRouter><Corners season={carnival({ effective: "subtle" })} /></MemoryRouter>);
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.getByTestId("carnival-hat").tagName).toBe("SPAN");
  expect(screen.getByTestId("carnival-hero-hat").tagName).toBe("SPAN");
  expect(document.querySelectorAll("button").length).toBe(0);
  const streamers = screen.getAllByTestId("carnival-streamer");
  expect(streamers.length).toBeGreaterThanOrEqual(2);
  streamers.forEach((streamer) => expect(streamer.getAttribute("class")).not.toContain("tls-streamer--sway"));
});

test("der Gruß einmal am Tag: nach anderthalb Sekunden, zehn Sekunden lang, mit dem Text aus dem Admin", () => {
  vi.useFakeTimers();
  const first = render(<Toast season={carnival({ texts: { greeting: "Helau und Alaaf!" } })} />);
  expect(screen.queryByTestId("carnival-toast")).toBeNull();
  act(() => {
    vi.advanceTimersByTime(1500);
  });
  expect(screen.getByTestId("carnival-toast")).toHaveTextContent("Helau und Alaaf!");
  act(() => {
    vi.advanceTimersByTime(10000);
  });
  expect(screen.queryByTestId("carnival-toast")).toBeNull();
  first.unmount();
  render(<Toast season={carnival()} />);
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.queryByTestId("carnival-toast")).toBeNull();
});
