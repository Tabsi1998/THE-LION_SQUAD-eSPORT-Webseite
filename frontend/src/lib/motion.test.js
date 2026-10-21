import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { MICRO, MOTION, motionAllowed, motionSeconds, motionTransition } from "./motion";

// Bewegungs-Regeln (#1070): drei Dauern und eine Kurve stehen an drei Stellen - JS, CSS und App. Dieser Test hält
// sie zusammen: wer eine Zahl ändert, muss alle drei ändern.

const root = process.cwd();
// Zeilenenden egal: ein Windows-Checkout liefert CRLF, der Test vergleicht Inhalte.
const css = readFileSync(path.join(root, "src/index.css"), "utf8").replace(/\r\n/g, "\n");
const app = readFileSync(path.join(root, "../mobile/src/theme.ts"), "utf8").replace(/\r\n/g, "\n");

test("JS, CSS und App nennen dieselben Dauern und dieselbe Kurve", () => {
  expect(MOTION).toEqual({ fast: 150, mid: 240, slow: 420, ease: [0.2, 0.7, 0.2, 1] });
  for (const key of ["fast", "mid", "slow"]) {
    expect(css).toContain(`--tls-motion-${key}: ${MOTION[key]}ms;`);
    expect(app).toContain(`${key}: ${MOTION[key]},`);
  }
  expect(css).toContain(`--tls-ease: cubic-bezier(${MOTION.ease.join(", ")});`);
  expect(app).toContain(`ease: [${MOTION.ease.join(", ")}] as const`);
});

test("mit „Bewegung reduzieren“ stellt das CSS an einer Stelle alle Dauern ab und den Schalter für Wege auf 0", () => {
  const block = css.slice(css.indexOf("/* Bewegungs-Regeln: Bewegung reduzieren */"));
  expect(block.startsWith("/* Bewegungs-Regeln: Bewegung reduzieren */")).toBe(true);
  const rule = block.slice(0, block.indexOf("}\n}") + 3);
  expect(rule).toContain("@media (prefers-reduced-motion: reduce)");
  for (const key of ["fast", "mid", "slow"]) expect(rule).toContain(`--tls-motion-${key}: 0.01ms;`);
  expect(rule).toContain("--tls-motion-on: 0;");
});

test("Mikro-Bewegung (#1969): Hochzählen, Aufleuchten und Staffelung stehen in JS und CSS gleich", () => {
  expect(MICRO).toEqual({ count: 900, countStagger: 25, stagger: 50, staggerMax: 12, glow: 840 });
  expect(css).toContain(`--tls-motion-count: ${MICRO.count}ms;`);
  expect(css).toContain(`--tls-motion-glow: ${MICRO.glow}ms;`);
  expect(css).toContain(`--tls-stagger-step: ${MICRO.stagger}ms;`);
  // Gestaffelt werden nur die ersten zwölf Einträge.
  expect(css).toContain(`.tls-stagger[data-stagger="run"] > :nth-child(-n+${MICRO.staggerMax})`);
  const block = css.slice(css.indexOf("/* Bewegungs-Regeln: Bewegung reduzieren */"));
  const rule = block.slice(0, block.indexOf("}\n}") + 3);
  expect(rule).toContain("--tls-motion-count: 0.01ms;");
  expect(rule).toContain("--tls-motion-glow: 0.01ms;");
  expect(rule).toContain("--tls-stagger-step: 0ms;");
});

test("Dauern über die Tailwind-Namen (duration-fast …), nie als beliebiger Wert mit var() in eckigen Klammern - das warnt beim Bau (#1969)", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // Zusammengesetzt, damit Tailwind die Klasse nicht in diesem Test findet und selbst warnt.
      else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.includes(".test.") && readFileSync(full, "utf8").includes(["duration-", "[var("].join(""))) offenders.push(entry.name);
    }
  };
  walk(path.join(root, "src"));
  expect(offenders).toEqual([]);
});

test("Puls (#1969): eine Farbe über --tls-pulse-rgb, Vorgabe Gold, Varianten Cyan, Rot und Grün aus den Farb-Rollen", () => {
  expect(css).toContain("@keyframes tls-run-pulse { 0% { box-shadow: 0 0 0 0 rgb(var(--tls-pulse-rgb) / 0.55); }");
  expect(css).toContain(".tls-run-pulse { --tls-pulse-rgb: var(--tls-honor-rgb);");
  for (const [variant, role] of [["brand", "brand"], ["live", "live"], ["ok", "ok"]]) {
    expect(css).toContain(`.tls-run-pulse--${variant} { --tls-pulse-rgb: var(--tls-${role}-rgb); }`);
  }
  expect(css).not.toContain("box-shadow: 0 0 0 0 rgb(var(--tls-honor-rgb) / 0.55)");
});

test("motionSeconds und motionTransition rechnen aus den festen Werten", () => {
  expect(motionSeconds("fast")).toBe(0.15);
  expect(motionSeconds("gibt-es-nicht")).toBe(0.24);
  expect(motionTransition("slow")).toEqual({ duration: 0.42, ease: [0.2, 0.7, 0.2, 1] });
  // Eine eigene Kopie: framer-motion darf die Liste nicht verändern können.
  expect(motionTransition().ease).not.toBe(MOTION.ease);
});

test("motionAllowed: mit „Bewegung reduzieren“ nein, ohne Auskunft ja", () => {
  expect(motionAllowed({ matchMedia: () => ({ matches: true }) })).toBe(false);
  expect(motionAllowed({ matchMedia: () => ({ matches: false }) })).toBe(true);
  expect(motionAllowed({})).toBe(true);
  expect(motionAllowed(null)).toBe(true);
  expect(motionAllowed({ matchMedia: () => { throw new Error("kaputt"); } })).toBe(true);
});
