#!/usr/bin/env node
// Browser-Tests nach gemessener Dauer auf die CI-Teile verteilen (#2054).
//
// Playwright teilt mit --shard nach der Zahl der Tests. Bei uns überspringen sich viele Tests erst zur Laufzeit
// (Handy-Projekt, nur Chromium, Abnahme), und die Dateien sind sehr verschieden lang: Teil 1 brauchte 15 Minuten,
// Teil 4 sechs. Dieses Skript plant die Teile nach Dauer: Jede Datei bleibt je Projekt beisammen (wie bisher
// läuft sie in einem Worker in ihrer Reihenfolge), die längsten Gruppen kommen zuerst auf den Teil, der am
// wenigsten zu tun hat. Jeder Teil rechnet denselben Plan aus derselben Testliste, so läuft jeder Test in genau
// einem Teil - und das Skript prüft das mit Playwright selbst, bevor ein Test startet.
//
//   node scripts/e2e-shards.mjs plan 2/6 e2e-shard.txt     Testliste für Teil 2 von 6 schreiben und prüfen
//   node scripts/e2e-shards.mjs durations report*.json     Dauern aus JSON-Berichten von CI-Läufen ausgeben
//
// Die Dauern stehen in e2e/shard-durations.json (Sekunden je Gruppe). Fehlt eine Gruppe (neue Datei), wird sie
// nach der Zahl ihrer Tests geschätzt; aktualisieren siehe docs/entwicklung/tests.md.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DURATIONS_FILE = path.join(FRONTEND, "e2e", "shard-durations.json");
const SEPARATOR = " › ";

/** Alle Tests aus einem JSON-Bericht von Playwright (auch aus `--list`). */
export function collectTests(report) {
  const tests = [];
  const walk = (suite, specFile, titles) => {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        tests.push({
          project: test.projectName,
          specFile,
          file: spec.file,
          titles: [...titles, spec.title],
          duration: (test.results || []).reduce((sum, result) => sum + (result.duration || 0), 0) / 1000,
        });
      }
    }
    for (const child of suite.suites || []) {
      // Unbenannte describe-Blöcke zählen in Playwrights Titelpfad nicht mit.
      walk(child, specFile, child.title ? [...titles, child.title] : titles);
    }
  };
  for (const fileSuite of report.suites || []) walk(fileSuite, fileSuite.file, []);
  return tests;
}

export const groupKey = (test) => `[${test.project}]${SEPARATOR}${test.specFile}`;
// Eine Gruppe wählt ihre Datei als Ganzes aus ("[chromium] › public.spec.js"). Playwright lädt dabei nur Dateien,
// die in der Liste stehen - darum steht die Zeile auch dann da, wenn alle Tests der Datei aus einer Hilfsdatei
// kommen (seasonQa.js). Solche Tests wählt je eine eigene Zeile mit ihrem Titelpfad aus.
export const linesFor = (test) => (test.file === test.specFile
  ? [groupKey(test)]
  : [groupKey(test), [`[${test.project}]`, test.file, ...test.titles].join(SEPARATOR)]);
export const testId = (test) => `${groupKey(test)}${SEPARATOR}${test.file}${SEPARATOR}${test.titles.join(SEPARATOR)}`;

/** Wie Playwright eine Zeile der Testliste liest (loadTestList): Projekt, Datei, Anfang des Titelpfads. */
function lineMatches(line, test) {
  const tokens = line.split("›").map((token) => token.trim());
  let project;
  if (tokens[0].startsWith("[")) project = tokens.shift().slice(1, -1);
  if (project !== undefined && project !== test.project) return false;
  if (tokens[0] !== test.file) return false;
  const titles = tokens.slice(1);
  return titles.length <= test.titles.length && titles.every((title, index) => title === test.titles[index].trim());
}

/**
 * Gruppen bilden und nach Dauer verteilen (längste zuerst auf den freiesten Teil).
 * Trifft die Zeile eines Tests auch einen Test einer anderen Gruppe, wandern beide Gruppen zusammen - so kann
 * keine Zeile einen Test in einem zweiten Teil auslösen.
 */
export function planShards(tests, total, durations = {}) {
  const parent = new Map();
  const find = (key) => {
    while (parent.get(key) !== key) key = parent.get(key);
    return key;
  };
  for (const test of tests) parent.set(groupKey(test), groupKey(test));
  const lines = new Map();
  for (const test of tests) for (const line of linesFor(test)) lines.set(line, groupKey(test));
  for (const [line, owner] of lines) {
    for (const other of tests) {
      if (lineMatches(line, other)) parent.set(find(groupKey(other)), find(owner));
    }
  }

  const groups = new Map();
  for (const test of tests) {
    const root = find(groupKey(test));
    if (!groups.has(root)) groups.set(root, { keys: new Set(), tests: [] });
    groups.get(root).keys.add(groupKey(test));
    groups.get(root).tests.push(test);
  }

  // Unbekannte Gruppen: Tests mal mittlere gemessene Dauer je Test.
  let knownSeconds = 0;
  let knownTests = 0;
  for (const group of groups.values()) {
    for (const key of group.keys) {
      if (typeof durations[key] === "number") {
        knownSeconds += durations[key];
        knownTests += group.tests.filter((test) => groupKey(test) === key).length;
      }
    }
  }
  const perTest = knownTests ? knownSeconds / knownTests : 1;
  const estimate = (group) => [...group.keys].reduce((sum, key) => sum + (typeof durations[key] === "number"
    ? durations[key]
    : group.tests.filter((test) => groupKey(test) === key).length * perTest), 0);

  const ordered = [...groups.entries()]
    .map(([root, group]) => ({ root, ...group, seconds: estimate(group) }))
    .sort((a, b) => b.seconds - a.seconds || a.root.localeCompare(b.root));
  const shards = Array.from({ length: total }, () => ({ seconds: 0, groups: [], tests: [] }));
  for (const group of ordered) {
    const target = shards.reduce((best, shard) => (shard.seconds < best.seconds ? shard : best), shards[0]);
    target.seconds += group.seconds;
    target.groups.push(group.root);
    target.tests.push(...group.tests);
  }
  return shards;
}

/** Sekunden je Gruppe aus einem oder mehreren JSON-Berichten (alle Versuche eines Tests zählen). */
export function durationsFromReports(reports) {
  const seconds = {};
  for (const report of reports) {
    for (const test of collectTests(report)) {
      seconds[groupKey(test)] = (seconds[groupKey(test)] || 0) + test.duration;
    }
  }
  return Object.fromEntries(Object.entries(seconds)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, Math.round(value * 10) / 10]));
}

function listTests(extraArguments = []) {
  const output = execFileSync(process.execPath,
    [path.join(FRONTEND, "node_modules", "@playwright", "test", "cli.js"), "test", "--list", "--reporter=json",
      ...extraArguments],
    { cwd: FRONTEND, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: "" } });
  return collectTests(JSON.parse(output.slice(output.indexOf("{"))));
}

function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value || "");
  const current = match && Number(match[1]);
  const total = match && Number(match[2]);
  if (!match || current < 1 || current > total) throw new Error(`Teil als "n/gesamt" angeben, nicht "${value}"`);
  return { current, total };
}

function plan(shardArgument, outFile) {
  const { current, total } = parseShard(shardArgument);
  if (!outFile) throw new Error("Zieldatei für die Testliste fehlt");
  const durations = fs.existsSync(DURATIONS_FILE) ? JSON.parse(fs.readFileSync(DURATIONS_FILE, "utf8")) : {};
  const tests = listTests();
  const shards = planShards(tests, total, durations);
  const mine = shards[current - 1];

  for (const [index, shard] of shards.entries()) {
    console.log(`Teil ${index + 1}/${total}: ${shard.tests.length} Tests in ${shard.groups.length} Gruppen, `
      + `geschätzt ${Math.round(shard.seconds)} s Testzeit${index + 1 === current ? "  <- dieser Teil" : ""}`);
  }
  const lines = [...new Set(mine.tests.flatMap(linesFor))];
  fs.writeFileSync(outFile, `${lines.join("\n")}\n`);

  // Gegenprobe mit Playwright selbst: genau die geplanten Tests, keiner mehr, keiner weniger.
  const expected = new Set(mine.tests.map(testId));
  const actual = new Set(lines.length ? listTests([`--test-list=${outFile}`]).map(testId) : []);
  const missing = [...expected].filter((id) => !actual.has(id));
  const extra = [...actual].filter((id) => !expected.has(id));
  if (missing.length || extra.length) {
    console.error(`Die Testliste von Teil ${current} wählt nicht genau die geplanten Tests.`);
    for (const id of missing.slice(0, 20)) console.error(`  fehlt:    ${id}`);
    for (const id of extra.slice(0, 20)) console.error(`  zusätzlich: ${id}`);
    process.exit(1);
  }
  console.log(`Testliste ${outFile}: ${expected.size} Tests, von Playwright bestätigt.`);
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === "plan") return plan(rest[0], rest[1]);
  if (command === "durations") {
    const reports = rest.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
    return process.stdout.write(`${JSON.stringify(durationsFromReports(reports), null, 2)}\n`);
  }
  console.error("Aufruf: e2e-shards.mjs plan <n/gesamt> <datei> | durations <bericht.json>...");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
