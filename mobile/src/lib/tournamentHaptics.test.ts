import * as Haptics from "expo-haptics";
import { HAPTIC_MOMENTS, playMoment } from "./tournamentHaptics";

// Vibration bei wichtigen Momenten (#1168): Aufruf dreimal kurz, Check-in geschafft einmal, Ergebnis eingetragen
// zweimal, Turniersieg einmal lang; dazu (Fabian, 14.10.) dein Weiterkommen einmal kurz - sonst nichts. Ist am Handy
// die Vibration aus, bleibt es still (das macht das System).
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

const calls = () => [
  ...(Haptics.impactAsync as jest.Mock).mock.calls.map(([style]) => `impact:${style}`),
  ...(Haptics.notificationAsync as jest.Mock).mock.calls.map(([type]) => `notification:${type}`),
];

test("die Muster der wichtigen Momente", () => {
  expect(Object.keys(HAPTIC_MOMENTS)).toEqual(["call", "checkIn", "result", "advance", "win"]);
  expect(HAPTIC_MOMENTS.advance.map((step) => step.kind)).toEqual(["medium"]);
  expect(HAPTIC_MOMENTS.call.map((step) => step.kind)).toEqual(["medium", "medium", "medium"]);
  expect(HAPTIC_MOMENTS.checkIn.map((step) => step.kind)).toEqual(["success"]);
  expect(HAPTIC_MOMENTS.result.map((step) => step.kind)).toEqual(["light", "light"]);
  expect(HAPTIC_MOMENTS.win.map((step) => step.kind)).toEqual(["success", "heavy", "heavy"]);
  // Kurz heißt kurz: kein Muster dauert länger als eine halbe Sekunde.
  for (const steps of Object.values(HAPTIC_MOMENTS)) expect(Math.max(...steps.map((step) => step.at))).toBeLessThanOrEqual(500);
});

test("Aufruf: dreimal kurz, im Takt", () => {
  playMoment("call");
  expect(calls()).toEqual(["impact:medium"]);
  jest.advanceTimersByTime(500);
  expect(calls()).toEqual(["impact:medium", "impact:medium", "impact:medium"]);
});

test("Turniersieg: Erfolg und zwei schwere Stöße", () => {
  playMoment("win");
  jest.advanceTimersByTime(500);
  expect(calls()).toEqual(["impact:heavy", "impact:heavy", "notification:success"]);
});

test("abbrechen: ausstehende Stöße fallen weg (Seite verlassen)", () => {
  const stop = playMoment("result");
  stop();
  jest.advanceTimersByTime(500);
  expect(calls()).toEqual(["impact:light"]);
});

test("ohne Vibration am Gerät bleibt es still und wirft nicht", () => {
  (Haptics.impactAsync as jest.Mock).mockImplementationOnce(() => { throw new Error("kein Motor"); });
  (Haptics.notificationAsync as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error("kein Motor")));
  expect(() => { playMoment("call"); playMoment("checkIn"); jest.advanceTimersByTime(500); }).not.toThrow();
});
