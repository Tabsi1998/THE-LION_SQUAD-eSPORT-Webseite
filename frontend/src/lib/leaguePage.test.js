import { blockedLines, dayRange, defaultSlot, matchWhen, openWeek, pointsLine, progressLine, scoreLine, seasonPeriod, weekHeading, weekSpan, winnerSide } from "./leaguePage";

// Ligaseite (docs/LIGA.md, P5, #1625): Kopf, Spielwochen und Ergebnisse in Worten - Season 1 als Beispiel.

const SEASON = {
  start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00", matchday_days: 7,
  default_match_weekday: 6, default_match_time: "20:00", match_points: { win: 3, draw: 1, loss: 0 },
  blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }],
};

test("Kopf der Season in Worten", () => {
  expect(seasonPeriod(SEASON)).toBe("10.11.2026 – 18.1.2027");
  expect(weekSpan(SEASON)).toBe("Spielwoche Di–Mo");
  expect(weekSpan({ ...SEASON, matchday_days: 3 })).toBe("Spielwoche 3 Tage");
  expect(defaultSlot(SEASON)).toBe("Sonntag, 20:00 Uhr");
  expect(pointsLine(SEASON)).toBe("3 / 1 / 0");
  expect(blockedLines(SEASON)).toEqual([{ key: "2026-12-21-2027-01-03", label: "Weihnachtspause", range: "21.12.–3.1." }]);
  expect(dayRange("2026-12-24", "2026-12-24")).toBe("24.12.");
});

test("Spielwochen und Spiele", () => {
  expect(weekHeading({ week: 9, first_day: "2027-01-05", last_day: "2027-01-11" })).toBe("Woche 9 · 5.1.–11.1.");
  const done = { done: true, home: { registration_id: "a", score: 2 }, away: { registration_id: "b", score: 1 }, winner_registration_id: "a" };
  expect(scoreLine(done)).toBe("2 : 1");
  expect(winnerSide(done)).toBe("home");
  expect(scoreLine({ done: false, home: {}, away: {} })).toBe("");
  expect(matchWhen({ scheduled_at: "2027-01-10T19:00:00+00:00" })).toMatch(/10\.1\..*20:00/);
  expect(matchWhen({})).toBe("Termin offen");
  expect(progressLine({ matches: [done, { done: false }] })).toBe("1 von 2 gespielt");
  expect(progressLine({ matches: [done] })).toBe("alle gespielt");
});

test("Welche Woche offen ist: die laufende, sonst die erste mit offenem Spiel", () => {
  const weeks = [{ week: 1, matches: [{ done: true }] }, { week: 2, matches: [{ done: false }] }, { week: 3, matches: [] }];
  expect(openWeek(weeks, 3)).toBe(3);
  expect(openWeek(weeks, 99)).toBe(2);
  expect(openWeek([{ week: 1, matches: [{ done: true }] }], null)).toBe(1);
  expect(openWeek([], 1)).toBeNull();
});
