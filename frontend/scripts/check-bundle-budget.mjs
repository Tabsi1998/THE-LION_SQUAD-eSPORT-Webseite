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

export function parseBudgets(markdown) {
  const budgets = {};
  for (const match of markdown.matchAll(/<!-- budget:([a-z0-9-]+) (\d+) -->/g)) {
    budgets[match[1]] = Number(match[2]);
  }
  return budgets;
}

export function collectStartup(manifest, entryKey = "index.html") {
  const entry = manifest[entryKey];
  if (!entry) throw new Error(`Manifest enthält keinen Einstieg "${entryKey}".`);
  const js = [];
  const css = new Set();
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Manifest verweist auf unbekannten Eintrag "${key}".`);
    js.push({ key, file: chunk.file, name: chunk.name || "" });
    for (const file of chunk.css || []) css.add(file);
    for (const child of chunk.imports || []) visit(child);
  };
  visit(entryKey);
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
  const budgets = parseBudgets(readFileSync(path.join(rootDir, "PERFORMANCE_BUDGETS.md"), "utf8"));
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
  const forbidden = jsFiles.filter((item) =>
    FORBIDDEN_STARTUP_CHUNKS.some((name) => item.name === name || path.basename(item.file).startsWith(`${name}-`)),
  );
  for (const item of forbidden) {
    failures.push(`${item.file} gehört nicht in den anonymen Start (Editor, Diagramme, PDF und QR werden nur bei Bedarf geladen).`);
  }
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
    const status = value <= limit ? "ok" : "ZU GROSS";
    console.log(`${label} gzip (Stufe ${GZIP_LEVEL}): ${formatBytes(value)} / Budget ${formatBytes(limit)} – ${status}`);
    if (value > limit) {
      failures.push(`${label} ist ${formatBytes(value - limit)} über dem Budget von ${formatBytes(limit)}.`);
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
    console.error("Schwere Teile per lazy()/import() nachladen oder das Budget in PERFORMANCE_BUDGETS.md begründet anpassen.");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
