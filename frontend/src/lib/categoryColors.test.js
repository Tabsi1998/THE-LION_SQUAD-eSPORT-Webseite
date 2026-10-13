import { readFileSync } from "node:fs";
import path from "node:path";
import { KIND_COLORS, KIND_COLORS_DARK, NEWS_CATEGORY_COLORS, ROLE_COLORS, SURFACE_COLORS, contrastRatio, newsCategoryColor } from "./categoryColors";
import { KIND_COLORS as CALENDAR_COLORS } from "./calendar";

// Bausteine wie im Web (#1151, #1305): Farb-Rollen, Farben je Art, Eckradien und die vier Knöpfe stehen in der Website
// (dieses Modul, styles/system.css, index.css) und in der App (mobile/src/theme.ts). Dieser Test hält alle Seiten
// gleich - wie lib/motion.test.js die Bewegung: wer einen Wert ändert, muss ihn an jeder Stelle ändern.

const root = process.cwd();
const css = readFileSync(path.join(root, "src/index.css"), "utf8").replace(/\r\n/g, "\n");
const system = readFileSync(path.join(root, "src/styles/system.css"), "utf8").replace(/\r\n/g, "\n");
const tailwind = readFileSync(path.join(root, "tailwind.config.js"), "utf8").replace(/\r\n/g, "\n");
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

const hexToRgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(" ");
// CSS-Namen der Rollen: „muted“ heißt dort --tls-text-muted, weil --tls-muted (#1232) schon vergeben ist.
const CSS_NAME = { muted: "text-muted" };

describe("Farb-Rollen (#1305)", () => {
  test("die Rollen und ihre Werte, wie Fabian sie gewählt hat", () => {
    expect(ROLE_COLORS).toEqual({
      brand: "#29B6E8", live: "#FF3B30", warn: "#FF9F43", ok: "#1FD08E", honor: "#FFD700", event: "#9F7AEA",
      muted: "#B4B4BD", quiet: "#8E8E99", silver: "#C9CED6", bronze: "#D08A4E",
    });
    expect(SURFACE_COLORS).toEqual({ base: "#0A0A0A", 1: "#121214", 2: "#18181C", 3: "#1F1F24" });
  });

  test("styles/system.css nennt jede Rolle mit denselben Kanälen, index.css lädt sie", () => {
    for (const [role, hex] of Object.entries(ROLE_COLORS)) {
      const name = CSS_NAME[role] || role;
      expect(system).toContain(`--tls-${name}-rgb: ${hexToRgb(hex)};`);
      expect(system).toContain(`--tls-${name}: rgb(var(--tls-${name}-rgb));`);
    }
    for (const [key, hex] of Object.entries(SURFACE_COLORS)) {
      expect(system).toContain(`--tls-surface-${key === "base" ? "0" : key}: ${hex};`);
    }
    expect(css.startsWith('@import "./styles/system.css";')).toBe(true);
    // Die alten Namen zeigen auf die Rollen: Grün ist jetzt das weichere #1FD08E, Gold die Ehre.
    expect(css).toContain("--tls-success: var(--tls-ok);");
    expect(css).toContain("--tls-gold: var(--tls-honor);");
    expect(css).not.toContain("--tls-live-rgb: 255 59 48;");
  });

  test("Tailwind kennt jede Rolle als Farbe mit Abstufung (bg-ok/15, text-warn …)", () => {
    for (const role of ["brand", "live", "warn", "ok", "honor", "event", "quiet", "silver", "bronze"]) {
      expect(tailwind).toContain(`${role}: 'rgb(var(--tls-${role}-rgb) / <alpha-value>)'`);
    }
    expect(tailwind).toContain("text: 'rgb(var(--tls-text-muted-rgb) / <alpha-value>)'");
    for (const key of ["0", "1", "2", "3"]) expect(tailwind).toContain(`'${key}': 'var(--tls-surface-${key})'`);
  });

  test("die App hat dieselben Rollen und Flächen", () => {
    const roles = appBlock("roles");
    for (const [role, hex] of Object.entries(ROLE_COLORS)) expect(roles).toContain(`${role}: "${hex}",`);
    const surfaces = appBlock("surfaces");
    for (const [key, hex] of Object.entries(SURFACE_COLORS)) expect(surfaces).toContain(`${key === "base" ? "base" : `s${key}`}: "${hex}",`);
    // Das alte „success“ der App ist dasselbe weiche Grün.
    expect(appBlock("colors")).toContain(`success: "${ROLE_COLORS.ok}",`);
  });

  test("Text in Rollenfarbe ist auf jeder Fläche lesbar (mindestens 4,5 : 1)", () => {
    for (const role of Object.keys(ROLE_COLORS)) {
      for (const surface of Object.values(SURFACE_COLORS)) {
        expect(contrastRatio(ROLE_COLORS[role], surface), `${role} auf ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("Farben je Art (#1151, #1305)", () => {
  test("Event Violett, Turnier Cyan, Fast Lap Türkis, Verein Gold - eine Stelle im Web, dieselben Werte in der App", () => {
    expect(CALENDAR_COLORS).toBe(KIND_COLORS);
    expect(KIND_COLORS).toEqual({ event: ROLE_COLORS.event, tournament: ROLE_COLORS.brand, fastlap: "#2DD4BF", club: ROLE_COLORS.honor });
    const block = appBlock("kindColors");
    for (const [kind, color] of Object.entries(KIND_COLORS)) expect(block).toContain(`${kind}: "${color}",`);
    expect(Object.keys(KIND_COLORS).sort()).toEqual(["club", "event", "fastlap", "tournament"]);
  });

  test("die dunklen Fassungen tragen weiße Schrift (Kopf der Datums-Kachel, #1318) - in Web und App gleich", () => {
    expect(KIND_COLORS_DARK).toEqual({ event: "#7655CC", tournament: "#1A7AA3", fastlap: "#0E7F73", club: "#85690A" });
    const block = appBlock("kindColorsDark");
    for (const [kind, color] of Object.entries(KIND_COLORS_DARK)) {
      expect(block).toContain(`${kind}: "${color}",`);
      expect(contrastRatio("#FFFFFF", color), kind).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("News-Kategorien: Turniere Cyan, Events Violett, Verein und Mitglieder Gold, alles andere Grau - kein Rot", () => {
    expect(NEWS_CATEGORY_COLORS).toEqual({ tournaments: KIND_COLORS.tournament, events: KIND_COLORS.event, club: KIND_COLORS.club, members: ROLE_COLORS.honor });
    expect(newsCategoryColor("events")).toBe("#9F7AEA");
    for (const other of ["announcement", "community", "sponsors", "teams", "recap", "maintenance", "", undefined]) {
      expect(newsCategoryColor(other)).toBe(ROLE_COLORS.quiet);
    }
  });

  test("contrastRatio rechnet nach WCAG", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
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
