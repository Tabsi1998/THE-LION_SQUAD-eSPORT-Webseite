import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Die Bühne (#634): ohne aktive Saison wird kein Modul geladen, im Admin bleibt sie leer, mit Saison
// kommen Ecken, Widget, Footer und das Kennzeichen am <html>; „aus“ lädt nichts.

const seasonState = { ready: true, seasons: [], byKey: {}, reducedMotion: false, preference: "on", setPreference: vi.fn(), preview: false };
vi.mock("./SeasonContext", () => ({ useSeason: () => seasonState }));

const loadModule = vi.fn(async () => ({
  season: {
    key: "halloween",
    accent: "rgba(255,140,0,0.45)",
    Corners: () => <span data-testid="fake-corners" />,
    Widget: () => <button type="button" data-testid="fake-widget">Kürbis</button>,
    Footer: () => <span data-testid="fake-footer" />,
    Toast: () => <span data-testid="fake-toast" />,
    sounds: () => ({ key: "fake", instruments: { ping: () => {} }, music: null }),
  },
}));
const skyDispose = vi.fn();
const loadSnow = vi.fn(async () => ({ season: { key: "snow", skyLayers: () => [{ key: "fake-snow", draw: () => {}, dispose: skyDispose }] } }));
const weatherLayers = vi.fn(() => [{ key: "fake-weather", draw: () => {}, idle: () => true }]);
const loadWeather = vi.fn(async () => ({ season: { key: "weather", skyOnly: true, skyLayers: weatherLayers } }));
vi.mock("./registry", () => ({
  SEASON_MODULES: { halloween: () => loadModule(), snow: () => loadSnow(), weather: () => loadWeather() },
  hasModule: (key) => ["halloween", "snow", "weather"].includes(key),
}));

const { SeasonStage, isQuietPath, toastShownToday, markToastShown } = await import("./SeasonStage");
const { SeasonWidgetSlot, SeasonFooterSlot } = await import("./SeasonSlots");
const { getActiveEngine } = await import("./audio");

function halloween(effective = "normal") {
  return { key: "halloween", phase: "deko", intensity: "normal", effective, channels: ["web"], texts: {}, data: {} };
}

function weatherSeason(effective = "normal") {
  return { key: "weather", phase: "wetter", intensity: effective, effective, channels: ["web"], texts: {}, data: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seasonState.seasons = [];
  seasonState.weather = null;
  seasonState.preview = false;
  delete document.documentElement.dataset.season;
  delete document.documentElement.dataset.seasonIntensity;
  document.documentElement.style.removeProperty("--season-accent");
});

test("Pfade ohne Deko und der Gruß-Merker", () => {
  expect(isQuietPath("/admin")).toBe(true);
  expect(isQuietPath("/admin/settings/jahreszeiten")).toBe(true);
  expect(isQuietPath("/display/1")).toBe(true);
  expect(isQuietPath("/administration")).toBe(false);
  expect(isQuietPath("/")).toBe(false);
  const day = new Date("2026-12-24T10:00:00Z");
  expect(toastShownToday("christmas", day)).toBe(false);
  markToastShown("christmas", day);
  expect(toastShownToday("christmas", day)).toBe(true);
  expect(toastShownToday("christmas", new Date("2026-12-25T10:00:00Z"))).toBe(false);
});

test("ohne aktive Saison lädt kein Modul und nichts steht am <html>", async () => {
  render(<MemoryRouter initialEntries={["/"]}><SeasonStage /><SeasonWidgetSlot /></MemoryRouter>);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loadModule).not.toHaveBeenCalled();
  expect(screen.queryByTestId("season-corners")).toBeNull();
  expect(document.documentElement.dataset.season).toBeUndefined();
});

test("mit Saison: Ecken, Widget, Footer, Toast und Kennzeichen; „aus“ lädt nichts", async () => {
  seasonState.seasons = [halloween("normal")];
  render(<MemoryRouter initialEntries={["/tournaments"]}><SeasonStage /><SeasonWidgetSlot /><SeasonFooterSlot /></MemoryRouter>);
  expect(await screen.findByTestId("fake-corners")).toBeInTheDocument();
  expect(screen.getByTestId("fake-widget")).toBeInTheDocument();
  expect(screen.getByTestId("fake-footer")).toBeInTheDocument();
  expect(screen.getByTestId("fake-toast")).toBeInTheDocument();
  expect(screen.getByTestId("season-corners").parentElement).toBe(document.body);
  await waitFor(() => expect(document.documentElement.dataset.season).toBe("halloween"));
  expect(document.documentElement.style.getPropertyValue("--season-accent")).toContain("rgba");
  expect(loadModule).toHaveBeenCalledTimes(1);
});

test("„aus“ lädt nichts, „dezent“ ohne Farbschein", async () => {
  seasonState.seasons = [halloween("off")];
  const { unmount } = render(<MemoryRouter initialEntries={["/"]}><SeasonStage /></MemoryRouter>);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loadModule).not.toHaveBeenCalled();
  unmount();
  seasonState.seasons = [halloween("subtle")];
  render(<MemoryRouter initialEntries={["/"]}><SeasonStage /></MemoryRouter>);
  expect(await screen.findByTestId("fake-corners")).toBeInTheDocument();
  await waitFor(() => expect(document.documentElement.dataset.season).toBe("halloween"));
  expect(document.documentElement.style.getPropertyValue("--season-accent")).toBe("");
});

test("im Admin bleibt die Bühne leer", async () => {
  seasonState.seasons = [halloween("full")];
  render(<MemoryRouter initialEntries={["/admin/settings/jahreszeiten"]}><SeasonStage /><SeasonWidgetSlot /></MemoryRouter>);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loadModule).not.toHaveBeenCalled();
  expect(screen.queryByTestId("fake-widget")).toBeNull();
});

test("mit Vorschau zeichnet die Bühne auch im Admin - sofort sichtbar nach dem Knopf", async () => {
  seasonState.seasons = [halloween("full")];
  seasonState.preview = true;
  render(<MemoryRouter initialEntries={["/admin/settings/jahreszeiten"]}><SeasonStage /><SeasonWidgetSlot /></MemoryRouter>);
  expect(await screen.findByTestId("fake-corners")).toBeInTheDocument();
  expect(screen.getByTestId("fake-widget")).toBeInTheDocument();
  seasonState.preview = false;
});

test("Klänge (#679): der Schalter steht neben dem Widget, die Engine wartet auf die erste Geste und kreist durch Töne/Musik/aus; dezent ohne", async () => {
  class FakeAudioContext {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.sampleRate = 8000;
      this.destination = {};
      const gain = () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} });
      this.createGain = gain;
      this.close = () => {};
      this.resume = async () => {};
    }
  }
  window.AudioContext = FakeAudioContext;
  seasonState.seasons = [halloween("normal")];
  const view = render(<MemoryRouter initialEntries={["/"]}><SeasonStage /><SeasonWidgetSlot /></MemoryRouter>);
  const toggle = await screen.findByTestId("season-sound-toggle");
  expect(toggle.getAttribute("data-state")).toBe("all");
  await waitFor(() => expect(getActiveEngine()).not.toBeNull());
  expect(getActiveEngine().unlocked).toBe(false);
  fireEvent.pointerDown(window);
  expect(getActiveEngine().unlocked).toBe(true);
  expect(getActiveEngine().context).toBeInstanceOf(FakeAudioContext);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("data-state")).toBe("sfx");
  expect(getActiveEngine().prefs).toEqual({ sounds: true, music: false });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("data-state")).toBe("off");
  expect(JSON.parse(localStorage.getItem("tls-season-sound"))).toEqual({ sounds: false, music: false });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("data-state")).toBe("all");
  view.unmount();
  expect(getActiveEngine()).toBeNull();
  delete window.AudioContext;
  localStorage.removeItem("tls-season-sound");
  seasonState.seasons = [halloween("subtle")];
  render(<MemoryRouter initialEntries={["/"]}><SeasonStage /><SeasonWidgetSlot /></MemoryRouter>);
  await screen.findByTestId("fake-widget");
  expect(screen.queryByTestId("season-sound-toggle")).toBeNull();
});

test("Ebenen einer Saison bekommen ihre Zeichenfläche und räumen beim Gehen hinter sich auf", async () => {
  seasonState.seasons = [{ key: "snow", phase: "schnee", intensity: "normal", effective: "normal", channels: ["web"], texts: {}, data: {} }];
  seasonState.weather = { rain_mm: 2, snow_cm: 0, wind_factor: 0.9, wind_dir: 270, night: false };
  const { unmount } = render(<MemoryRouter initialEntries={["/"]}><SeasonStage /></MemoryRouter>);
  expect(await screen.findByTestId("season-sky")).toBeInTheDocument();
  await waitFor(() => expect(document.documentElement.dataset.season).toBe("snow"));
  expect(skyDispose).not.toHaveBeenCalled();
  unmount();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(skyDispose).toHaveBeenCalledTimes(1);
});

test("das Wetter ist nur Himmel: es läuft neben jeder Saison, redet bei der Stärke am <html> nicht mit und bekommt das Wetter mit", async () => {
  seasonState.seasons = [weatherSeason("full"), halloween("subtle")];
  seasonState.weather = { rain_mm: 2, snow_cm: 0, code: 95, wind_factor: 0.9, wind_dir: 270, night: false };
  const view = render(<MemoryRouter initialEntries={["/"]}><SeasonStage /><SeasonWidgetSlot /></MemoryRouter>);
  expect(await screen.findByTestId("season-sky")).toBeInTheDocument();
  await waitFor(() => expect(document.documentElement.dataset.season).toBe("weather halloween"));
  expect(document.documentElement.dataset.seasonIntensity).toBe("subtle");
  expect(screen.getByTestId("fake-widget")).toBeInTheDocument();
  expect(weatherLayers).toHaveBeenLastCalledWith(expect.objectContaining({ preview: false, reducedMotion: false, weather: seasonState.weather, season: expect.objectContaining({ key: "weather", effective: "full" }) }));
  view.unmount();
  // Umgekehrt: das Wetter auf „dezent“ hält den Adventkranz nicht an - am <html> steht nur die Stärke der anderen.
  seasonState.seasons = [weatherSeason("subtle"), halloween("normal")];
  render(<MemoryRouter initialEntries={["/"]}><SeasonStage /></MemoryRouter>);
  await waitFor(() => expect(document.documentElement.dataset.season).toBe("weather halloween"));
  expect(document.documentElement.dataset.seasonIntensity).toBe("normal");
});

test("Vorschau des Wetters: die Ebene erfährt davon und zeichnet auch im Admin", async () => {
  seasonState.seasons = [weatherSeason("normal")];
  seasonState.weather = { rain_mm: 2.5, snow_cm: 0, code: 95, demo: true };
  const quiet = render(<MemoryRouter initialEntries={["/admin/settings/jahreszeiten"]}><SeasonStage /></MemoryRouter>);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loadWeather).not.toHaveBeenCalled();
  expect(screen.queryByTestId("season-sky")).toBeNull();
  quiet.unmount();
  seasonState.preview = true;
  render(<MemoryRouter initialEntries={["/admin/settings/jahreszeiten"]}><SeasonStage /></MemoryRouter>);
  expect(await screen.findByTestId("season-sky")).toBeInTheDocument();
  expect(weatherLayers).toHaveBeenLastCalledWith(expect.objectContaining({ preview: true, weather: expect.objectContaining({ demo: true }) }));
});
