// Der Gruß-Merker zählt nach dem Tag am Gerät, nicht nach UTC: in Wien begann der Tag sonst erst um 01:00 - wer zu
// Silvester die Null um Mitternacht sah, bekam den Neujahrsgruß nach 01:00 noch einmal. Die Zeitzone ist hier fest Wien,
// damit der Test auch auf einem Rechner in UTC (GitHub) greift.

const previousTz = process.env.TZ;
process.env.TZ = "Europe/Vienna";

const { localDay, markToastShown, toastShownToday } = await import("./SeasonStage");

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test("der Tag am Gerät, auch in der ersten Stunde nach Mitternacht", () => {
  expect(localDay(new Date("2027-01-01T00:30:00+01:00"))).toBe("2027-01-01");
  expect(localDay(new Date("2026-12-31T23:59:00+01:00"))).toBe("2026-12-31");
  expect(localDay(new Date("2027-07-01T01:30:00+02:00"))).toBe("2027-07-01");
});

test("einmal gezeigt um 00:30 heißt: am selben Tag nicht noch einmal - am nächsten schon", () => {
  markToastShown("new-year-greeting", new Date("2027-01-01T00:30:00+01:00"));
  expect(toastShownToday("new-year-greeting", new Date("2027-01-01T01:30:00+01:00"))).toBe(true);
  expect(toastShownToday("new-year-greeting", new Date("2027-01-01T23:59:00+01:00"))).toBe(true);
  expect(toastShownToday("new-year-greeting", new Date("2027-01-02T00:00:30+01:00"))).toBe(false);
  // Silvesterabend um 23:30 ist noch der alte Tag.
  expect(toastShownToday("new-year-greeting", new Date("2026-12-31T23:30:00+01:00"))).toBe(false);
});
