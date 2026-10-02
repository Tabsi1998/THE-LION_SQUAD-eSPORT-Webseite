import { hashString } from "../rng";
import { BAND_HEIGHT, COLORS, GLOW, INSET, chainLayout, glowRadius, inGap, wirePath, wireY } from "./lights";

// Lichterkette in der App (S11, #642): dieselbe Rechnung wie im Web - aus dem Jahres-Seed, Nägel und durchhängende
// Abschnitte, Lämpchen im Band mit eigener Farbe (nie zwei gleiche nebeneinander), Helligkeit, Glimmen und seltenem
// Flackern; Lücken ohne Lämpchen. Der Fingerabdruck steht gleich in frontend/src/seasons/christmas/lights.test.js.

/** Derselbe Fingerabdruck wie im Web: weicht eine Seite ab, wird die andere rot. */
export const CHAIN_PARITY = 2814731317;

test("Parität mit dem Web: dieselben Ketten aus demselben Seed", () => {
  const chains = [
    chainLayout({ width: 1200, year: 2026 }),
    chainLayout({ width: 354, year: "2026", anchor: "header", gaps: [[100, 160]] }),
    chainLayout({ width: 900, year: 2031, anchor: "footer", salt: "x" }),
  ];
  expect(hashString(JSON.stringify(chains))).toBe(CHAIN_PARITY);
});

test("Kette aus dem Jahres-Seed: gleich im Jahr, anders je Jahr und Anker; Nägel, Abschnitte, Lämpchen im Band, jedes anders", () => {
  const a = chainLayout({ width: 1200, year: 2026 });
  expect(chainLayout({ width: 1200, year: 2026 })).toEqual(a);
  expect(JSON.stringify(chainLayout({ width: 1200, year: 2027 }))).not.toBe(JSON.stringify(a));
  expect(JSON.stringify(chainLayout({ width: 1200, year: 2026, anchor: "footer" }))).not.toBe(JSON.stringify(a));
  expect(a.nails[0]).toBe(INSET);
  expect(a.nails[a.nails.length - 1]).toBe(1200 - INSET);
  expect(a.segments).toHaveLength(a.nails.length - 1);
  a.segments.forEach((segment) => {
    expect(segment.sag).toBeGreaterThan(0);
    expect(segment.sag).toBeLessThanOrEqual((BAND_HEIGHT - 8) * 0.9);
  });
  a.bulbs.forEach((bulb, index) => {
    expect(bulb.y + bulb.radius).toBeLessThanOrEqual(BAND_HEIGHT);
    expect(bulb.wire).toBeLessThan(bulb.y);
    expect(Object.keys(COLORS)).toContain(bulb.color);
    if (index) expect(bulb.color).not.toBe(a.bulbs[index - 1].color);
    expect(bulb.glowDelay).toBeLessThanOrEqual(0);
  });
  expect(new Set(a.bulbs.map((bulb) => `${bulb.glowDuration}:${bulb.glowDelay}:${bulb.brightness}`)).size).toBe(a.bulbs.length);
});

test("Auf der Begrüßungskarte eines Handys: ein bis zwei Abschnitte, fünf bis sieben Lämpchen, der Schein bleibt in der Ebene", () => {
  [320, 354, 390].forEach((width) => {
    [2026, 2027, 2028, 2029].forEach((year) => {
      const chain = chainLayout({ width, year: String(year) });
      expect(chain.segments.length).toBeGreaterThanOrEqual(1);
      expect(chain.segments.length).toBeLessThanOrEqual(2);
      expect(chain.bulbs.length).toBeGreaterThanOrEqual(4);
      expect(chain.bulbs.length).toBeLessThanOrEqual(7);
      chain.bulbs.forEach((bulb) => {
        expect(bulb.y + glowRadius(bulb)).toBeLessThanOrEqual(BAND_HEIGHT + GLOW);
        expect(bulb.x - glowRadius(bulb)).toBeGreaterThan(0);
        expect(bulb.x + glowRadius(bulb)).toBeLessThan(width);
      });
    });
  });
});

test("Lücken: der Draht bleibt, die übrigen Lämpchen bleiben, wie sie sind", () => {
  const plain = chainLayout({ width: 1200, year: 2026 });
  const gapped = chainLayout({ width: 1200, year: 2026, gaps: [[20, 260]] });
  expect(gapped.wire).toBe(plain.wire);
  expect(gapped.bulbs.every((bulb) => bulb.x < 20 || bulb.x > 260)).toBe(true);
  const kept = plain.bulbs.filter((bulb) => !inGap(bulb.x, [[20, 260]]));
  expect(gapped.bulbs.map((bulb) => `${bulb.x}:${bulb.color}`)).toEqual(kept.map((bulb) => `${bulb.x}:${bulb.color}`));
});

test("Draht: Parabel mit dem tiefsten Punkt in der Mitte; zu schmal: keine Kette; Schein höchstens sieben Punkte", () => {
  expect(wireY(0, 5)).toBe(1);
  expect(wireY(0.5, 5)).toBe(6);
  expect(wirePath([])).toBe("");
  expect(wirePath([{ from: 10, to: 110, sag: 4 }])).toBe("M 10.0 1 Q 60.0 9.0 110.0 1");
  expect(wirePath([{ from: 10, to: 110, sag: 4 }], 0.4)).toBe("M 10.0 0.4 Q 60.0 8.4 110.0 0.4");
  expect(chainLayout({ width: 100, year: 2026 })).toMatchObject({ bulbs: [], wire: "" });
  expect(glowRadius({ radius: 2.5 })).toBeCloseTo(5.25);
  expect(glowRadius({ radius: 3.4 })).toBe(GLOW);
});
