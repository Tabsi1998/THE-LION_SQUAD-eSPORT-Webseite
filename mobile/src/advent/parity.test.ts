import { hashString } from "../seasons/rng";
import { cellOf, columnsFor, doorLabel, doorOrder, doorVariant, hingeAt, opensLabel, viennaParts, HINGES } from "./doors";
import { sceneSvg } from "./scene";

// Adventkalender (#641, #732): Web und App rechnen dasselbe. Die festen Werte hier stehen genauso im Web
// (frontend/src/advent/parity.test.js) - ändert jemand die Rechnung auf einer Seite, wird der Test der anderen rot.

const VARIANTS: Array<[number, Record<string, unknown>]> = [
  [1, { shape: "arch", hinge: "left", light: "rose", ornament: "none", plaque: "center", inset: 0.099, tilt: 0.3, angle: 96, swing: 879, pulse: 6, delay: 1.4 }],
  [2280413230, { shape: "arch", hinge: "top", light: "rose", ornament: "twig", plaque: "tr", inset: 0.094, tilt: 1.1, angle: 92, swing: 910, pulse: 5.4, delay: 0.5 }],
  [4294967295, { shape: "round", hinge: "left", light: "frost", ornament: "none", plaque: "center", inset: 0.127, tilt: 0.1, angle: 95, swing: 893, pulse: 3.8, delay: 3 }],
  [123456789, { shape: "rect", hinge: "double", light: "frost", ornament: "twig", plaque: "tr", inset: 0.122, tilt: 0.8, angle: 92, swing: 765, pulse: 3.8, delay: 1.1 }],
  [987654321, { shape: "round", hinge: "left", light: "amber", ornament: "none", plaque: "center", inset: 0.116, tilt: -0.4, angle: 93, swing: 871, pulse: 4.1, delay: 1.7 }],
  [31337, { shape: "round", hinge: "left", light: "rose", ornament: "paw", plaque: "center", inset: 0.114, tilt: -1.5, angle: 92, swing: 972, pulse: 5.9, delay: 0.9 }],
];
const SCENES: Record<number, [number, number]> = { 2026: [1358580835, 75860], 2027: [2935335124, 79871] };

test("dieselbe Saat, dasselbe Türchen wie im Web", () => {
  for (const [seed, expected] of VARIANTS) {
    const variant = doorVariant(seed);
    expect({ ...variant, light: variant.light.key }).toEqual(expected);
  }
  expect(doorVariant("2280413230")).toEqual(doorVariant(2280413230));
});

test("dasselbe Jahr, dasselbe Bild wie im Web - ohne Weichzeichner", () => {
  for (const year of [2026, 2027]) {
    const svg = sceneSvg(year, { filters: false });
    expect([hashString(svg), svg.length]).toEqual(SCENES[year]);
    expect(svg).not.toMatch(/<filter|filter=|NaN|undefined/);
    expect(svg).toContain('preserveAspectRatio="xMidYMax slice"');
  }
  expect(sceneSvg(2026)).toContain("feGaussianBlur");
});

test("Spalten, Anordnung und Scharnier am Rand", () => {
  expect([320, 392, 559, 560, 899, 900, 1280].map(columnsFor)).toEqual([3, 3, 3, 4, 4, 6, 6]);
  expect([0, -1, NaN].map(columnsFor)).toEqual([3, 3, 3]);
  const order = [8, 22, 9, 14, 5, 13, 17, 12, 2, 18, 6, 16, 19, 7, 10, 3, 24, 23, 11, 15, 21, 4, 1, 20];
  expect(doorOrder(order)).toEqual(order);
  expect(doorOrder(order.slice(1))).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
  expect(doorOrder(null)).toHaveLength(24);
  for (const columns of [3, 4, 6]) {
    for (let index = 0; index < 24; index += 1) {
      const cell = cellOf(index, columns);
      for (const hinge of HINGES) {
        const used = hingeAt(hinge, cell, columns);
        if (cell.col === 0) expect(["right", "top"]).toContain(used);
        if (cell.col === columns - 1) expect(["left", "top"]).toContain(used);
        if (cell.row === 0) expect(used).not.toBe("top");
        if (cell.col > 0 && cell.col < columns - 1 && cell.row > 0) expect(used).toBe(hinge);
      }
    }
  }
});

test("die Uhr in Wien - nach der Regel gerechnet, auch an den Tagen der Zeitumstellung", () => {
  expect(viennaParts(new Date("2026-12-05T05:00:00Z"))).toEqual({ year: 2026, month: 12, day: 5, hour: 6, minute: 0 });
  expect(viennaParts(new Date("2026-07-31T22:30:00Z"))).toEqual({ year: 2026, month: 8, day: 1, hour: 0, minute: 30 });
  // 29.03.2026: um 01:00 UTC springt die Uhr von 2 auf 3.
  expect(viennaParts(new Date("2026-03-29T00:59:00Z")).hour).toBe(1);
  expect(viennaParts(new Date("2026-03-29T01:00:00Z")).hour).toBe(3);
  // 25.10.2026: um 01:00 UTC springt sie von 3 zurück auf 2.
  expect(viennaParts(new Date("2026-10-25T00:59:00Z")).hour).toBe(2);
  expect(viennaParts(new Date("2026-10-25T01:00:00Z")).hour).toBe(2);
  expect(viennaParts(new Date("2026-12-31T23:30:00Z"))).toEqual({ year: 2027, month: 1, day: 1, hour: 0, minute: 30 });
});

test("wann ein Türchen aufgeht und was es vorliest", () => {
  expect(opensLabel("2026-12-05T06:00:00+01:00")).toBe("5. Dezember, 6 Uhr");
  expect(opensLabel("2026-12-13T20:30:00+01:00")).toBe("13. Dezember, 20:30 Uhr");
  expect(opensLabel("2027-01-06T23:59:59+01:00")).toBe("6. Jänner, 23:59 Uhr");
  expect(opensLabel("2026-07-31T22:00:00Z")).toBe("1. August, 0 Uhr");
  expect(opensLabel("irgendwann")).toBe("");
  expect(opensLabel(null)).toBe("");
  const opens_at = "2026-12-20T06:00:00+01:00";
  expect(doorLabel({ day: 20, state: "locked", opens_at })).toBe("Türchen 20 – öffnet sich am 20. Dezember, 6 Uhr");
  expect(doorLabel({ day: 12, state: "available", opens_at }, { today: true })).toBe("Türchen 12 öffnen – das heutige");
  expect(doorLabel({ day: 12, state: "available", opens_at })).toBe("Türchen 12 öffnen");
  expect(doorLabel({ day: 2, state: "opened", opens_at, content: { kind: "quiz", title: "Kranz-Quiz" } })).toBe("Türchen 2 – geöffnet: Kranz-Quiz");
});
