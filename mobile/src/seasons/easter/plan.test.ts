import { EGG_PATTERNS, butterflyFlight, createPetal, easterDay, edgeCount, greetingDay, isQuiet, nextDelay, peekSpot, petalCount, petalPose, rowPatterns, stepPetal, viennaDate } from "./plan";

// Ostern in der App ohne React (wie im Web): die Tage nach dem Wiener Datum 2027 bis 2030, Karfreitag still, Gruß am
// Ostersonntag und -montag; verschiedene Muster; der Hase nur über freien Karten-Oberkanten; wenige Blätter, die
// sinken, beim Scrollen mitziehen und unten raus oben neu kommen.

const SUNDAYS = ["2027-03-28", "2028-04-16", "2029-04-01", "2030-04-21"];

function noon(sunday: string, offset: number): Date {
  const [y, m, d] = sunday.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset, 10, 0, 0));
}

test("die Ostertage 2027 bis 2030 nach dem Wiener Datum", () => {
  for (const sunday of SUNDAYS) {
    const season = { data: { sunday, quiet: false } };
    expect(easterDay(season, noon(sunday, -7))).toBe("palm");
    expect(easterDay(season, noon(sunday, -2))).toBe("friday");
    expect(easterDay(season, noon(sunday, 0))).toBe("sunday");
    expect(easterDay(season, noon(sunday, 1))).toBe("monday");
    expect(isQuiet(season, noon(sunday, -2))).toBe(true);
    expect(greetingDay(season, noon(sunday, -1))).toBe(false);
    expect(greetingDay(season, noon(sunday, 0)) && greetingDay(season, noon(sunday, 1))).toBe(true);
  }
  expect(viennaDate(new Date("2027-03-27T23:30:00Z"))).toBe("2027-03-28");
  expect(isQuiet({ data: { quiet: true } })).toBe(true);
});

test("verschiedene Muster aus zwölf; schmale Geräte bekommen vier Eier", () => {
  const five = rowPatterns(9, 5);
  expect(new Set(five).size).toBe(5);
  five.forEach((pattern) => expect(EGG_PATTERNS).toContain(pattern));
  expect(rowPatterns(9, 5)).toEqual(five);
  expect(edgeCount(340)).toBe(4);
  expect(edgeCount(393)).toBe(5);
});

test("Falter, Takte und der Hase über der ersten freien Karten-Oberkante", () => {
  const flight = butterflyFlight(() => 0.5);
  expect(flight.y).toBeGreaterThanOrEqual(0.22);
  expect(flight.seconds).toBe(10);
  expect(nextDelay(() => 0.5, [480, 900])).toBe(690000);
  const cards = [
    { x: 16, y: 60, width: 360, height: 120 },
    { x: 16, y: 300, width: 360, height: 120 },
    { x: 16, y: 900, width: 360, height: 120 },
  ];
  expect(peekSpot(cards, { top: 80, bottom: 780 })).toEqual({ x: Math.round(16 + 360 * 0.78 - 13), y: 270 });
  expect(peekSpot([{ x: 0, y: 300, width: 100, height: 50 }], { top: 80, bottom: 780 })).toBeNull();
});

test("Blätter: lebendige Screens vier, mittlere zwei, stille keine; sinken, ziehen beim Scrollen mit, kommen oben neu", () => {
  expect(petalCount("Dashboard", "normal")).toBe(4);
  expect(petalCount("Dashboard", "full")).toBe(6);
  expect(petalCount("Dashboard", "subtle")).toBe(0);
  expect(petalCount("AdminHome", "normal")).toBe(0);
  const rng = () => 0.5;
  const petal = createPetal(rng, 400, 800);
  expect(petal.y).toBeLessThan(0);
  const later = stepPetal(petal, 1, 0, 400, 800, rng);
  expect(later.y).toBeCloseTo(petal.y + petal.fall);
  const scrolled = stepPetal(later, 0, 120, 400, 800, rng);
  expect(scrolled.y).toBeCloseTo(later.y - 120);
  expect(stepPetal({ ...petal, y: 900 }, 0.1, 0, 400, 800, rng).y).toBeLessThan(0);
  const swing = [0, 0.4, 0.8].map((t) => petalPose({ ...petal, t }).x);
  expect(Math.max(...swing) - Math.min(...swing)).toBeGreaterThan(4);
});
