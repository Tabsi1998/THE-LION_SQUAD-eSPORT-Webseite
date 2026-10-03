import { PATTERN_NAMES } from "../easterHunt/EggShape";
import { MEADOW_HEIGHT, ROW_HEIGHT, areaFree, butterflyFlight, contentRects, easterDay, freeAt, freeMeadow, greetingDay, isQuiet, meadowPlan, momentRng, nextDelay, peekSpot, rowCount, rowPatterns, rowSpot, rowWidth, viennaDate } from "./plan";

// Ostern ohne React (#645, #753, #756): die Tage nach dem Wiener Datum (2027 bis 2030), Karfreitag still, Gruß nur
// am Ostersonntag und -montag; die Reihe mit verschiedenen Mustern nur, wo nichts steht; die Wiese je Jahr und
// Seite fest; der Hase nur über freien Karten-Oberkanten.

const SUNDAYS = { 2027: "2027-03-28", 2028: "2028-04-16", 2029: "2029-04-01", 2030: "2030-04-21" };

function easter(sunday, quiet = false) {
  return { key: "easter", data: { sunday, quiet }, starts_at: `${sunday}T00:00:00+02:00` };
}

/** Mittag (Wien) an einem Tag relativ zum Ostersonntag. */
function noon(sunday, offset) {
  const [y, m, d] = sunday.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset, 10, 0, 0));
}

test("die Ostertage 2027 bis 2030 - nach dem Wiener Datum, auch kurz nach Mitternacht", () => {
  for (const sunday of Object.values(SUNDAYS)) {
    const season = easter(sunday);
    expect(easterDay(season, noon(sunday, -7))).toBe("palm");
    expect(easterDay(season, noon(sunday, -4))).toBe("week");
    expect(easterDay(season, noon(sunday, -2))).toBe("friday");
    expect(easterDay(season, noon(sunday, -1))).toBe("saturday");
    expect(easterDay(season, noon(sunday, 0))).toBe("sunday");
    expect(easterDay(season, noon(sunday, 1))).toBe("monday");
    expect(isQuiet(season, noon(sunday, -2))).toBe(true);
    expect(isQuiet(season, noon(sunday, 0))).toBe(false);
    expect([-7, -2, -1].some((offset) => greetingDay(season, noon(sunday, offset)))).toBe(false);
    expect(greetingDay(season, noon(sunday, 0)) && greetingDay(season, noon(sunday, 1))).toBe(true);
  }
  // 00:30 in Wien ist in UTC noch der Vortag - es zählt Wien.
  expect(viennaDate(new Date("2027-03-27T23:30:00Z"))).toBe("2027-03-28");
  expect(easterDay(easter(SUNDAYS[2027]), new Date("2027-03-27T23:30:00Z"))).toBe("sunday");
  // Ohne Datum gilt, was der Server sagt.
  expect(isQuiet({ data: { quiet: true } })).toBe(true);
  expect(easterDay({ data: {} })).toBe("week");
});

test("die Reihe: verschiedene Muster aus zwölf, je Aufruf neu gemischt, bei gleicher Saat gleich", () => {
  const six = rowPatterns(42, 6);
  expect(new Set(six).size).toBe(6);
  six.forEach((pattern) => expect(PATTERN_NAMES).toContain(pattern));
  expect(rowPatterns(42, 6)).toEqual(six);
  expect(rowPatterns(43, 6)).not.toEqual(six);
  expect(rowCount(390)).toBe(3);
  expect(rowCount(1440)).toBe(6);
});

test("die Reihe liegt rechts in der Spalte - steht dort etwas, in der Mitte - sonst gar nicht", () => {
  const header = { left: 0, right: 1440, top: 0, bottom: 80 };
  const column = { left: 80, right: 1360 };
  const right = rowSpot(header, column, 1440, () => true);
  expect(right).toEqual({ left: 1360 - rowWidth(6), top: 86, width: rowWidth(6), count: 6 });
  const blockedRight = (x) => x < 1000;
  const middle = rowSpot(header, column, 1440, blockedRight);
  expect(middle.left).toBe(Math.round((1440 - rowWidth(6)) / 2));
  expect(rowSpot(header, column, 1440, () => false)).toBeNull();
  expect(ROW_HEIGHT).toBeGreaterThan(20);
});

test("die Wiese: fest je Jahr und Seite, innerhalb der Breite, auf kleinen Seiten weniger", () => {
  const plan = meadowPlan(1200, { year: 2027, route: "/" });
  expect(meadowPlan(1200, { year: 2027, route: "/" })).toEqual(plan);
  expect(meadowPlan(1200, { year: 2028, route: "/" })).not.toEqual(plan);
  plan.forEach((item) => expect(item.x).toBeLessThan(1200 - 14));
  expect(plan.some((item) => item.kind !== "grass")).toBe(true);
  plan.filter((item) => item.kind !== "grass").forEach((item) => expect(item.height).toBeLessThan(MEADOW_HEIGHT));
  expect(meadowPlan(1200, { year: 2027, route: "/", small: true }).length).toBeLessThan(plan.length);
});

test("Falter und Hase: Flüge im Rahmen, Pausen nach den Takten, der Hase nur über freien Oberkanten", () => {
  const rng = momentRng(7);
  const flight = butterflyFlight(rng);
  expect(flight.y).toBeGreaterThanOrEqual(0.18);
  expect(flight.y).toBeLessThanOrEqual(0.68);
  expect(flight.seconds).toBeGreaterThanOrEqual(8);
  expect(nextDelay(() => 0.5, [120, 180])).toBe(150000);
  expect(nextDelay(() => 0.5, [240, 480], 2)).toBe(720000);

  const cards = [
    { left: 100, right: 400, top: 60, bottom: 260, width: 300 },
    { left: 100, right: 400, top: 320, bottom: 520, width: 300 },
    { left: 500, right: 600, top: 320, bottom: 520, width: 100 },
  ];
  // Die erste Karte klebt an der Kopfzeile, die dritte ist zu schmal: der Hase guckt über der zweiten.
  const spot = peekSpot(cards, { headerBottom: 64, innerHeight: 800 }, () => true);
  expect(spot).toEqual({ left: Math.round(100 + 300 * 0.78 - 15), top: 320 - 32 });
  // Über der zweiten Karte steht rechts Text: dann links.
  const left = peekSpot(cards, { headerBottom: 64, innerHeight: 800 }, (x) => x < 250);
  expect(left.left).toBe(Math.round(100 + 300 * 0.22 - 15));
  expect(peekSpot(cards, { headerBottom: 64, innerHeight: 800 }, () => false)).toBeNull();
});

test("frei heißt: keine Schrift, kein Bild, kein Knopf - eigene Ebenen zählen nicht; ohne Layout ist alles frei", () => {
  const text = document.createElement("p");
  text.textContent = "News";
  text.getClientRects = () => [];
  const button = document.createElement("button");
  const own = document.createElement("div");
  own.className = "tls-easter-layer";
  document.body.append(text, button, own);
  const doc = { body: document.body, documentElement: document.documentElement, elementsFromPoint: (x) => (x < 10 ? [own, document.body] : x < 20 ? [own, button, document.body] : [document.body]) };
  expect(freeAt(doc, 5, 5)).toBe(true);
  expect(freeAt(doc, 15, 5)).toBe(false);
  expect(freeAt(doc, 25, 5)).toBe(true);
  expect(freeAt(null, 1, 1)).toBe(true);
  expect(areaFree({ left: 0, top: 0, right: 30, bottom: 20 }, (x) => x < 25)).toBe(false);
  expect(areaFree({ left: 0, top: 0, right: 30, bottom: 20 }, () => true)).toBe(true);
  document.body.innerHTML = "";
});

test("die Wiese lässt aus, was über Schrift oder Bildern stünde - der Rest bleibt", () => {
  const items = [
    { x: 10, kind: "daisy", height: 20 },
    { x: 60, kind: "grass", width: 16, height: 9, blades: 3 },
    { x: 120, kind: "tulip", height: 18 },
  ];
  expect(freeMeadow(items, [])).toBe(items);
  // Ein Link reicht von x 50 bis 80 bis in die untersten 6 px der Wiese: das Büschel dort fällt weg.
  expect(freeMeadow(items, [{ left: 50, right: 80, top: 20, bottom: 40 }]).map((item) => item.x)).toEqual([10, 120]);
  expect(contentRects(null, { left: 0, right: 10, top: 0, bottom: 10 })).toEqual([]);
});
