import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";

// Silvester in der App (S11 #642, N1–N5 #739–#743): Raketen nach dem Plan des Servers über allen Tabs (Skia), auf
// ruhigen Screens weniger und auf stillen keine; ab 23:00 der Hinweis im Kopf mit dem Ton-Schalter, ab 23:59:00 der
// Countdown, um 00:00 die Null mit dem Gruß, ein Erfolgs-Tippen und die drei großen Salven; danach einmal am Tag der
// Gruß - aber nicht für wen die Null schon da war. „Um Mitternacht dabei“ zählt einmal, auch über Phasenwechsel.

const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: false, reload: jest.fn(), toast: null, showToast: jest.fn(), weather: null, serverOffset: 0, serverNow: null };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));
const mockSignals = { recordSignal: jest.fn(async () => true) };
jest.mock("../signals", () => mockSignals);
const mockSound = { playFireSound: jest.fn(async () => true) };
jest.mock("./sound", () => {
  const actual = jest.requireActual("./sound");
  return { ...actual, playFireSound: (...args: unknown[]) => mockSound.playFireSound(...(args as [])) };
});

const { FireworksSky, NewYearGreeting, NewYearWidget, fireShare, planFor, resetNewYearState, thinPlan } = require("./index");
const { resetNewYearSound, NEW_YEAR_SOUND_KEY } = require("./sound");
const { SEASON_MODULES, appNamesSeason } = require("../SeasonStage");
const { resetQuiet, setOverlay } = require("../quiet");
const { localDay } = require("../christmas/greeting");

const SHOW_START = "2027-01-01T00:00:00+01:00";
const MIDNIGHT = Date.parse(SHOW_START);

function silvester(overrides: Record<string, unknown> = {}) {
  return {
    key: "new_year",
    label: "Silvester",
    phase: "countdown",
    intensity: "normal",
    effective: "normal",
    channels: ["web", "app"],
    texts: { greeting: "Frohes neues Jahr wünscht THE LION SQUAD" },
    data: { seed: 4711, salvos: [30, 610, 1250, 2405, 3300], show_start: SHOW_START },
    starts_at: "2026-12-29T18:00:00+01:00",
    ends_at: "2027-01-01T23:59:59+01:00",
    forced: false,
    ...overrides,
  };
}

function at(ms: number) {
  jest.setSystemTime(ms);
  mockSeasonState.serverNow = new Date(ms).toISOString();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  resetNewYearState();
  resetNewYearSound();
  resetQuiet();
  mockSeasonState.reducedMotion = false;
  mockSeasonState.serverOffset = 0;
  mockSignals.recordSignal.mockClear();
  mockSound.playFireSound.mockClear();
  (Haptics.notificationAsync as jest.Mock).mockClear();
  (Haptics.impactAsync as jest.Mock).mockClear();
  await SecureStore.deleteItemAsync(NEW_YEAR_SOUND_KEY);
  await SecureStore.deleteItemAsync("season_greeting_new-year-greeting");
});

afterEach(() => {
  jest.useRealTimers();
});

test("Silvester ist ein Modul der App: Himmel, Widget im Kopf, Countdown und Gruß - und steht unter „Gerade läuft“", () => {
  expect(Object.keys(SEASON_MODULES.new_year).sort()).toEqual(["Greeting", "Sky", "Widget"]);
  expect(appNamesSeason({ key: "new_year" })).toBe(true);
});

test("Plan: die Raketen der Stunde nach dem Server, in der Show dazu die drei großen Salven; ruhige Screens bekommen weniger", () => {
  at(MIDNIGHT - 30 * 60000);
  const evening = planFor(silvester({ phase: "evening_31" }), mockSeasonState.serverNow);
  expect(evening).toHaveLength(5);
  expect(evening.every((launch: { id: string }) => !launch.id.startsWith("salvo:"))).toBe(true);
  const hourStart = Math.floor((MIDNIGHT - 30 * 60000) / 3600000) * 3600000;
  expect(evening[0].at).toBe(hourStart + 30000);
  const show = planFor(silvester({ phase: "show" }), mockSeasonState.serverNow);
  const salvos = show.filter((launch: { id: string }) => launch.id.startsWith("salvo:"));
  expect(salvos.length).toBeGreaterThanOrEqual(3 * 8);
  expect(new Set(salvos.map((launch: { at: number }) => Math.floor((launch.at - MIDNIGHT) / 60000)))).toEqual(new Set([0, 5, 10]));
  expect(planFor(silvester({ phase: "greeting" }), mockSeasonState.serverNow).some((launch: { id: string }) => launch.id.startsWith("salvo:"))).toBe(false);
  // Um 00:00 zuerst die neue Jahreszahl (#853) - das Jahr aus dem Beginn der Show; ruhige Screens behalten sie ganz.
  const digits = show.filter((launch: { glyph?: string }) => typeof launch.glyph === "string");
  expect(digits.map((launch: { glyph: string }) => launch.glyph).join("")).toBe("2027");
  expect(digits[0].at).toBe(MIDNIGHT);
  expect(thinPlan(show, 0.45).filter((launch: { glyph?: string }) => typeof launch.glyph === "string")).toHaveLength(4);
  expect(planFor({ ...silvester(), key: "christmas" }, mockSeasonState.serverNow)).toEqual([]);
  // Probe-Show (Vorschau): die großen Salven in Sekunden statt Minuten - wie im Web.
  const demo = planFor(silvester({ phase: "countdown", data: { ...silvester().data, salvo_seconds: [0, 12, 24] } }), mockSeasonState.serverNow);
  const demoSeconds = new Set<number>(demo.filter((launch: { id: string }) => launch.id.startsWith("salvo:")).map((launch: { at: number }) => Math.round((launch.at - MIDNIGHT) / 1000)));
  expect([...demoSeconds].every((second) => second >= 0 && second <= 30)).toBe(true);
  expect([fireShare("Dashboard"), fireShare("Teams"), fireShare("TournamentList"), fireShare("Settings")]).toEqual([1, 0.7, 0.45, 0]);
  const thin = thinPlan(show, 0.45);
  expect(thin.length).toBeLessThan(show.length);
  expect(thin.filter((launch: { id: string }) => launch.id.startsWith("salvo:"))).toHaveLength(salvos.length);
  expect(thinPlan(show, 0.45)).toEqual(thin);
  expect(thinPlan(show, 0)).toEqual([]);
});

test("Himmel: Skia zeichnet die Salve um Mitternacht; still bei „Bewegung reduzieren“, „dezent“ und auf stillen Screens", async () => {
  const skia = require("@shopify/react-native-skia");
  const { __frameCallbacks } = require("react-native-reanimated");
  at(MIDNIGHT + 1500);
  const view = await render(<FireworksSky season={silvester({ phase: "show" })} screen="Dashboard" reducedMotion={false} />);
  expect(screen.getByTestId("new-year-sky")).toBeTruthy();
  const before = skia.__skiaDraws.circles;
  await act(async () => {
    __frameCallbacks.forEach(({ callback, handle }: { callback: () => void; handle: { isActive: boolean } }) => handle.isActive && callback());
  });
  expect(skia.__skiaDraws.circles).toBeGreaterThan(before + 20);
  await view.rerender(<FireworksSky season={silvester({ phase: "show" })} screen="Dashboard" reducedMotion />);
  expect(screen.queryByTestId("new-year-sky")).toBeNull();
  await view.rerender(<FireworksSky season={silvester({ phase: "show", effective: "subtle" })} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("new-year-sky")).toBeNull();
  await view.rerender(<FireworksSky season={silvester({ phase: "show" })} screen="Settings" reducedMotion={false} />);
  expect(screen.queryByTestId("new-year-sky")).toBeNull();
});

test("Ton: aus bleibt still; eingeschaltet zischen und knallen nahe Raketen und die großen Salven", async () => {
  at(MIDNIGHT - 5000);
  const view = await render(<FireworksSky season={silvester({ phase: "countdown" })} screen="Dashboard" reducedMotion={false} />);
  await advance(20000);
  expect(mockSound.playFireSound).not.toHaveBeenCalled();
  await view.unmount();
  await SecureStore.setItemAsync(NEW_YEAR_SOUND_KEY, "on");
  resetNewYearSound();
  at(MIDNIGHT - 5000);
  await render(<FireworksSky season={silvester({ phase: "countdown" })} screen="Dashboard" reducedMotion={false} />);
  await flush();
  await advance(8000);
  const names = mockSound.playFireSound.mock.calls.map((call: unknown[]) => String(call[0]));
  expect(names).toContain("whistle");
  expect(names.some((name: string) => name.startsWith("boom-"))).toBe(true);
});

test("Kopf: ab 23:00 „noch 42 Min.“ (bis 2027) mit dem Ton-Schalter; Vorgabe aus, Antippen schaltet ein und merkt es", async () => {
  at(MIDNIGHT - 42 * 60000 + 10000);
  await render(<NewYearWidget season={silvester({ phase: "evening_31" })} />);
  await flush();
  const hint = screen.getByTestId("new-year-hint");
  expect(hint).toHaveTextContent(/noch\s*42 Min\./);
  expect(hint.props.accessibilityLabel).toBe("Noch 42 Minuten bis 2027");
  const sound = screen.getByTestId("new-year-sound");
  expect(sound.props.accessibilityLabel).toBe("Feuerwerk-Ton einschalten");
  expect(sound.props.accessibilityState).toEqual({ checked: false });
  await fireEvent.press(sound);
  await flush();
  expect(screen.getByTestId("new-year-sound").props.accessibilityState).toEqual({ checked: true });
  expect(screen.getByTestId("new-year-sound").props.accessibilityLabel).toBe("Feuerwerk-Ton ausschalten");
  expect(await SecureStore.getItemAsync(NEW_YEAR_SOUND_KEY)).toBe("on");
  await screen.unmount();
  at(MIDNIGHT - 3 * 3600000);
  await render(<NewYearWidget season={silvester({ phase: "evening_31", effective: "subtle" })} />);
  expect(screen.queryByTestId("new-year-hint")).toBeNull();
  expect(screen.queryByTestId("new-year-sound")).toBeNull();
  await screen.unmount();
  await render(<NewYearWidget season={silvester({ phase: "before" })} />);
  expect(screen.queryByTestId("new-year-widget")).toBeNull();
});

test("Countdown ab 23:59:00, die letzten zehn mit Schlag, um 00:00 die Null mit Gruß und Erfolgs-Tippen - einmal, auch über den Phasenwechsel", async () => {
  at(MIDNIGHT - 45000);
  const view = await render(<NewYearGreeting key="countdown" season={silvester({ phase: "countdown" })} screen="Dashboard" />);
  expect(screen.getByTestId("new-year-countdown").props.accessibilityLabel).toBe("Noch 45 Sekunden bis 2027");
  expect(screen.getByTestId("new-year-digits")).toHaveTextContent("45");
  expect(mockSignals.recordSignal).toHaveBeenCalledWith("online_at_new_year");
  await advance(37000);
  expect(screen.getByTestId("new-year-digits")).toHaveTextContent("8");
  expect(screen.getByText("Gleich ist es so weit")).toBeTruthy();
  await advance(8100);
  expect(screen.getByTestId("new-year-zero")).toHaveTextContent(/Frohes neues Jahr 2027!/);
  expect(screen.getByTestId("new-year-zero")).toHaveTextContent(/wünscht THE LION SQUAD/);
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  await flush();
  // Die Bühne hängt den Gruß um 00:00 mit der Phase „show“ neu ein: kein zweites Tippen, kein zweites Signal.
  await view.rerender(<NewYearGreeting key="show" season={silvester({ phase: "show" })} screen="Dashboard" />);
  await flush();
  expect(screen.getByTestId("new-year-zero")).toBeTruthy();
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  expect(mockSignals.recordSignal).toHaveBeenCalledTimes(1);
  // Die erste große Salve zerplatzt: ein leichtes Tippen.
  await advance(1300);
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  // Nach der Null kein Gruß noch einmal - wer um Mitternacht dabei war, hat ihn schon.
  await advance(9000);
  expect(screen.queryByTestId("new-year-zero")).toBeNull();
  await advance(3000);
  expect(screen.queryByTestId("new-year-toast")).toBeNull();
  // Der Tag des Geräts zur Mitternacht in Wien - in Wien der 1. Jänner, auf einem Gerät in UTC noch der 31.12.;
  // Merker und Prüfung rechnen mit demselben Tag.
  expect(await SecureStore.getItemAsync("season_greeting_new-year-greeting")).toBe(localDay(new Date(MIDNIGHT)));
});

test("am 1. Jänner: der Gruß einmal am Tag über der Tab-Leiste - nicht auf stillen Screens, nicht über einem Dialog", async () => {
  at(Date.parse("2027-01-01T10:00:00+01:00"));
  const quiet = await render(<NewYearGreeting season={silvester({ phase: "greeting" })} screen="Settings" />);
  await flush();
  await advance(2000);
  expect(screen.queryByTestId("new-year-toast")).toBeNull();
  await quiet.unmount();
  setOverlay("dialog", true);
  const covered = await render(<NewYearGreeting season={silvester({ phase: "greeting" })} screen="Dashboard" />);
  await flush();
  await advance(2000);
  expect(screen.queryByTestId("new-year-toast")).toBeNull();
  await covered.unmount();
  setOverlay("dialog", false);
  const view = await render(<NewYearGreeting season={silvester({ phase: "greeting" })} screen="Dashboard" />);
  await flush();
  await advance(1600);
  expect(screen.getByTestId("new-year-toast")).toHaveTextContent(/Frohes neues Jahr 2027/);
  expect(mockSignals.recordSignal).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("new-year-toast"));
  expect(screen.queryByTestId("new-year-toast")).toBeNull();
  await view.unmount();
  await render(<NewYearGreeting season={silvester({ phase: "greeting" })} screen="Dashboard" />);
  await flush();
  await advance(2000);
  expect(screen.queryByTestId("new-year-toast")).toBeNull();
});

test("„dezent“ und „Bewegung reduzieren“ (#853): um 00:00 steht die Jahreszahl ruhig am Himmel - ohne Raketen; sonst formen sie die Funken", async () => {
  const { drawCalmYear } = require("./index");
  // Die ruhige Zahl ist nur Schmuck und für Screenreader verborgen - gesucht wird sie trotzdem.
  const HIDDEN = { includeHiddenElements: true };
  at(MIDNIGHT + 1000);
  const view = await render(<NewYearGreeting season={silvester({ phase: "show", effective: "subtle" })} screen="Dashboard" />);
  const calm = screen.getByTestId("new-year-calm-year", HIDDEN);
  expect(calm.props.pointerEvents).toBe("none");
  expect(calm.props.importantForAccessibility).toBe("no-hide-descendants");
  expect(screen.getByTestId("new-year-zero")).toHaveTextContent(/Frohes neues Jahr 2027!/);
  await view.unmount();
  mockSeasonState.reducedMotion = true;
  const still = await render(<NewYearGreeting season={silvester({ phase: "show" })} screen="Dashboard" />);
  expect(screen.getByTestId("new-year-calm-year", HIDDEN)).toBeTruthy();
  await still.unmount();
  mockSeasonState.reducedMotion = false;
  // Mit Bewegung formen die Funken die Zahl - keine zweite, ruhige; auf stillen Screens gar keine.
  const lively = await render(<NewYearGreeting season={silvester({ phase: "show" })} screen="Dashboard" />);
  expect(screen.queryByTestId("new-year-calm-year", HIDDEN)).toBeNull();
  await lively.unmount();
  await render(<NewYearGreeting season={silvester({ phase: "show", effective: "subtle" })} screen="Settings" />);
  expect(screen.queryByTestId("new-year-calm-year", HIDDEN)).toBeNull();
  // Gezeichnet wird je Punkt ein Schein und ein Kern - wie die Funken im Feuerwerk.
  const circles: number[] = [];
  const paint = { setColor() {}, setAlphaf() {} };
  drawCalmYear({ drawCircle: (_x: number, _y: number, r: number) => circles.push(r) } as never, [{ x: 10, y: 20, white: false }, { x: 30, y: 20, white: true }], paint as never, 1 as never, 2 as never);
  expect(circles).toEqual([7, 2.6, 7, 2.2]);
});
