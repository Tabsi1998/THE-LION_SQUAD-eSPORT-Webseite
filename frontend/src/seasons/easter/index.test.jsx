import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Ostern im Web (#645, #753, #756): das Modul im Register; Ohren auf dem Löwen (antippen lässt sie zucken), die
// Eier-Reihe unter der Kopfzeile (während einer laufenden Eiersuche Blumen), die Wiese über der Fußzeile, Blätter
// nur mit Bewegung; Karfreitag still (keine Bewegung, kein Gruß); der Gruß am Ostersonntag und -montag einmal.

const seasonState = { byKey: {} };
vi.mock("../SeasonContext", () => ({ useSeason: () => seasonState }));

const { Backdrop, Corners, GREETING_KEY, Toast, season, skyLayers } = await import("./index.jsx");
const { SEASON_MODULES, hasModule } = await import("../registry");
const { reportHuntActive, resetHuntActive } = await import("../easterHunt/api");

const SUNDAY = "2027-03-28";

function easter(overrides = {}, data = {}) {
  return { key: "easter", label: "Ostern", phase: "deko", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: { greeting: "Frohe Ostern wünscht THE LION SQUAD" }, starts_at: "2027-03-21T00:00:00+01:00", ends_at: "2027-03-29T23:59:59+02:00", forced: false, data: { quiet: false, sunday: SUNDAY, ...data }, ...overrides };
}

/** Kopf mit Logo, der große Löwe und eine Fußzeile mit freiem Rand darüber - „geladen“ und vermessen. */
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
  const footer = document.createElement("footer");
  footer.style.marginTop = "96px";
  document.body.append(header, anchor, footer);
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
  footer.getBoundingClientRect = () => ({ left: 0, top: 1800, width: 1440, height: 300, right: 1440, bottom: 2100 });
}

function renderCorners(value, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}><Corners season={value} /></MemoryRouter>);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2027-03-24T10:00:00+01:00"));
  seasonState.byKey = {};
  resetHuntActive();
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function settle(ms = 2000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

test("das Modul steht im Register: Licht, Ecken, Gruß, Blätter", async () => {
  expect(hasModule("easter")).toBe(true);
  expect((await SEASON_MODULES.easter()).season).toBe(season);
  expect(Object.keys(season).sort()).toEqual(["Backdrop", "Corners", "Toast", "key", "skyLayers"]);
});

test("keine Hasenohren mehr am Löwen (#857) - weder im Kopf noch auf der Startseite", async () => {
  stage();
  renderCorners(easter());
  await settle();
  expect(screen.queryByTestId("easter-ears")).toBeNull();
  expect(screen.queryByTestId("easter-hero-ears")).toBeNull();
  expect(document.querySelector(".tls-mascot-hat")).toBeNull();
});

test("Eier-Reihe und Wiese: auf der Startseite beides; Eier mit verschiedenen Mustern", async () => {
  stage();
  renderCorners(easter());
  await settle();
  const row = screen.getByTestId("easter-row");
  expect(row.dataset.items).toBe("eggs");
  const patterns = [...row.querySelectorAll("svg[data-pattern]")].map((svg) => svg.getAttribute("data-pattern"));
  expect(patterns).toHaveLength(6);
  expect(new Set(patterns).size).toBe(6);
  expect(row.className).toContain("tls-easter-row--sway");
  const meadow = screen.getByTestId("easter-meadow");
  expect(parseFloat(meadow.style.top)).toBe(1800 - 26);
  expect(screen.getAllByTestId("easter-meadow-flower").length).toBeGreaterThan(3);
});

test("während einer laufenden Eiersuche: Blumen statt Eier - erst wenn feststeht, dass keine läuft, Eier", async () => {
  stage();
  seasonState.byKey = { easter_hunt: { key: "easter_hunt", effective: "normal" } };
  renderCorners(easter());
  await settle();
  expect(screen.getByTestId("easter-row").dataset.items).toBe("flowers");
  act(() => reportHuntActive(true));
  expect(screen.getByTestId("easter-row").dataset.items).toBe("flowers");
  act(() => reportHuntActive(false));
  expect(screen.getByTestId("easter-row").dataset.items).toBe("eggs");
});

test("Karfreitag: alles da, aber still - nichts schwingt, kein Gruß", async () => {
  vi.setSystemTime(new Date("2027-03-26T10:00:00+01:00"));
  stage();
  const friday = easter({}, { quiet: true });
  renderCorners(friday);
  await settle();
  expect(screen.getByTestId("easter-row").className).not.toContain("--sway");
  expect(screen.getByTestId("easter-meadow").className).not.toContain("--sway");
  expect(skyLayers({ season: friday, budget: 120 })).toEqual([]);
  render(<Toast season={friday} />);
  await settle(3000);
  expect(screen.queryByTestId("easter-toast")).toBeNull();
  render(<Backdrop season={friday} />);
  expect(screen.getByTestId("easter-light").className).toContain("tls-easter-light--quiet");
});

test("Blätter nur mit Bewegung und Budget; „dezent“ hält alles still", async () => {
  expect(skyLayers({ season: easter(), budget: 120 })).toHaveLength(1);
  expect(skyLayers({ season: easter(), budget: 0 })).toEqual([]);
  expect(skyLayers({ season: easter(), budget: 120, reducedMotion: true })).toEqual([]);
  const subtle = easter({ effective: "subtle" });
  expect(skyLayers({ season: subtle, budget: 120 })).toEqual([]);
  stage();
  renderCorners(subtle);
  await settle();
  expect(document.querySelectorAll("button")).toHaveLength(0);
  expect(screen.queryByTestId("easter-butterfly")).toBeNull();
});

test("der Gruß am Ostersonntag und -montag einmal je Tag - davor nicht", async () => {
  render(<Toast season={easter()} />);
  await settle(3000);
  expect(screen.queryByTestId("easter-toast")).toBeNull();
  cleanup();
  vi.setSystemTime(new Date("2027-03-28T10:00:00+02:00"));
  render(<Toast season={easter()} />);
  await settle(1600);
  expect(screen.getByTestId("easter-toast")).toHaveTextContent("Frohe Ostern wünscht THE LION SQUAD");
  expect(localStorage.getItem(`tls-season-toast-${GREETING_KEY}`)).not.toBeNull();
  await settle(10000);
  expect(screen.queryByTestId("easter-toast")).toBeNull();
  cleanup();
  render(<Toast season={easter()} />);
  await settle(3000);
  expect(screen.queryByTestId("easter-toast")).toBeNull();
});
