import { adventSundays, candlesLit, daysSince, daysToChristmas, firstAdvent, fourthAdvent, todayIso } from "./calendar";

// Adventrechnung (S6): dieselben Sonntage wie der Server; Kerzen je Sonntag, der schon war; Tage bis Heiligabend.

test("Adventsonntage: 2026 vom 29. November bis 20. Dezember, 2027 vom 28. November, 2028 vom 3. Dezember (Heiligabend ist ein Sonntag)", () => {
  expect(fourthAdvent(2026)).toBe("2026-12-20");
  expect(firstAdvent(2026)).toBe("2026-11-29");
  expect(adventSundays(2026)).toEqual(["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"]);
  expect(adventSundays(2027)).toEqual(["2027-11-28", "2027-12-05", "2027-12-12", "2027-12-19"]);
  expect(adventSundays(2028)).toEqual(["2028-12-03", "2028-12-10", "2028-12-17", "2028-12-24"]);
  expect(adventSundays(2023)).toEqual(["2023-12-03", "2023-12-10", "2023-12-17", "2023-12-24"]);
});

test("Kerzen: je Sonntag eine - am Samstag davor noch nicht", () => {
  expect(candlesLit("2026-11-28")).toBe(0);
  expect(candlesLit("2026-11-29")).toBe(1);
  expect(candlesLit("2026-12-05")).toBe(1);
  expect(candlesLit("2026-12-06")).toBe(2);
  expect(candlesLit("2026-12-13")).toBe(3);
  expect(candlesLit("2026-12-19")).toBe(3);
  expect(candlesLit("2026-12-20")).toBe(4);
  expect(candlesLit("2026-12-26")).toBe(4);
  expect(candlesLit("2026-12-07T18:00:00+01:00", ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"])).toBe(2);
});

test("Tage bis Heiligabend, Tage seit dem Anzünden, heutiger Tag", () => {
  expect(daysToChristmas("2026-12-07")).toBe(17);
  expect(daysToChristmas("2026-12-24")).toBe(0);
  expect(daysToChristmas("2026-12-26")).toBe(0);
  expect(daysSince("2026-11-29", "2026-12-07")).toBe(8);
  expect(daysSince("2026-12-06", "2026-12-06")).toBe(0);
  expect(daysSince("2026-12-13", "2026-12-07")).toBe(0);
  expect(todayIso(new Date(2026, 11, 7, 23, 30))).toBe("2026-12-07");
  expect(todayIso(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
});
