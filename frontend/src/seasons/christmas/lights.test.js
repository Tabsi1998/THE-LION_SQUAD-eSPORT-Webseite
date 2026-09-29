import { BAND_HEIGHT, COLORS, INSET, MIN_WIDTH, chainLayout, inGap, wirePath, wireY } from "./lights";

// Lichterkette (S8, X1): aus dem Jahres-Seed, Nägel und durchhängende Abschnitte, Lämpchen im Band mit eigener Farbe
// (nie zwei gleiche nebeneinander), Helligkeit, Glimmen und seltenem Flackern; Lücken ohne Lämpchen.

test("Kette aus dem Jahres-Seed: gleich im Jahr, anders je Jahr und Anker; Nägel, Abschnitte, Lämpchen im Band, jedes anders", () => {
  const a = chainLayout({ width: 1200, year: 2026 });
  expect(chainLayout({ width: 1200, year: 2026 })).toEqual(a);
  expect(JSON.stringify(chainLayout({ width: 1200, year: 2027 }))).not.toBe(JSON.stringify(a));
  expect(JSON.stringify(chainLayout({ width: 1200, year: 2026, anchor: "footer" }))).not.toBe(JSON.stringify(a));
  expect(a.nails[0]).toBe(INSET);
  expect(a.nails[a.nails.length - 1]).toBe(1200 - INSET);
  expect(a.nails.length).toBeGreaterThanOrEqual(5);
  expect(a.segments).toHaveLength(a.nails.length - 1);
  a.segments.forEach((segment) => {
    expect(segment.sag).toBeGreaterThan(0);
    expect(segment.sag).toBeLessThanOrEqual((BAND_HEIGHT - 8) * 0.9);
    expect(segment.to).toBeGreaterThan(segment.from);
  });
  expect(a.bulbs.length).toBeGreaterThanOrEqual(15);
  a.bulbs.forEach((bulb, index) => {
    expect(bulb.y + bulb.radius).toBeLessThanOrEqual(BAND_HEIGHT);
    expect(bulb.wire).toBeLessThan(bulb.y);
    expect(Object.keys(COLORS)).toContain(bulb.color);
    expect(bulb.x).toBeGreaterThan(INSET);
    expect(bulb.x).toBeLessThan(1200 - INSET);
    if (index) expect(bulb.color).not.toBe(a.bulbs[index - 1].color);
    expect(bulb.brightness).toBeGreaterThanOrEqual(0.7);
    expect(bulb.glowDelay).toBeLessThanOrEqual(0);
  });
  expect(new Set(a.bulbs.map((bulb) => `${bulb.glowDuration}:${bulb.glowDelay}:${bulb.brightness}`)).size).toBe(a.bulbs.length);
  expect(a.bulbs.some((bulb) => bulb.flicker)).toBe(true);
  expect(a.bulbs.filter((bulb) => bulb.flicker).length).toBeLessThan(a.bulbs.length / 2);
  expect(a.wire.startsWith(`M ${INSET.toFixed(1)} 1`)).toBe(true);
  expect(a.wire.split(" Q ").length - 1).toBe(a.segments.length);
});

test("Lücken: wo Logo oder Knopf ins Band ragen, bleibt der Draht, aber kein Lämpchen - die anderen bleiben, wie sie sind", () => {
  const plain = chainLayout({ width: 1200, year: 2026 });
  const gapped = chainLayout({ width: 1200, year: 2026, gaps: [[20, 260]] });
  expect(gapped.wire).toBe(plain.wire);
  expect(gapped.bulbs.length).toBeLessThan(plain.bulbs.length);
  expect(gapped.bulbs.every((bulb) => bulb.x < 20 || bulb.x > 260)).toBe(true);
  const kept = plain.bulbs.filter((bulb) => !inGap(bulb.x, [[20, 260]]));
  expect(gapped.bulbs.map((bulb) => `${bulb.x}:${bulb.color}:${bulb.glowDuration}`)).toEqual(kept.map((bulb) => `${bulb.x}:${bulb.color}:${bulb.glowDuration}`));
  expect(inGap(30, [[20, 260]])).toBe(true);
  expect(inGap(300, [[20, 260]])).toBe(false);
  expect(inGap(30)).toBe(false);
});

test("Draht: Parabel mit dem tiefsten Punkt in der Mitte; zu schmal: keine Kette; Grenze für die Kopfzeile", () => {
  expect(wireY(0, 5)).toBe(1);
  expect(wireY(0.5, 5)).toBe(6);
  expect(wireY(1, 5)).toBe(1);
  expect(wirePath([])).toBe("");
  expect(wirePath([{ from: 10, to: 110, sag: 4 }])).toBe("M 10.0 1 Q 60.0 9.0 110.0 1");
  expect(chainLayout({ width: 100, year: 2026 })).toMatchObject({ bulbs: [], wire: "" });
  expect(MIN_WIDTH).toBe(768);
});
