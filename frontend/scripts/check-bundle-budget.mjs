#!/usr/bin/env node
// Budget-Gate für den anonymen öffentlichen Start (#936).
//
// Zählt alle JS-Dateien, die der Browser beim ersten Aufruf ohne Anmeldung lädt: den Einstieg aus
// index.html und alles, was er statisch (transitiv) importiert. Genau diese Dateien stehen in
// dist/index.html als <script> bzw. <link rel="modulepreload">. Nachgeladene Routen-, Saison-,
// Editor-, Diagramm-, PDF- und QR-Teile (dynamic import) zählen nicht mit.
//
// Grundlage ist das Vite-Manifest (dist/.vite/manifest.json, build.manifest in vite.config.mjs).
// Gemessen wird gzip mit fester Stufe 9, damit die Zahl auf jedem Rechner gleich ist.
// Die Grenzwerte stehen in PERFORMANCE_BUDGETS.md (Zeilen "<!-- budget:... -->").
// Zusätzlich: Keine öffentliche Seite erreicht Editor, Diagramme, PDF oder QR statisch (heavyRouteProblems).
//
//   node scripts/check-bundle-budget.mjs          prüft und schlägt bei Überschreitung fehl
//   node scripts/check-bundle-budget.mjs --json   gibt zusätzlich alle Dateien als JSON aus

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const GZIP_LEVEL = 9;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Diese Bibliotheken gehören nie in den anonymen Start (PERFORMANCE_BUDGETS.md, Abschnitt Bundle).
// Geprüft wird über die Chunk-Namen aus manualChunks bzw. die Paketnamen der Vite-Chunks.
export const FORBIDDEN_STARTUP_CHUNKS = ["editor", "charts", "pdf", "jsQR"];

// Öffentliche Seiten dürfen diese Chunks auch nicht statisch erreichen (#936): Hängt eine Seite über eine gemeinsam
// genutzte Kleinigkeit (clsx, use-sync-external-store …) an "editor", lädt sie beim Öffnen den ganzen Editor mit.
// Geprüft werden alle Seiten unter src/pages/public/ und diese Pflicht-Seiten - fehlt eine im Manifest, ist das ein
// Fehler, damit eine Umbenennung die Prüfung nicht still abschaltet.
export const LIGHT_ROUTE_PREFIX = "src/pages/public/";
export const REQUIRED_LIGHT_ROUTES = [
  "src/pages/public/RegisterPage.jsx",
  "src/pages/public/MembershipApplyPage.jsx",
  "src/pages/user/ProfilePage.jsx",
  "src/pages/public/EventsPage.jsx",
  "src/pages/public/TournamentsPage.jsx",
];

export function isForbiddenChunk(chunk) {
  const file = path.basename(chunk.file || "");
  return FORBIDDEN_STARTUP_CHUNKS.some((name) => chunk.name === name || file.startsWith(`${name}-`));
}

/** Alle Manifest-Einträge, die `key` statisch (transitiv) importiert, samt `key` selbst. */
export function staticClosure(manifest, key) {
  const seen = new Set();
  const order = [];
  const visit = (current) => {
    if (seen.has(current)) return;
    seen.add(current);
    const chunk = manifest[current];
    if (!chunk) throw new Error(`Manifest verweist auf unbekannten Eintrag "${current}".`);
    order.push(current);
    for (const child of chunk.imports || []) visit(child);
  };
  visit(key);
  return order;
}

/** Öffentliche Seiten, die Editor, Diagramme, PDF oder QR statisch mitladen. */
export function heavyRouteProblems(manifest, { prefix = LIGHT_ROUTE_PREFIX, required = REQUIRED_LIGHT_ROUTES } = {}) {
  const problems = [];
  for (const route of required) {
    if (!manifest[route]) problems.push(`${route} fehlt im Manifest - Seite umbenannt? REQUIRED_LIGHT_ROUTES anpassen.`);
  }
  const routes = new Set([...Object.keys(manifest).filter((key) => key.startsWith(prefix) && manifest[key].isDynamicEntry), ...required]);
  for (const route of [...routes].sort()) {
    if (!manifest[route]) continue;
    const heavy = staticClosure(manifest, route).map((key) => manifest[key]).filter(isForbiddenChunk);
    if (heavy.length) problems.push(`${route} lädt ${heavy.map((chunk) => chunk.name || chunk.file).join(", ")} statisch mit.`);
  }
  return problems;
}

/** Harte Grenzen ("<!-- budget:... -->", darüber schlägt das Gate fehl). */
export function parseBudgets(markdown) {
  return parseMarkers(markdown, "budget");
}

/** Ziele ("<!-- goal:... -->", darüber nur eine Warnung): der Wert, auf den wir hinarbeiten. */
export function parseGoals(markdown) {
  return parseMarkers(markdown, "goal");
}

function parseMarkers(markdown, kind) {
  const values = {};
  for (const match of markdown.matchAll(/<!-- (budget|goal):([a-z0-9-]+) (\d+) -->/g)) {
    if (match[1] === kind) values[match[2]] = Number(match[3]);
  }
  return values;
}

/** Ergebnis je Messwert: "fail" über der Grenze, "warn" über dem Ziel, sonst "ok". */
export function judge(value, limit, goal) {
  if (value > limit) return "fail";
  if (Number.isFinite(goal) && value > goal) return "warn";
  return "ok";
}

export function collectStartup(manifest, entryKey = "index.html") {
  const entry = manifest[entryKey];
  if (!entry) throw new Error(`Manifest enthält keinen Einstieg "${entryKey}".`);
  const js = [];
  const css = new Set();
  for (const key of staticClosure(manifest, entryKey)) {
    const chunk = manifest[key];
    js.push({ key, file: chunk.file, name: chunk.name || "" });
    for (const file of chunk.css || []) css.add(file);
  }
  return { js, css: [...css] };
}

export function gzipSize(buffer) {
  return gzipSync(buffer, { level: GZIP_LEVEL }).length;
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString("de-AT")} Bytes (${(bytes / 1024).toFixed(1)} KiB)`;
}

function main() {
  const distDir = path.join(rootDir, "dist");
  const manifestPath = path.join(distDir, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`Bundle-Budget: ${path.relative(rootDir, manifestPath)} fehlt. Erst "yarn build" ausführen.`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const budgetText = readFileSync(path.join(rootDir, "PERFORMANCE_BUDGETS.md"), "utf8");
  const budgets = parseBudgets(budgetText);
  const goals = parseGoals(budgetText);
  const { js, css } = collectStartup(manifest);

  const measure = (file) => {
    const buffer = readFileSync(path.join(distDir, file));
    return { file, raw: buffer.length, gzip: gzipSize(buffer) };
  };
  const jsFiles = js.map((item) => ({ ...measure(item.file), name: item.name }));
  const cssFiles = css.map(measure);
  const jsGzip = jsFiles.reduce((sum, item) => sum + item.gzip, 0);
  const cssGzip = cssFiles.reduce((sum, item) => sum + item.gzip, 0);

  const failures = [];
  for (const item of jsFiles.filter(isForbiddenChunk)) {
    failures.push(`${item.file} gehört nicht in den anonymen Start (Editor, Diagramme, PDF und QR werden nur bei Bedarf geladen).`);
  }
  const routeProblems = heavyRouteProblems(manifest);
  for (const problem of routeProblems) failures.push(problem);
  if (!routeProblems.length) console.log("Öffentliche Seiten: keine lädt Editor, Diagramme, PDF oder QR statisch mit – ok");
  const checks = [
    ["startup-js-gzip", "Start-JS", jsGzip],
    ["startup-css-gzip", "Start-CSS", cssGzip],
  ];
  for (const [key, label, value] of checks) {
    const limit = budgets[key];
    if (!Number.isFinite(limit)) {
      failures.push(`PERFORMANCE_BUDGETS.md enthält keinen Grenzwert "<!-- budget:${key} ... -->".`);
      continue;
    }
    const goal = goals[key];
    const verdict = judge(value, limit, goal);
    const goalText = Number.isFinite(goal) ? `, Ziel ${formatBytes(goal)}` : "";
    const status = { ok: "ok", warn: "über dem Ziel", fail: "ZU GROSS" }[verdict];
    console.log(`${label} gzip (Stufe ${GZIP_LEVEL}): ${formatBytes(value)} / Grenze ${formatBytes(limit)}${goalText} – ${status}`);
    if (verdict === "warn") {
      // Nur ein Hinweis, kein Fehler: in GitHub Actions als Warnung sichtbar.
      console.log(`::warning::${label} liegt ${formatBytes(value - goal)} über dem Ziel von ${formatBytes(goal)} (Grenze ${formatBytes(limit)}).`);
    }
    if (verdict === "fail") {
      failures.push(`${label} ist ${formatBytes(value - limit)} über der Grenze von ${formatBytes(limit)}.`);
    }
  }

  const largest = [...jsFiles].sort((a, b) => b.gzip - a.gzip).slice(0, 8);
  console.log(`${jsFiles.length} JS-Dateien beim Start, ${cssFiles.length} CSS-Dateien. Die größten JS-Dateien (gzip):`);
  for (const item of largest) console.log(`  ${String(item.gzip).padStart(8)}  ${item.file}`);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ gzipLevel: GZIP_LEVEL, jsGzip, cssGzip, js: jsFiles, css: cssFiles }, null, 2));
  }

  if (failures.length) {
    console.error("\nBundle-Budget überschritten (#936):");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error("Schwere Teile per lazy()/import() nachladen oder die Grenze in PERFORMANCE_BUDGETS.md begründet anpassen.");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
