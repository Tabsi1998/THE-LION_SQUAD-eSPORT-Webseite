import { serverNow, serverOffset } from "../clock";
import { COUNTDOWN_SECONDS, PULSE_SECONDS, ZERO_SECONDS, countdownState, newYearOf, pulseLevel } from "./countdown";

// Countdown (N3, #741): Hinweis ab 23:00, ruhig ab 23:59:00, Puls in den letzten zehn Sekunden, um 00:00 der Gruß -
// nach der Serveruhr, deren Abstand die Laufzeit der Abfrage nicht verfälscht.

const SHOW = Date.parse("2027-01-01T00:00:00+01:00");
const at = (iso) => Date.parse(iso);

test("Stufen: wartet, Hinweis ab 23:00, ruhig ab 23:59:00, Puls ab 23:59:50, Null bis 00:00:08, dann fertig", () => {
  expect(countdownState(at("2026-12-31T21:30:00+01:00"), SHOW).stage).toBe("waiting");
  expect(countdownState(at("2026-12-31T23:00:00+01:00"), SHOW)).toMatchObject({ stage: "hint", minutes: 60 });
  expect(countdownState(at("2026-12-31T23:18:30+01:00"), SHOW)).toMatchObject({ stage: "hint", minutes: 42 });
  expect(countdownState(at("2026-12-31T23:58:59+01:00"), SHOW)).toMatchObject({ stage: "hint", minutes: 2 });
  expect(countdownState(at("2026-12-31T23:59:00+01:00"), SHOW)).toMatchObject({ stage: "calm", seconds: 60 });
  expect(countdownState(at("2026-12-31T23:59:00.500+01:00"), SHOW)).toMatchObject({ stage: "calm", seconds: 60 });
  expect(countdownState(at("2026-12-31T23:59:30+01:00"), SHOW)).toMatchObject({ stage: "calm", seconds: 30 });
  expect(countdownState(at("2026-12-31T23:59:50.200+01:00"), SHOW)).toMatchObject({ stage: "pulse", seconds: 10 });
  expect(countdownState(at("2026-12-31T23:59:59.900+01:00"), SHOW)).toMatchObject({ stage: "pulse", seconds: 1 });
  expect(countdownState(SHOW, SHOW).stage).toBe("zero");
  expect(countdownState(SHOW + 7900, SHOW).stage).toBe("zero");
  expect(countdownState(SHOW + ZERO_SECONDS * 1000 + 1, SHOW).stage).toBe("done");
  expect(countdownState(SHOW, NaN).stage).toBe("waiting");
  expect([COUNTDOWN_SECONDS, PULSE_SECONDS]).toEqual([60, 10]);
});

test("Das neue Jahr kommt aus dem Server, nie aus dem Code", () => {
  expect(newYearOf("2027-01-01T00:00:00+01:00")).toBe(2027);
  expect(newYearOf("2031-01-01T00:00:00+01:00")).toBe(2031);
  expect(newYearOf("")).toBeNull();
});

test("Puls: ein Schlag zu Beginn jeder Sekunde, zum Ende stärker; außerhalb der letzten zehn Sekunden keiner", () => {
  expect(pulseLevel(11)).toBe(0);
  expect(pulseLevel(0)).toBe(0);
  expect(pulseLevel(9.99)).toBeGreaterThan(0.5);
  expect(pulseLevel(9.5)).toBe(0);
  expect(pulseLevel(0.99)).toBeGreaterThan(pulseLevel(9.99));
});

test("Serveruhr: Abstand gegen die Mitte der Abfrage; ohne Zeit kein Abstand", () => {
  const requested = 1_000_000;
  const received = 1_000_400;
  expect(serverOffset(new Date(1_000_200 + 90_000).toISOString(), requested, received)).toBe(90_000);
  expect(serverOffset("", requested, received)).toBe(0);
  expect(serverNow(90_000, 5)).toBe(90_005);
});
