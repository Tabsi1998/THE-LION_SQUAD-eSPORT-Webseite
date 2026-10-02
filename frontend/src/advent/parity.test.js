import { hashString } from "@/seasons/rng";
import { doorVariant } from "./doors";
import { sceneSvg } from "./scene";

// Adventkalender (#641, #732): Web und App rechnen dasselbe. Die festen Werte hier stehen genauso in der App
// (mobile/src/advent/parity.test.ts) - ändert jemand die Rechnung auf einer Seite, wird der Test der anderen rot.

const VARIANTS = [
  [1, { shape: "arch", hinge: "left", light: "rose", ornament: "none", plaque: "center", inset: 0.099, tilt: 0.3, angle: 96, swing: 879, pulse: 6, delay: 1.4 }],
  [2280413230, { shape: "arch", hinge: "top", light: "rose", ornament: "twig", plaque: "tr", inset: 0.094, tilt: 1.1, angle: 92, swing: 910, pulse: 5.4, delay: 0.5 }],
  [4294967295, { shape: "round", hinge: "left", light: "frost", ornament: "none", plaque: "center", inset: 0.127, tilt: 0.1, angle: 95, swing: 893, pulse: 3.8, delay: 3 }],
  [123456789, { shape: "rect", hinge: "double", light: "frost", ornament: "twig", plaque: "tr", inset: 0.122, tilt: 0.8, angle: 92, swing: 765, pulse: 3.8, delay: 1.1 }],
  [987654321, { shape: "round", hinge: "left", light: "amber", ornament: "none", plaque: "center", inset: 0.116, tilt: -0.4, angle: 93, swing: 871, pulse: 4.1, delay: 1.7 }],
  [31337, { shape: "round", hinge: "left", light: "rose", ornament: "paw", plaque: "center", inset: 0.114, tilt: -1.5, angle: 92, swing: 972, pulse: 5.9, delay: 0.9 }],
];
const SCENES = { 2026: [1358580835, 75860], 2027: [2935335124, 79871] };

test("dieselbe Saat, dasselbe Türchen wie in der App", () => {
  for (const [seed, expected] of VARIANTS) {
    const variant = doorVariant(seed);
    expect({ ...variant, light: variant.light.key }).toEqual(expected);
  }
});

test("dasselbe Jahr, dasselbe Bild wie in der App - dort ohne Weichzeichner", () => {
  for (const year of [2026, 2027]) {
    const svg = sceneSvg(year, { filters: false });
    expect([hashString(svg), svg.length]).toEqual(SCENES[year]);
    expect(svg).not.toMatch(/<filter|filter=/);
  }
  // Mit Weichzeichner ist es dasselbe Bild plus zwei Filter - nichts sonst ändert sich.
  const full = sceneSvg(2026);
  const plain = sceneSvg(2026, { filters: false });
  expect(full.length - plain.length).toBe(367);
  expect(full.replace(/<filter[^>]*>.*?<\/filter>/g, "").replace(/ filter="url\(#a-blur-[ls]\)"/g, "")).toBe(plain);
});
