import { readFileSync } from "node:fs";
import path from "node:path";
import { KIND_COLORS } from "./categoryColors";
import { KIND_COLORS as CALENDAR_COLORS } from "./calendar";

// Bausteine wie im Web (#1151): Farben je Art, Eckradien und die vier Knöpfe stehen in der Website (dieses Modul,
// index.css) und in der App (mobile/src/theme.ts). Dieser Test hält beide Seiten gleich - wie lib/motion.test.js die
// Bewegung: wer einen Wert ändert, muss ihn an beiden Stellen ändern.

const root = process.cwd();
const css = readFileSync(path.join(root, "src/index.css"), "utf8").replace(/\r\n/g, "\n");
const app = readFileSync(path.join(root, "../mobile/src/theme.ts"), "utf8").replace(/\r\n/g, "\n");

/** Ein Block `export const name = { … };` aus theme.ts als Text. */
function appBlock(name) {
  const start = app.indexOf(`export const ${name} = {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return app.slice(start, app.indexOf("\n};", start));
}

function cssRule(selector) {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

test("Farben je Art: eine Stelle im Web, dieselben Werte in der App", () => {
  expect(CALENDAR_COLORS).toBe(KIND_COLORS);
  const block = appBlock("kindColors");
  for (const [kind, color] of Object.entries(KIND_COLORS)) expect(block).toContain(`${kind}: "${color}",`);
  expect(Object.keys(KIND_COLORS).sort()).toEqual(["event", "fastlap", "tournament"]);
});

test("Ecken: der Grundwert des Webs (--radius) gilt in der App für Karten, Knöpfe und Schilder", () => {
  const match = css.match(/--radius: ([\d.]+)rem;/);
  expect(match).toBeTruthy();
  const px = Math.round(Number(match[1]) * 16);
  expect(px).toBe(2);
  const block = appBlock("radius");
  for (const key of ["sm", "md", "lg"]) expect(block).toContain(`${key}: ${px},`);
});

test("die vier Knöpfe: Rahmen und Schrift wie tls-btn im Web", () => {
  const block = appBlock("buttonColors");
  const lineOf = (variant) => block.split("\n").find((line) => line.trim().startsWith(`${variant}:`)) || "";
  expect(cssRule(".tls-btn--primary")).toContain("background-color: var(--tls-cyan)");
  expect(lineOf("primary")).toContain('background: "#29B6E8"');
  expect(lineOf("primary")).toContain('text: "#04141B"');
  expect(cssRule(".tls-btn--primary")).toContain("color: #04141B");
  const frames = { secondary: ".tls-btn--secondary", quiet: ".tls-btn--quiet", danger: ".tls-btn--danger" };
  for (const [variant, selector] of Object.entries(frames)) {
    const rule = cssRule(selector);
    const border = rule.match(/border: 1px solid (rgba\([^)]*\))/)[1];
    expect(lineOf(variant)).toContain(`border: "${border}"`);
    expect(rule).toContain("background-color: transparent");
    expect(lineOf(variant)).toContain('background: "transparent"');
  }
  expect(cssRule(".tls-btn--secondary")).toContain("color: var(--tls-cyan)");
  expect(lineOf("secondary")).toContain('text: "#29B6E8"');
  expect(cssRule(".tls-btn--quiet")).toContain("color: rgba(255, 255, 255, 0.72)");
  expect(lineOf("quiet")).toContain('text: "rgba(255, 255, 255, 0.72)"');
  expect(cssRule(".tls-btn--danger")).toContain("color: #FF6B6B");
  expect(lineOf("danger")).toContain('text: "#FF6B6B"');
});
