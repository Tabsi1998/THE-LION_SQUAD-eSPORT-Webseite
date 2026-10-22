import fs from "fs";
import path from "path";
import { glowTones, pulseTones } from "../theme";
import { MICRO, MOTION, PRESS_SCALE, STAGGER_MS, staggerMs } from "./motion";

// Bewegungs-Regeln (#1085): die App nimmt dieselben Zahlen wie das Web (ein Test im Web vergleicht theme.ts mit index.css).
test("die Werte stimmen mit dem Web ueberein und der Versatz ist begrenzt", () => {
  expect(MOTION).toEqual({ fast: 150, mid: 240, slow: 420, ease: [0.2, 0.7, 0.2, 1] });
  expect(PRESS_SCALE).toBeCloseTo(0.98);
  expect(STAGGER_MS).toBe(70);
  expect(staggerMs(0)).toBe(0);
  expect(staggerMs(3)).toBe(210);
  expect(staggerMs(50)).toBe(560);
  expect(staggerMs(-4)).toBe(0);
});

// Mikro-Bewegung (#1969): dieselben Werte wie MICRO im Web (frontend/src/lib/motion.js) - der Test dort liest diese Datei.
test("Mikro-Werte, Farben fürs Aufleuchten und Puls-Varianten wie im Web", () => {
  const web = fs.readFileSync(path.join(__dirname, "../../../frontend/src/lib/motion.js"), "utf8");
  expect(MICRO).toEqual({ count: 900, countStagger: 25, stagger: 50, staggerMax: 12, glow: 840 });
  expect(web).toContain(`MICRO = Object.freeze({ count: ${MICRO.count}, countStagger: ${MICRO.countStagger}, stagger: ${MICRO.stagger}, staggerMax: ${MICRO.staggerMax}, glow: ${MICRO.glow} })`);
  expect(glowTones).toEqual({ brand: "#29B6E8", honor: "#FFD700", ok: "#1FD08E", pole: "#E879F9", fastest: "#C084FC" });
  expect(pulseTones).toEqual({ honor: "#FFD700", brand: "#29B6E8", live: "#FF3B30", ok: "#1FD08E" });
  const system = fs.readFileSync(path.join(__dirname, "../../../frontend/src/styles/system.css"), "utf8");
  expect(system).toContain("--tls-pole-rgb: 232 121 249;");
  expect(system).toContain("--tls-fastest-rgb: 192 132 252;");
});
