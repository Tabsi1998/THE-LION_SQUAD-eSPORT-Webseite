import { readFileSync } from "node:fs";
import path from "node:path";

// Schrift-Treppe (#1302, #1303, #1304): acht feste Stufen statt vierzig Größen. Dieser Test hält die Werte der Stufen
// fest (styles/system.css).

const SRC = path.join(process.cwd(), "src");
const system = readFileSync(path.join(SRC, "styles/system.css"), "utf8").replace(/\r\n/g, "\n");

function rule(selector, source = system) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return "";
  return source.slice(start, source.indexOf("}", start));
}

// clamp(min, calc(a + b·vw), max) in px bei einer Bildschirmbreite - so rechnet auch der Browser.
function clampAt(value, width) {
  const match = /clamp\(([\d.]+)rem,\s*calc\(([\d.]+)rem \+ ([\d.]+)vw\),\s*([\d.]+)rem\)/.exec(value);
  if (!match) return Number.parseFloat(value) * (value.endsWith("rem") ? 16 : 1);
  const [, min, base, slope, max] = match.map(Number);
  return Math.min(max * 16, Math.max(min * 16, base * 16 + (slope * width) / 100));
}

function sizeVar(name) {
  const match = new RegExp(`--tls-type-${name}-size: ([^;]+);`).exec(system);
  return match ? match[1] : "";
}

// PC (ab 1440 px) / Handy (390 px) aus #1302 - dazwischen gleitend, darüber wächst nichts mehr.
const STEPS = {
  hero: { pc: 64, phone: 40, weight: 800, family: "stage", upper: true },
  title: { pc: 44, phone: 30, weight: 700, family: "stage", upper: false },
  section: { pc: 24, phone: 20, weight: 800, family: "text", upper: false },
  card: { pc: 19, phone: 17, weight: 700, family: "text", upper: false },
  body: { pc: 17, phone: 16, weight: 400, family: "text", upper: false },
  small: { pc: 14, phone: 14, weight: 500, family: "text", upper: false },
  label: { pc: 12, phone: 12, weight: 700, family: "text", upper: true },
};

describe("die acht Stufen in styles/system.css", () => {
  test.each(Object.entries(STEPS))("tls-type-%s: Größe am PC und am Handy, Schrift, Stärke, Schreibweise", (name, step) => {
    const css = rule(`.tls-type-${name}`);
    expect(css, `.tls-type-${name} fehlt`).not.toBe("");
    expect(css).toContain(`font-size: var(--tls-type-${name}-size);`);
    expect(css).toContain(`font-family: var(--tls-font-${step.family});`);
    expect(css).toContain(`font-weight: ${step.weight};`);
    expect(css).toContain(`text-transform: ${step.upper ? "uppercase" : "none"};`);
    const size = sizeVar(name);
    expect(Math.round(clampAt(size, 1440) * 10) / 10).toBe(step.pc);
    expect(Math.round(clampAt(size, 390) * 10) / 10).toBe(step.phone);
    // Breitbild: wie PC. Handy 360: nie kleiner als bei 390.
    expect(Math.round(clampAt(size, 2560) * 10) / 10).toBe(step.pc);
    expect(Math.round(clampAt(size, 360) * 10) / 10).toBe(step.phone);
    // Kein Sprung bei 768 und 1024 px: der Wert liegt zwischen Handy und PC.
    for (const width of [768, 1024]) {
      expect(clampAt(size, width)).toBeGreaterThanOrEqual(step.phone);
      expect(clampAt(size, width)).toBeLessThanOrEqual(step.pc);
    }
  });

  test("Etikett: leicht gesperrt (0,12 em); Text mit Zeilenabstand 1,6", () => {
    expect(rule(".tls-type-label")).toContain("letter-spacing: 0.12em;");
    expect(rule(".tls-type-body")).toContain("line-height: 1.6;");
  });

  test("Zahl: Rajdhani 700 mit gleich breiten Ziffern, Zeilenhöhe 1 - die Größe kommt von der Stelle", () => {
    const css = rule(".tls-type-num");
    expect(css).toContain("font-family: var(--tls-font-num);");
    expect(css).toContain("font-weight: 700;");
    expect(css).toContain("font-variant-numeric: tabular-nums;");
    expect(css).toContain("line-height: 1;");
    expect(css).not.toContain("font-size");
    // Nach den anderen Stufen: zusammen mit einer Stufe („tls-type-card tls-type-num“) gilt deren Größe, die Schrift
    // aber kommt von hier.
    expect(system.indexOf(".tls-type-num {")).toBeGreaterThan(system.indexOf(".tls-type-label {"));
    expect(system).toMatch(/--tls-font-num: 'Rajdhani'/);
    expect(system).toMatch(/--tls-font-stage: 'Unbounded'/);
    expect(system).toMatch(/--tls-font-text: 'Outfit'/);
  });

  test("die Stufen stehen in @layer components - eine Tailwind-Klasse an einer Stelle gewinnt weiter", () => {
    const layer = system.slice(system.indexOf("@layer components {"));
    for (const name of [...Object.keys(STEPS), "num"]) expect(layer).toContain(`.tls-type-${name} {`);
  });
});
