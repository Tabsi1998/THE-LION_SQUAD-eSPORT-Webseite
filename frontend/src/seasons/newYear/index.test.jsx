import { act, fireEvent, render, screen } from "@testing-library/react";

// Silvester im Web (S9, N1–N5): Ebene nur mit Bewegung und Budget, der Plan der Stunde plus die drei großen Salven, der
// Hinweis ab 23:00, der Ton-Schalter (Vorgabe aus), der Countdown nach der Serveruhr (ruhig, Puls, Null mit Gruß),
// danach einmal am Tag der Gruß; „um Mitternacht dabei“ zählt einmal, nur in den Phasen um Mitternacht.

const contextState = { serverOffset: 0, serverNow: null, weather: null };
const recordSignal = vi.fn();
vi.mock("../SeasonContext", () => ({ useSeason: () => contextState }));
vi.mock("../signals", () => ({ recordSignal: (...args) => recordSignal(...args) }));

const { Corners, SIGNAL_KEY, Toast, Widget, currentPlan, resetLiveNewYear, season, setLiveNewYear, showYear, skyLayers } = await import("./index.jsx");
const { NEW_YEAR_SOUND_KEY } = await import("./sound");

const SHOW = "2027-01-01T00:00:00+01:00";

function ny(phase, overrides = {}) {
  return { key: "new_year", label: "Silvester", phase, intensity: "normal", effective: "normal", channels: ["web", "app"], texts: { greeting: "Frohes neues Jahr wünscht THE LION SQUAD" }, starts_at: "2026-12-29T18:00:00+01:00", ends_at: "2027-01-01T23:59:59+01:00", forced: false, data: { seed: 2026365023, salvos: [12, 30, 1800], rate_per_hour: { min: 20, max: 40 }, show_start: SHOW }, ...overrides };
}

beforeEach(() => {
  resetLiveNewYear();
  recordSignal.mockReset();
  contextState.serverOffset = 0;
  contextState.serverNow = null;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

test("das Modul: Ebene, Ecken (Abgleich), Kopf und Karte; Jahr der Handschrift ist das Silvester-Jahr", () => {
  expect(season.key).toBe("new_year");
  expect(Object.keys(season).sort()).toEqual(["Corners", "Toast", "Widget", "key", "skyLayers"]);
  expect(showYear(ny("show"))).toBe(2026);
});

test("Ebene nur mit Bewegung und Budget - nie bei „dezent“ oder „Bewegung reduzieren“", () => {
  expect(skyLayers({ season: ny("show"), budget: 120 })).toHaveLength(1);
  expect(skyLayers({ season: ny("show", { effective: "subtle" }), budget: 120 })).toHaveLength(0);
  expect(skyLayers({ season: ny("show"), budget: 120, reducedMotion: true })).toHaveLength(0);
  expect(skyLayers({ season: ny("show"), budget: 0 })).toHaveLength(0);
});

test("Plan: die Startsekunden des Servers in der laufenden Stunde, in der Show dazu die drei großen Salven", () => {
  setLiveNewYear({ season: ny("evening_31"), payloadNow: "2026-12-31T21:20:00+01:00" });
  const evening = currentPlan();
  const hour = Date.parse("2026-12-31T21:00:00+01:00");
  expect(evening.map((launch) => launch.at)).toEqual([hour + 12000, hour + 30000, hour + 1800000]);
  expect(currentPlan()).toBe(evening);
  setLiveNewYear({ season: ny("show"), payloadNow: "2027-01-01T00:02:00+01:00" });
  const show = currentPlan();
  const salvos = show.filter((launch) => String(launch.id).startsWith("salvo:"));
  expect(salvos.length).toBeGreaterThanOrEqual(3 * 5);
  const minutes = new Set(salvos.map((launch) => Math.floor((launch.at - Date.parse(SHOW)) / 60000)));
  expect([...minutes].sort((a, b) => a - b)).toEqual([0, 5, 10]);
});

test("Kopf: ab 23:00 „noch … Min. bis 2027“ nach der Serveruhr; der Ton-Schalter ist aus und merkt sich die Wahl", async () => {
  vi.useFakeTimers({ now: new Date("2026-12-31T22:00:00Z") });
  contextState.serverOffset = 18 * 60 * 1000 + 30 * 1000;
  render(<Widget season={ny("evening_31")} />);
  expect(screen.getByTestId("new-year-hint")).toHaveTextContent("noch 42 Min. bis 2027");
  const sound = screen.getByTestId("new-year-sound");
  expect(sound.getAttribute("aria-pressed")).toBe("false");
  await act(async () => {
    fireEvent.click(sound);
  });
  expect(localStorage.getItem(NEW_YEAR_SOUND_KEY)).toBe("on");
  expect(screen.getByTestId("new-year-sound").getAttribute("aria-pressed")).toBe("true");
});

test("Countdown: ruhig ab 23:59:00, Puls in den letzten zehn Sekunden, um 00:00 der Gruß - nach der Serveruhr", async () => {
  // Geräteuhr zwei Minuten nach - der Server weiß es besser.
  vi.useFakeTimers({ now: new Date(Date.parse("2026-12-31T23:57:20+01:00")) });
  contextState.serverOffset = 2 * 60 * 1000;
  render(<Toast season={ny("countdown")} />);
  expect(screen.getByTestId("new-year-countdown").dataset.stage).toBe("calm");
  expect(screen.getByTestId("new-year-digits")).toHaveTextContent("40");
  await act(async () => {
    vi.advanceTimersByTime(30_500);
  });
  expect(screen.getByTestId("new-year-countdown").dataset.stage).toBe("pulse");
  expect(screen.getByTestId("new-year-digits")).toHaveTextContent("10");
  expect(screen.getByTestId("new-year-countdown").getAttribute("role")).toBe("timer");
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(screen.getByTestId("new-year-zero")).toHaveTextContent("Frohes neues Jahr 2027!");
  expect(screen.getByTestId("new-year-zero")).toHaveTextContent("Frohes neues Jahr wünscht THE LION SQUAD");
  await act(async () => {
    vi.advanceTimersByTime(9_000);
  });
  expect(screen.queryByTestId("new-year-zero")).toBeNull();
});

test("Gruß danach einmal am Tag - auch für wen, der erst um halb eins kommt; × schließt", async () => {
  vi.useFakeTimers({ now: new Date(Date.parse("2027-01-01T00:30:00+01:00")) });
  const view = render(<Toast season={ny("fade")} />);
  expect(screen.queryByTestId("new-year-toast")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(1600);
  });
  expect(screen.getByTestId("new-year-toast")).toHaveTextContent("Frohes neues Jahr 2027");
  fireEvent.click(screen.getByTestId("new-year-toast-close"));
  expect(screen.queryByTestId("new-year-toast")).toBeNull();
  view.unmount();
  render(<Toast season={ny("greeting")} />);
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.queryByTestId("new-year-toast")).toBeNull();
});

test("„um Mitternacht dabei“ zählt einmal und nur in den Phasen um Mitternacht; die Ebene bekommt den Stand", () => {
  contextState.serverOffset = 1234;
  contextState.serverNow = "2026-12-31T23:50:00+01:00";
  const view = render(<Corners season={ny("evening_31")} />);
  expect(recordSignal).not.toHaveBeenCalled();
  view.rerender(<Corners season={ny("pre_countdown")} />);
  view.rerender(<Corners season={ny("countdown")} />);
  expect(recordSignal).toHaveBeenCalledTimes(1);
  expect(recordSignal).toHaveBeenCalledWith(SIGNAL_KEY);
  // Die Ebene hat den Stand: die drei Startsekunden der Stunde, dazu (Countdown-Phase) die großen Salven.
  expect(currentPlan().filter((launch) => !String(launch.id).startsWith("salvo:"))).toHaveLength(3);
  expect(currentPlan().some((launch) => String(launch.id).startsWith("salvo:"))).toBe(true);
});
