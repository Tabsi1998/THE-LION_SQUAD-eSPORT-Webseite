import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Wächter für Rohfarben (#1305), nach dem Ratschen-Prinzip: Jede Farbe hat eine Aufgabe, neue Stellen nehmen die
// Rollen (text-honor, bg-live/15, border-ok/50 …, styles/system.css und lib/categoryColors.js). Gezählt werden die
// Rohwerte der alten Farben - Gold, Rot, Neon-Grün - samt ihrer Nebentöne (helles Rot, zweites Orange und Gelb, zweites
// Grün) und ihrer rgba()-Schreibweise, und zwar je Datei: Eine Stelle, die hier wegfällt, darf nicht anderswo
// wiederkommen. Übrig sind nur begründete Ausnahmen (styles/colors.baseline.json). Wer Stellen umstellt, senkt die
// Zahlen dort mit; neue Dateien stehen nie darin.
// Die zentralen Dateien und Tests zählen nicht mit: dort stehen die Werte mit Absicht.

const SRC = path.join(process.cwd(), "src");
const CENTRAL = new Set(["styles/system.css", "lib/categoryColors.js"]);
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
const SOURCE_FILE = /\.(jsx?|tsx?|css)$/;
const BASELINE = JSON.parse(readFileSync(path.join(SRC, "styles/colors.baseline.json"), "utf8"));

/** Familien der alten Farben: Hexwerte (ohne Groß/klein) und rgb-Kanäle. */
export const FAMILIES = {
  gold: { hex: ["FFD700"], rgb: ["255,215,0"] },
  red: { hex: ["FF3B30", "FF6B6B", "FF6B60", "FF6B61", "FF6B62", "FF8A80", "FFB4AE"], rgb: ["255,59,48"] },
  neon: { hex: ["00FF88", "00D26A", "10B981"], rgb: ["0,255,136"] },
  orange: { hex: ["FF9500", "FFD95A", "FFCC00", "FFD21A"], rgb: ["255,149,0"] },
};

// Tailwind-Palette statt Rolle (#1305): text-red-300, border-amber-400/50, bg-emerald-400/15 … - jede Stufe zählt.
const PALETTE = /(?<![\w-])(?:[\w-]+(?:\[[^\]\s]*\])?:)*!?-?(?:text|bg|border(?:-[trblxyse])?|from|via|to|ring|fill|stroke|accent|divide|outline|decoration|placeholder|shadow|caret)-(?:red|rose|amber|yellow|orange|green|emerald|lime)-\d{2,3}(?![\w-])/g;

/** Anzahl der Rohwerte je Familie in einem Text (dazu „palette“: Tailwind-Farbstufen statt Rollen). */
export function countFamilies(text) {
  const counts = {};
  for (const [family, { hex, rgb }] of Object.entries(FAMILIES)) {
    const hexHits = text.match(new RegExp(`#(?:${hex.join("|")})(?![0-9a-f])`, "gi")) || [];
    const channels = rgb.map((value) => value.split(",").join("[\\s,]+")).join("|");
    const rgbHits = text.match(new RegExp(`rgba?\\(\\s*(?:${channels})\\s*[,/)]`, "gi")) || [];
    const total = hexHits.length + rgbHits.length;
    if (total) counts[family] = total;
  }
  const palette = (text.match(PALETTE) || []).length;
  if (palette) counts.palette = palette;
  return counts;
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(name) && !TEST_FILE.test(name) ? [full] : [];
  });
}

/** Rohwerte je Datei (Pfad relativ zu src/). */
export function countAll() {
  const result = {};
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (CENTRAL.has(rel)) continue;
    const counts = countFamilies(readFileSync(file, "utf8"));
    if (Object.keys(counts).length) result[rel] = counts;
  }
  return result;
}

test("Gegenprobe: Hexwerte, Nebentöne und rgb()/rgba() zählen je Familie, Rollen nicht", () => {
  expect(countFamilies('className="text-[#FFD700] bg-[#ffd700]/10" style={{ color: "rgba(255, 215, 0, 0.5)" }}')).toEqual({ gold: 3 });
  expect(countFamilies("text-[#FF6B60] border-[#FF3B30]/40 rgb(255 59 48 / 0.2) rgba(255,59,48,0.1)")).toEqual({ red: 4 });
  expect(countFamilies("#00D26A #00ff88 #10b981 #FF9500 #FFCC00 #FFD95A #ffd21a")).toEqual({ neon: 3, orange: 4 });
  expect(countFamilies('className="text-red-300 hover:border-amber-400/50 bg-emerald-400/[0.06] !border-red-400/80 group-[.x]:text-lime-200"')).toEqual({ palette: 5 });
  expect(countFamilies('className="text-warn border-ok/40 bg-white/5 text-red text-sm/6"')).toEqual({});
  expect(countFamilies("text-honor bg-live/15 border-ok/50 var(--tls-warn) rgb(var(--tls-live-rgb) / 0.2) #FF3B3")).toEqual({});
});

test("die alten Farben stehen nur noch an den begründeten Ausnahmen - je Datei höchstens so oft wie in der Grundlinie", () => {
  const found = countAll();
  const problems = [];
  for (const [file, counts] of Object.entries(found)) {
    const allowed = BASELINE.dateien[file]?.zahlen || {};
    for (const [family, count] of Object.entries(counts)) {
      if (count > (allowed[family] || 0)) {
        problems.push(`${file}: ${family} ${count}× (erlaubt ${allowed[family] || 0}) - bitte die Farb-Rolle nehmen (styles/system.css)`);
      }
    }
  }
  expect(problems).toEqual([]);
}, 30_000);

// Rot heißt nur „läuft gerade“ und Löschen: Ein Fehler- oder Problemzweig, der `live` nimmt, ist falsch - das ist `warn`.
// Erkannt wird nur der eindeutige Fall `failed ? "… text-live …"` bzw. `error: "… border-live …"`, damit der Wächter nicht
// bei jedem Lösch-Knopf neben einem `toast.error` anschlägt.
const LIVE_FOR_PROBLEM = /\b(?:\w*[Ee]rrors?|failed|fail|problems?|invalid|short|overdue|conflict)\b[\w.?)\]"'\s=!<>]{0,24}?(?:\?|:|&&)\s*(?:<[^>"]*className=)?["'`][^"'`]*\b(?:text|bg|border)-live\b/g;

/** Stellen, an denen ein Fehler- oder Problemzweig die Rolle `live` (Rot) nimmt. */
export function liveForProblems(text) {
  return (text.match(LIVE_FOR_PROBLEM) || []).map((hit) => hit.replace(/\s+/g, " ").slice(0, 80));
}

test("Gegenprobe: Fehlerzweige mit Rot fallen auf, Löschen, Live und Fehler in Orange nicht", () => {
  expect(liveForProblems('{failed && <p className="text-live">x</p>}')).toHaveLength(1);
  expect(liveForProblems('const TONE = { error: "border-live/50 text-live", ok: "text-ok" };')).toHaveLength(1);
  expect(liveForProblems('${short ? "text-live" : "text-white/55"}')).toHaveLength(1);
  expect(liveForProblems('${tone === "problem" ? "border-live/40 bg-live/10" : ""}')).toHaveLength(1);
  expect(liveForProblems('{consentError ? <div className="text-live">')).toHaveLength(1);
  expect(liveForProblems('{error ? <span className="text-warn">x</span> : null}')).toEqual([]);
  expect(liveForProblems('onClick={() => remove(x).catch((e) => toast.error(e))} className="text-live">Entfernen')).toEqual([]);
  expect(liveForProblems('${running ? "border-live/40 text-live" : "border-white/10"}')).toEqual([]);
});

test("kein Fehler- oder Problemzweig nimmt Rot (live) - dafür gibt es warn", () => {
  const problems = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    for (const hit of liveForProblems(readFileSync(file, "utf8"))) problems.push(`${rel}: ${hit}`);
  }
  expect(problems).toEqual([]);
}, 30_000);

test("die Grundlinie ist knapp: keine veralteten Einträge, jede Ausnahme mit Grund", () => {
  const found = countAll();
  for (const [file, entry] of Object.entries(BASELINE.dateien)) {
    expect(entry.grund.trim().length, `${file}: Grund fehlt`).toBeGreaterThan(10);
    // Wer Stellen umstellt, senkt die Zahl mit - sonst könnte dort unbemerkt wieder eine Rohfarbe einziehen.
    expect(found[file] || {}, `${file}: Grundlinie senken`).toEqual(entry.zahlen);
  }
}, 30_000);
