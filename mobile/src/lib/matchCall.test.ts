import { countdown } from "./matchCall";

// Aufruf (#1137): derselbe Countdown wie die Aufruf-Tafel am TV (frontend/src/lib/tvCalls.test.js).
const NOW = Date.parse("2026-10-10T14:32:00+02:00");

test("Minuten und Sekunden, aufgerundet; bei 0 „los“; ohne Ziel nichts", () => {
  expect(countdown(NOW + 90000, NOW)).toEqual({ seconds: 90, text: "1:30", done: false });
  expect(countdown(NOW - 5000, NOW)).toEqual({ seconds: 0, text: "0:00", done: true });
  expect(countdown(null, NOW)).toEqual({ seconds: null, text: "", done: false });
  expect(countdown(NOW + 61500, NOW).text).toBe("1:02");
});
