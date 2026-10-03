import { mulberry32 } from "../rng";
import { DIGIT_STROKES, GLYPH_PITCH, YEAR_CLEAR_TOP, YEAR_FALL, YEAR_FORM, YEAR_HOLD, YEAR_RISE, YEAR_SALVO_DELAY_MS, YEAR_STAGGER_MS, YEAR_STARS, YEAR_TRICKLE, calmYearDots, glyphCounts, glyphLength, glyphPoints, glyphSpot, isGlyph, yearDuration, yearLaunches, yearStarAt, yearStarCount, yearStarLight, yearStars, yearText } from "./yearDigits";

// Die Jahreszahl um 00:00 (#853): eine Strichschrift, aus der die Funken die Ziffern formen - gleich dicht auf allen
// Ziffern, mittig unter der Gruß-Karte, nie breiter als das Fenster; Form, Stehen, Rieseln nach der Uhr.

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

test("Schrift: alle zehn Ziffern, gleichmäßig belegt, im Kasten; geschlossene Schleifen ohne doppelten Punkt", () => {
  expect(Object.keys(DIGIT_STROKES)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  for (const digit of Object.keys(DIGIT_STROKES)) {
    const points = glyphPoints(digit, 40);
    expect(points.length, digit).toBeGreaterThanOrEqual(36);
    expect(points.length, digit).toBeLessThanOrEqual(44);
    points.forEach(([x, y]) => {
      expect(Math.abs(x), digit).toBeLessThanOrEqual(0.31);
      expect(Math.abs(y), digit).toBeLessThanOrEqual(0.5);
    });
    // Kein Punkt doppelt: sonst stünden dort zwei Funken übereinander und leuchteten doppelt.
    expect(new Set(points.map(([x, y]) => `${x}:${y}`)).size, digit).toBe(points.length);
  }
  // Die Null ist eine Schleife: der Abstand zwischen Nachbarn ist überall gleich, auch über den Stoß.
  const zero = glyphPoints("0", 30);
  const gaps = zero.map(([x, y], i) => Math.hypot(x - zero[(i + 1) % zero.length][0], y - zero[(i + 1) % zero.length][1]));
  expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.6);
  // Die Eins ist kurz, die Acht lang - danach richtet sich die Zahl der Funken.
  expect(glyphLength("1")).toBeLessThan(glyphLength("7"));
  expect(glyphLength("8")).toBeGreaterThan(glyphLength("0"));
  expect(glyphPoints("x", 30)).toEqual([]);
});

test("Funken je Ziffer nach der Länge ihrer Striche; die Zahl bekommt einen festen Anteil am Budget", () => {
  const counts = glyphCounts("2027", 150);
  expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(148);
  expect(counts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(152);
  expect(counts[3]).toBeLessThan(counts[1]);
  expect(glyphCounts("1111", 20).every((count) => count >= 10)).toBe(true);
  expect([yearStarCount(200), yearStarCount(600), yearStarCount(100), yearStarCount(0)]).toEqual([150, YEAR_STARS.max, 75, YEAR_STARS.min]);
});

test("Jahreszahl: nur Ziffern, höchstens vier; ohne Zahl keine Raketen", () => {
  expect(yearText(2027)).toBe("2027");
  expect(yearText("2031")).toBe("2031");
  expect(yearText(null)).toBe("");
  expect(yearText("20x27")).toBe("2027");
  expect(yearLaunches(null, 0)).toEqual([]);
});

test("Platz: mittig, unter der Gruß-Karte, nie breiter als 80 % des Fensters - am PC und am Handy", () => {
  for (const size of [DESKTOP, PHONE, { width: 360, height: 640 }, { width: 2560, height: 1440 }, { width: 844, height: 390 }]) {
    const spots = [0, 1, 2, 3].map((slot) => glyphSpot(slot, 4, size));
    const left = spots[0].x - spots[0].height * 0.3;
    const right = spots[3].x + spots[3].height * 0.3;
    expect((left + right) / 2).toBeCloseTo(size.width / 2, 0);
    expect(right - left).toBeLessThanOrEqual(size.width * 0.8 + 1);
    expect(spots[0].y - spots[0].height / 2).toBeGreaterThanOrEqual(YEAR_CLEAR_TOP - 0.1);
    expect(spots[1].x - spots[0].x).toBeCloseTo(GLYPH_PITCH * spots[0].height, 0);
  }
  expect(glyphSpot(0, 4, DESKTOP).height).toBe(153);
  expect(glyphSpot(0, 4, PHONE).height).toBeLessThan(110);
});

test("Raketen der Zahl: je Ziffer eine, kurz nacheinander, groß und nah; die Salve wartet, bis die Zahl rieselt", () => {
  const launches = yearLaunches(2027, 1_000_000);
  expect(launches.map((launch) => launch.glyph)).toEqual(["2", "0", "2", "7"]);
  expect(launches.map((launch) => launch.at - 1_000_000)).toEqual([0, YEAR_STAGGER_MS, 2 * YEAR_STAGGER_MS, 3 * YEAR_STAGGER_MS]);
  expect(launches.every((launch) => launch.id.startsWith("salvo:year:") && launch.caliber === "large" && launch.rise === YEAR_RISE && isGlyph(launch))).toBe(true);
  expect(isGlyph({ type: "peony" })).toBe(false);
  // Die gewohnte Salve beginnt, wenn die Zahl steht und zu rieseln beginnt - nicht vorher.
  expect(YEAR_SALVO_DELAY_MS / 1000).toBeGreaterThanOrEqual(YEAR_RISE + YEAR_FORM + YEAR_HOLD - 0.1);
});

test("Funken einer Ziffer: Ziele auf dem Strich, gold mit etwas Weiß; fest aus der Saat", () => {
  const [two] = yearLaunches(2027, 0);
  const stars = yearStars(two, mulberry32(3), DESKTOP, 150);
  const spot = glyphSpot(0, 4, DESKTOP);
  expect(stars).toHaveLength(glyphCounts("2027", 150)[0]);
  stars.forEach((star) => {
    expect(Math.abs(star.tx)).toBeLessThanOrEqual(spot.height * 0.31);
    expect(Math.abs(star.ty)).toBeLessThanOrEqual(spot.height * 0.5 + 0.1);
    expect(["gold", "white"]).toContain(star.color);
    expect(star.fall).toBeGreaterThanOrEqual(0);
    expect(star.fall).toBeLessThanOrEqual(YEAR_TRICKLE);
  });
  expect(stars.filter((star) => star.color === "gold").length).toBeGreaterThan(stars.length / 2);
  expect(yearStars(two, mulberry32(3), DESKTOP, 150)).toEqual(stars);
});

test("Ablauf: fliegt in die Form, steht lesbar, rieselt herab und erlischt", () => {
  const star = { tx: 40, ty: -30, size: 2, color: "gold", glitter: 1, fall: 0.3, vx: 5 };
  const origin = { x: 500, y: 400 };
  expect(yearStarAt(star, 0, origin)).toEqual(origin);
  const formed = yearStarAt(star, YEAR_FORM, origin);
  expect(formed).toEqual({ x: 540, y: 370 });
  // Im Stehen sinkt sie kaum (wenige Pixel) - die Zahl bleibt lesbar.
  const standing = yearStarAt(star, YEAR_FORM + YEAR_HOLD, origin);
  expect(standing.y - formed.y).toBeLessThan(10);
  expect(Math.abs(standing.x - formed.x)).toBeLessThan(0.5);
  const fallen = yearStarAt(star, YEAR_FORM + YEAR_HOLD + star.fall + 2, origin);
  expect(fallen.y - standing.y).toBeGreaterThan(30);
  // Licht: im Stehen hell, beim Rieseln zur Glut, danach aus.
  expect(yearStarLight(star, 0).alpha).toBe(1);
  for (const age of [YEAR_FORM + 0.2, YEAR_FORM + 1, YEAR_FORM + 2.4]) expect(yearStarLight(star, age).alpha).toBeGreaterThan(0.75);
  const late = yearStarLight(star, YEAR_FORM + YEAR_HOLD + star.fall + YEAR_FALL * 0.8);
  expect(late.ember).toBe(1);
  expect(late.alpha).toBeLessThan(0.3);
  expect(yearStarLight(star, YEAR_FORM + YEAR_HOLD + star.fall + YEAR_FALL).alpha).toBe(0);
  expect(yearDuration({ rise: YEAR_RISE })).toBeCloseTo(YEAR_RISE + YEAR_FORM + YEAR_HOLD + YEAR_TRICKLE + YEAR_FALL + 0.2, 2);
});

test("ruhige Zahl (dezent): dieselben Punkte fertig geformt an derselben Stelle", () => {
  const dots = calmYearDots(2027, DESKTOP);
  expect(dots.length).toBeGreaterThanOrEqual(110);
  expect(dots.length).toBeLessThanOrEqual(124);
  const spot = glyphSpot(0, 4, DESKTOP);
  expect(Math.min(...dots.map((dot) => dot.y))).toBeGreaterThanOrEqual(spot.y - spot.height / 2 - 0.1);
  expect(dots.some((dot) => dot.white)).toBe(true);
  expect(calmYearDots(null, DESKTOP)).toEqual([]);
});
