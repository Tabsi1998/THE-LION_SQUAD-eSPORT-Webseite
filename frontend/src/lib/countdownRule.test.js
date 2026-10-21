import { calendarDaysBetween, countdownDays, isCountdownDue, whenPhrase, whenText, whenTickMs } from "./countdownRule";

// #1264: Countdown nur, wenn es bald so weit ist. Alle Zeiten in Wiener Uhr; die Uhr steht fest.
const NOW = Date.parse("2026-10-07T10:00:00+02:00"); // Mi 7. Oktober 2026, 10:00
const at = (text) => Date.parse(text);
const text = (target, options) => whenText(target, { now: NOW, ...options })?.text;

test("mehr als 60 Tage: der Monat, kein Countdown - 154 Tage sind „im März“", () => {
  expect(text(at("2027-03-10T14:00:00+01:00"))).toBe("im März");
  expect(whenText(at("2027-03-10T14:00:00+01:00"), { now: NOW }).mode).toBe("month");
  // 61 Tage: noch der Monat; Wiener Monatsnamen („Jänner“).
  expect(text(at("2026-12-07T12:00:00+01:00"))).toBe("im Dezember");
  expect(text(at("2027-01-20T12:00:00+01:00"))).toBe("im Jänner");
  // Weiter als ein knappes Jahr: mit Jahr.
  expect(text(at("2027-10-01T12:00:00+02:00"))).toBe("im Oktober 2027");
});

test("15 bis 60 Tage: das Datum, mehrtägig als Bereich", () => {
  expect(text(at("2026-12-06T12:00:00+01:00"))).toBe("So 6. Dezember"); // genau 60 Tage
  expect(text(at("2026-11-14T18:00:00+01:00"))).toBe("Sa 14. November");
  expect(text(at("2026-10-22T18:00:00+02:00"))).toBe("Do 22. Oktober"); // 15 Tage
  expect(text(at("2026-11-12T10:00:00+01:00"), { end: at("2026-11-15T20:00:00+01:00") })).toBe("Do 12. – So 15. November");
  expect(text(at("2026-10-30T10:00:00+01:00"), { end: at("2026-11-01T20:00:00+01:00") })).toBe("Fr 30. Oktober – So 1. November");
  // Ein Ende am selben Tag ist kein Bereich.
  expect(text(at("2026-11-14T18:00:00+01:00"), { end: at("2026-11-14T23:00:00+01:00") })).toBe("Sa 14. November");
});

test("ab 14 Tagen der Countdown in Tagen, ohne Abkürzungen", () => {
  expect(text(at("2026-10-21T18:00:00+02:00"))).toBe("in 14 Tagen");
  expect(text(at("2026-10-20T08:00:00+02:00"))).toBe("in 13 Tagen");
  expect(text(at("2026-10-10T09:00:00+02:00"))).toBe("in 3 Tagen");
  expect(text(at("2026-10-09T23:59:00+02:00"))).toBe("in 2 Tagen");
});

test("Vortag und Tag selbst: „morgen 14:00“, „heute 14:00“, in der letzten Stunde Minuten", () => {
  expect(text(at("2026-10-08T00:30:00+02:00"))).toBe("morgen 00:30");
  expect(text(at("2026-10-08T14:00:00+02:00"))).toBe("morgen 14:00");
  expect(text(at("2026-10-07T14:00:00+02:00"))).toBe("heute 14:00");
  expect(text(at("2026-10-07T23:59:00+02:00"))).toBe("heute 23:59");
  expect(text(at("2026-10-07T10:45:00+02:00"))).toBe("in 45 Minuten");
  expect(text(at("2026-10-07T10:01:00+02:00"))).toBe("in 1 Minute");
  expect(text(at("2026-10-07T10:00:30+02:00"))).toBe("in unter einer Minute");
  expect(text(NOW)).toBe("jetzt");
  expect(text(NOW - 1000)).toBe("jetzt");
});

test("die Schwelle ist einstellbar - Vorgabe 14, nur 1 bis 60 Tage gelten", () => {
  expect(text(at("2026-10-27T12:00:00+01:00"), { days: 30 })).toBe("in 20 Tagen");
  expect(text(at("2026-10-27T12:00:00+01:00"))).toBe("Di 27. Oktober");
  expect(text(at("2026-10-10T09:00:00+02:00"), { days: 2 })).toBe("Sa 10. Oktober");
  expect(countdownDays(undefined)).toBe(14);
  expect(countdownDays(null)).toBe(14);
  expect(countdownDays("")).toBe(14);
  expect(countdownDays(0)).toBe(14);
  expect(countdownDays(61)).toBe(14);
  expect(countdownDays(2.5)).toBe(14);
  expect(countdownDays(7)).toBe(7);
  expect(countdownDays("21")).toBe(21);
});

test("Wiener Kalendertage über die Zeitumstellung (25. Oktober 2026) - nicht 24-Stunden-Schritte", () => {
  const evening = at("2026-10-24T22:30:00+02:00"); // Sa vor der Umstellung
  // 26 Stunden später, aber zwei Kalendertage: „in 2 Tagen“, nicht „morgen“.
  expect(whenText(at("2026-10-26T00:30:00+01:00"), { now: evening }).text).toBe("in 2 Tagen");
  // Der Sonntag hat 25 Stunden: 23:30 am Sonntag ist „morgen“.
  expect(whenText(at("2026-10-25T23:30:00+01:00"), { now: evening }).text).toBe("morgen 23:30");
  expect(calendarDaysBetween(evening, at("2026-10-25T00:10:00+02:00"))).toBe(1);
  // Frühjahr (29. März 2026): der Sonntag hat 23 Stunden.
  const march = at("2026-03-28T23:30:00+01:00");
  expect(whenText(at("2026-03-29T23:45:00+02:00"), { now: march }).text).toBe("morgen 23:45");
  expect(whenText(at("2026-03-30T00:15:00+02:00"), { now: march }).text).toBe("in 2 Tagen");
});

test("ohne gültigen Zeitpunkt nichts; Texte vom Server gehen auch", () => {
  expect(whenText(null, { now: NOW })).toBeNull();
  expect(whenText("kaputt", { now: NOW })).toBeNull();
  expect(text("2026-10-08T12:00:00+00:00")).toBe("morgen 14:00");
});

test("mit Verb: „startet am …“ nur beim Datum, sonst der Text dahinter", () => {
  const options = { now: NOW };
  expect(whenPhrase("startet", whenText(at("2027-03-10T14:00:00+01:00"), options))).toBe("startet im März");
  expect(whenPhrase("startet", whenText(at("2026-11-14T18:00:00+01:00"), options))).toBe("startet am Sa 14. November");
  expect(whenPhrase("startet", whenText(at("2026-10-10T09:00:00+02:00"), options))).toBe("startet in 3 Tagen");
  expect(whenPhrase("Check-in", whenText(at("2026-10-08T14:00:00+02:00"), options))).toBe("Check-in morgen 14:00");
  expect(whenPhrase("", whenText(at("2026-11-14T18:00:00+01:00"), options))).toBe("Sa 14. November");
  expect(whenPhrase("startet", null)).toBe("");
});

test("isCountdownDue: nur innerhalb der Schwelle und in der Zukunft", () => {
  expect(isCountdownDue(at("2026-10-21T18:00:00+02:00"), { now: NOW })).toBe(true);
  expect(isCountdownDue(at("2026-10-22T18:00:00+02:00"), { now: NOW })).toBe(false);
  expect(isCountdownDue(at("2026-10-22T18:00:00+02:00"), { now: NOW, days: 30 })).toBe(true);
  expect(isCountdownDue(NOW - 1, { now: NOW })).toBe(false);
  expect(isCountdownDue("kaputt", { now: NOW })).toBe(false);
});

test("whenTickMs: in der letzten Stunde öfter", () => {
  expect(whenTickMs(NOW + 30 * 60000, NOW)).toBe(15000);
  expect(whenTickMs(NOW + 3 * 3600000, NOW)).toBe(60000);
  expect(whenTickMs(NOW - 1, NOW)).toBeNull();
});
