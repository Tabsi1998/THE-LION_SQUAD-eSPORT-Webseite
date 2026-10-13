import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Wächter für Rohfarben (#1305), nach dem Ratschen-Prinzip: Gold, Rot und Neon-Grün stehen heute noch hundertfach als
// Hexwert in src/. Diese Zahl darf nicht mehr steigen - neue Stellen nehmen die Rollen (text-honor, bg-live/15,
// border-ok/50 …, styles/system.css und lib/categoryColors.js). Wer Stellen umstellt, senkt die Grundlinie hier mit.
// Die zentralen Dateien und Tests zählen nicht mit: dort stehen die Werte mit Absicht.

const SRC = path.join(process.cwd(), "src");
const CENTRAL = new Set(["styles/system.css", "lib/categoryColors.js"]);
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
const SOURCE_FILE = /\.(jsx?|tsx?|css)$/;

// Grundlinie nach dem ersten Umbau aus #1305 (vorher 1170, 520 und 299 Stellen). Nur nach unten anpassen.
const BASELINE = { "#FFD700": 1123, "#FF3B30": 492, "#00FF88": 286 };

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(name) && !TEST_FILE.test(name) ? [full] : [];
  });
}

function countRaw() {
  const counts = Object.fromEntries(Object.keys(BASELINE).map((hex) => [hex, 0]));
  for (const file of sourceFiles(SRC)) {
    if (CENTRAL.has(path.relative(SRC, file).split(path.sep).join("/"))) continue;
    const text = readFileSync(file, "utf8");
    for (const hex of Object.keys(BASELINE)) counts[hex] += (text.match(new RegExp(hex, "gi")) || []).length;
  }
  return counts;
}

test("Gold, Rot und Neon-Grün als Rohwert werden nicht mehr - neue Stellen nehmen die Farb-Rollen", () => {
  const counts = countRaw();
  for (const [hex, limit] of Object.entries(BASELINE)) {
    expect(counts[hex], `${hex}: ${counts[hex]} Stellen, erlaubt sind höchstens ${limit} - bitte die Rolle nehmen (styles/system.css)`).toBeLessThanOrEqual(limit);
  }
});
