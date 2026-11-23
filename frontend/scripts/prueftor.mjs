#!/usr/bin/env node
// Prüftor (#1660): fasst Barrierefreiheit, Kontrast, Bundle, Ladezeit und Bewegungsregeln zu einem Ergebnis zusammen.
//
// Liest die Teilergebnisse (alle optional - was fehlt, ist rot), die Ausnahmen aus dem PR-Text und das Ergebnis des
// letzten Laufs auf main zum Vergleich. Schreibt ergebnis.json und kommentar.md (für den einen Kommentar im PR) und
// endet mit 1, wenn eine Prüfung rot ist und der PR-Text sie nicht begründet.
//
//   node scripts/prueftor.mjs --bundle b.json --kontrast k.json --bewegung m.json --ladezeit l.json \
//     --playwright a.json [--playwright b.json] [--pr-text body.md] [--basis main.json] \
//     [--budgets-basis PERFORMANCE_BUDGETS.md von main] [--bekannt-basis prueftor-bekannt.json von main] \
//     [--sha …] [--lauf URL] --out-json e.json --out-md k.md
//
// Ausnahme im PR-Text, eine Zeile je Prüfung (Groß-/Kleinschreibung egal, Begründung mindestens 20 Zeichen):
//   Prüftor-Ausnahme bewegung: Die Leiste wächst absichtlich in der Breite, weil …

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PRUEFTOR_SPECS } = require("../e2e/prueftor-specs.js");

export const MARKER = "<!-- prueftor:1660 -->";
export const CHECKS = [
  { id: "a11y", label: "Barrierefreiheit (axe, Tastatur, Namen, 200 %)" },
  { id: "kontrast", label: "Kontrast" },
  { id: "bundle", label: "Bundle (Start, gzip)" },
  { id: "ladezeit", label: "Ladezeit Startseite am Handy" },
  { id: "bewegung", label: "Bewegungsregeln" },
];
const CHECK_IDS = new Set(CHECKS.map((check) => check.id));
export const MIN_REASON = 20;

/** HTML-Kommentare entfernen: Das Beispiel in der PR-Vorlage darf nicht als Ausnahme zählen. */
export function withoutHtmlComments(text) {
  let out = "";
  let index = 0;
  for (;;) {
    const start = text.indexOf("<!--", index);
    if (start < 0) return out + text.slice(index);
    out += text.slice(index, start);
    const end = text.indexOf("-->", start + 4);
    if (end < 0) return out;
    index = end + 3;
  }
}

/** Ausnahmen aus dem PR-Text: { bewegung: "Begründung" }. Ohne Regex über den Nutzertext (nur Zeilenvergleich). */
export function parseExceptions(body) {
  const exceptions = {};
  const problems = [];
  for (const raw of withoutHtmlComments(String(body || "").replace(/\r\n/g, "\n")).split("\n")) {
    let line = raw.trim();
    while (line.startsWith("-") || line.startsWith("*") || line.startsWith(">")) line = line.slice(1).trim();
    const lower = line.toLowerCase();
    const prefix = ["prüftor-ausnahme", "prueftor-ausnahme"].find((word) => lower.startsWith(word));
    if (!prefix) continue;
    const rest = line.slice(prefix.length).trim();
    const colon = rest.indexOf(":");
    const id = (colon >= 0 ? rest.slice(0, colon) : rest).trim().toLowerCase();
    const reason = colon >= 0 ? rest.slice(colon + 1).trim() : "";
    if (!CHECK_IDS.has(id)) problems.push(`unbekannte Prüfung „${id}“ (erlaubt: ${[...CHECK_IDS].join(", ")})`);
    else if (reason.length < MIN_REASON) problems.push(`Begründung für „${id}“ fehlt oder ist kürzer als ${MIN_REASON} Zeichen`);
    else exceptions[id] = reason;
  }
  return { exceptions, problems };
}

// Farbcodes in Fehlermeldungen von Playwright (ESC [ … m) - das Steuerzeichen nicht wörtlich in der Regex.
const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Tests aus JSON-Berichten von Playwright: [{ file, title, status, error }], status expected|unexpected|flaky|skipped. */
export function collectPlaywright(reports) {
  const tests = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const last = results[results.length - 1] || {};
        const error = (last.error && (last.error.message || last.error.value)) || "";
        tests.push({
          file: path.basename(spec.file || suite.file || ""),
          title: [...titles, spec.title].join(" › "),
          status: test.status || (spec.ok ? "expected" : "unexpected"),
          error: String(error).replace(ANSI_COLOR, "").split("\n").find((part) => part.trim()) || "",
        });
      }
    }
    for (const child of suite.suites || []) walk(child, child.title && !child.title.endsWith(".js") ? [...titles, child.title] : titles);
  };
  for (const report of reports) for (const suite of report.suites || []) walk(suite, []);
  return tests;
}

/** Zu welcher Prüfung gehört ein Browser-Test? Titel mit „Kontrast“ zählen zum Kontrast. */
export function checkForTest(test, specs = PRUEFTOR_SPECS) {
  if (/kontrast/i.test(test.title)) return "kontrast";
  return specs.find((spec) => spec.file === test.file)?.check || null;
}

function browserSummary(tests) {
  const failed = tests.filter((test) => test.status === "unexpected");
  const passed = tests.filter((test) => test.status === "expected" || test.status === "flaky");
  return {
    ok: tests.length > 0 && failed.length === 0,
    passed: passed.length,
    total: tests.filter((test) => test.status !== "skipped").length,
    flaky: tests.filter((test) => test.status === "flaky").map((test) => test.title),
    failed: failed.map((test) => `${test.file}: ${test.title}${test.error ? ` – ${test.error.slice(0, 160)}` : ""}`),
  };
}

/** Grenzen in PERFORMANCE_BUDGETS.md, die gegenüber main höher liegen („<!-- budget:… -->“). */
export function raisedBudgets(current, base) {
  const read = (text) => Object.fromEntries([...String(text || "").matchAll(/<!-- budget:([a-z0-9-]+) (\d+) -->/g)].map((match) => [match[1], Number(match[2])]));
  const now = read(current);
  const before = read(base);
  return Object.entries(now).filter(([key, value]) => key in before && value > before[key]).map(([key, value]) => ({ key, before: before[key], after: value }));
}

/** Bekannte Funde (e2e/prueftor-bekannt.json), die main noch nicht kennt: [{ seite, art, ziel, check }]. */
export function knownGrowth(current, base) {
  const key = (fund) => `${fund.seite}|${fund.art}|${fund.ziel}`;
  const before = new Set(((base && base.funde) || []).map(key));
  return ((current && current.funde) || []).filter((fund) => !before.has(key(fund)))
    .map((fund) => ({ ...fund, check: fund.art === "kontrast" ? "kontrast" : "a11y" }));
}

const budgetCheck = (key) => (key.startsWith("home-mobile-") ? "ladezeit" : "bundle");

/** Ergebnis je Prüfung aus allen Teilen. Fehlt ein Teil, ist die Prüfung rot („nicht gelaufen“). */
export function evaluate({ bundle, kontrast, bewegung, ladezeit, tests = [], prText = "", raised = [], knownAdded = [] }) {
  const { exceptions, problems: exceptionProblems } = parseExceptions(prText);
  const byCheck = Object.fromEntries(CHECKS.map((check) => [check.id, []]));
  for (const test of tests) {
    const check = checkForTest(test);
    if (check) byCheck[check].push(test);
  }
  const results = {};
  const add = (id, ok, metrics, details = []) => { results[id] = { ok, metrics, details }; };
  const missing = (what) => `${what} fehlt - nicht gelaufen (Bau oder Schritt davor fehlgeschlagen?)`;

  const a11y = browserSummary(byCheck.a11y);
  add("a11y", a11y.ok, { tests: a11y.passed, total: a11y.total }, a11y.total ? a11y.failed : [missing("Browser-Ergebnis")]);

  const contrastBrowser = browserSummary(byCheck.kontrast);
  const palette = kontrast || null;
  add("kontrast", Boolean(palette && palette.ok) && contrastBrowser.ok,
    { palette: palette ? palette.total - palette.failed.length : 0, paletteTotal: palette ? palette.total : 0, seiten: contrastBrowser.passed, seitenTotal: contrastBrowser.total },
    [...(palette ? palette.failed.map((item) => `Palette: ${item}`) : [missing("Kontrast der Palette")]),
      ...(contrastBrowser.total ? contrastBrowser.failed : [missing("Kontrast der Seiten")])]);

  if (bundle) {
    add("bundle", bundle.ok, { jsGzip: bundle.jsGzip, cssGzip: bundle.cssGzip, budgetJs: bundle.budgetJs, budgetCss: bundle.budgetCss, goalJs: bundle.goalJs }, bundle.failures || []);
  } else add("bundle", false, {}, [missing("Bundle-Messung")]);

  const loadBrowser = browserSummary(byCheck.ladezeit);
  const loadDetails = [...loadBrowser.failed];
  if (!ladezeit) loadDetails.push(missing("Ladezeit-Messung"));
  if (ladezeit && Number.isFinite(ladezeit.goalLcpMs) && ladezeit.lcpMs > ladezeit.goalLcpMs) {
    loadDetails.push(`Hinweis: LCP ${ladezeit.lcpMs} ms liegt über dem Ziel von ${ladezeit.goalLcpMs} ms (Grenze ${ladezeit.budgetLcpMs} ms).`);
  }
  add("ladezeit", Boolean(ladezeit) && loadBrowser.ok,
    ladezeit ? { lcpMs: ladezeit.lcpMs, fcpMs: ladezeit.fcpMs, cls: ladezeit.cls, bytes: ladezeit.bytes, budgetLcpMs: ladezeit.budgetLcpMs, goalLcpMs: ladezeit.goalLcpMs, profile: ladezeit.profile } : {},
    loadDetails);

  const motionBrowser = browserSummary(byCheck.bewegung);
  const motionDetails = [...motionBrowser.failed];
  if (bewegung) {
    for (const item of bewegung.fresh || []) {
      motionDetails.push(`${item.file} – ${item.rule}: ${item.count} statt höchstens ${item.allowed} (${item.findings.slice(0, 5).map((finding) => `Zeile ${finding.line}: ${finding.detail}`).join("; ")})`);
    }
    for (const problem of bewegung.allowlistProblems || []) motionDetails.push(`Ausnahmeliste: ${problem}`);
  } else motionDetails.push(missing("Bewegungs-Prüfung"));
  add("bewegung", Boolean(bewegung) && !(bewegung.fresh || []).length && !(bewegung.allowlistProblems || []).length && motionBrowser.ok,
    bewegung ? { neu: (bewegung.fresh || []).reduce((sum, item) => sum + item.count - item.allowed, 0), bestand: bewegung.allowedTotal, funde: bewegung.total } : {},
    motionDetails);

  // Gelockerte Regeln (Ausnahmeliste erweitert, Grenze erhöht) sind nur mit Begründung im PR grün.
  const loosened = {};
  for (const item of (bewegung && bewegung.grown) || []) (loosened.bewegung ??= []).push(`Ausnahmeliste erweitert: ${item.file} ${item.rule} ${item.before} → ${item.after}`);
  for (const item of raised) (loosened[budgetCheck(item.key)] ??= []).push(`Grenze ${item.key} erhöht: ${item.before} → ${item.after}`);
  for (const item of knownAdded) (loosened[item.check] ??= []).push(`neuer bekannter Fund: ${item.seite} (${item.art}) ${item.ziel}`);

  for (const check of CHECKS) {
    const result = results[check.id];
    result.loosened = loosened[check.id] || [];
    const red = !result.ok || result.loosened.length > 0;
    result.exception = red && exceptions[check.id] ? exceptions[check.id] : null;
    result.status = !red ? "gruen" : result.exception ? "ausnahme" : "rot";
  }
  const blocking = CHECKS.filter((check) => results[check.id].status === "rot").map((check) => check.id);
  return { ok: blocking.length === 0, blocking, checks: results, exceptions, exceptionProblems };
}

// Text aus dem PR (Begründungen) und aus Dateien in den Kommentar: keine Erwähnungen, kein HTML, keine Tabellenbrüche.
export function safeText(value, max = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return text.replace(/[<>`|]/g, (char) => ({ "<": "‹", ">": "›", "`": "'", "|": "/" })[char]).replace(/@/g, "@​");
}

// Tausender mit Punkt, selbst gesetzt: toLocaleString("de-AT") liefert je nach ICU-Stand Punkt oder Leerzeichen.
const num = (value) => (Number.isFinite(value)
  ? `${value < 0 ? "-" : ""}${String(Math.round(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}` : "–");
const delta = (now, before, unit = "") => {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return "";
  const diff = now - before;
  if (diff === 0) return " (±0)";
  return ` (${diff > 0 ? "+" : "−"}${num(Math.abs(diff))}${unit})`;
};

function cells(id, metrics = {}, base = null) {
  const b = (base && base.checks && base.checks[id] && base.checks[id].metrics) || null;
  switch (id) {
    case "a11y":
      return [`${num(metrics.tests)} von ${num(metrics.total)} Tests`, b ? `${num(b.tests)} von ${num(b.total)}` : "–"];
    case "kontrast":
      return [`Palette ${num(metrics.palette)}/${num(metrics.paletteTotal)}, Seiten ${num(metrics.seiten)}/${num(metrics.seitenTotal)}`,
        b ? `Palette ${num(b.palette)}/${num(b.paletteTotal)}, Seiten ${num(b.seiten)}/${num(b.seitenTotal)}` : "–"];
    case "bundle":
      return [`JS ${num(metrics.jsGzip)} B${delta(metrics.jsGzip, b && b.jsGzip, " B")} / Grenze ${num(metrics.budgetJs)} B, CSS ${num(metrics.cssGzip)} B${delta(metrics.cssGzip, b && b.cssGzip, " B")}`,
        b ? `JS ${num(b.jsGzip)} B, CSS ${num(b.cssGzip)} B` : "–"];
    case "ladezeit":
      return [`LCP ${num(metrics.lcpMs)} ms${delta(metrics.lcpMs, b && b.lcpMs, " ms")} / Grenze ${num(metrics.budgetLcpMs)} ms, CLS ${metrics.cls ?? "–"}`,
        b ? `LCP ${num(b.lcpMs)} ms, CLS ${b.cls ?? "–"}` : "–"];
    case "bewegung":
      return [`${num(metrics.neu)} neue Verstöße, Bestand ${num(metrics.funde)}${delta(metrics.funde, b && b.funde)}`, b ? `Bestand ${num(b.funde)}` : "–"];
    default:
      return ["", ""];
  }
}

const STATUS = { gruen: "**grün**", rot: "**rot**", ausnahme: "**Ausnahme**" };

/** Der Kommentar im PR (Markdown). */
export function renderComment(result, { base = null, sha = "", runUrl = "" } = {}) {
  const lines = [MARKER, "## Prüftor: Barrierefreiheit, Ladezeit, Bewegung", ""];
  const exceptionsUsed = CHECKS.filter((check) => result.checks[check.id].status === "ausnahme");
  if (!result.ok) lines.push(`**Ergebnis: rot** – ${result.blocking.length} Prüfung(en) rot. Rot heißt nicht mergen; Ausnahmen nur mit Begründung im PR-Text.`);
  else if (exceptionsUsed.length) lines.push(`**Ergebnis: grün mit Ausnahme** – ${exceptionsUsed.map((check) => check.label).join(", ")} mit Begründung im PR-Text.`);
  else lines.push("**Ergebnis: grün** – alle Prüfungen bestanden.");
  lines.push("", "| Prüfung | Ergebnis | dieser PR | main |", "| --- | --- | --- | --- |");
  for (const check of CHECKS) {
    const item = result.checks[check.id];
    const [now, before] = cells(check.id, item.metrics, base);
    lines.push(`| ${check.label} | ${STATUS[item.status]} | ${safeText(now, 200)} | ${safeText(before, 200)} |`);
  }
  const detailChecks = CHECKS.filter((check) => result.checks[check.id].details.length || result.checks[check.id].loosened.length);
  if (detailChecks.length) {
    lines.push("", "<details><summary>Einzelheiten</summary>", "");
    for (const check of detailChecks) {
      const item = result.checks[check.id];
      lines.push(`**${check.label}**`, "");
      for (const detail of [...item.loosened, ...item.details].slice(0, 25)) lines.push(`- ${safeText(detail, 400)}`);
      lines.push("");
    }
    lines.push("</details>");
  }
  if (exceptionsUsed.length || result.exceptionProblems.length) {
    lines.push("", "### Ausnahmen aus dem PR-Text", "");
    for (const check of exceptionsUsed) lines.push(`- ${check.label}: „${safeText(result.checks[check.id].exception)}“`);
    for (const problem of result.exceptionProblems) lines.push(`- nicht gelesen: ${safeText(problem)}`);
  }
  const unused = Object.keys(result.exceptions).filter((id) => result.checks[id].status === "gruen");
  if (unused.length) lines.push("", `Ausnahme im PR-Text ohne Anlass (Prüfung ist grün): ${unused.join(", ")}.`);
  lines.push("", "<sub>");
  const parts = [];
  if (sha) parts.push(`Stand ${sha.slice(0, 9)}`);
  if (base && base.sha) parts.push(`Vergleich: main ${String(base.sha).slice(0, 9)}${base.date ? ` vom ${base.date}` : ""}`);
  else parts.push("Vergleich: noch kein Ergebnis von main");
  if (runUrl) parts.push(`[Lauf](${runUrl})`);
  lines.push(`${parts.join(" · ")}. Ausnahme begründen: Zeile „Prüftor-Ausnahme <prüfung>: <Begründung>“ in den PR-Text, dann den Job „Prüftor“ neu starten. Ablauf: docs/entwicklung/prueftor.md`);
  lines.push("</sub>", "");
  return lines.join("\n");
}

function argValues(name) {
  const values = [];
  process.argv.forEach((arg, index) => {
    if (arg === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  });
  return values;
}

function readJson(file) {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const readText = (file) => (file && existsSync(file) ? readFileSync(file, "utf8") : "");

function main() {
  const one = (name) => argValues(name)[0];
  const tests = collectPlaywright(argValues("--playwright").map(readJson).filter(Boolean));
  const budgetsNow = readText(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "PERFORMANCE_BUDGETS.md"));
  const budgetsBase = readText(one("--budgets-basis"));
  const knownBase = readJson(one("--bekannt-basis"));
  const knownNow = readJson(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "e2e", "prueftor-bekannt.json"));
  const result = evaluate({
    bundle: readJson(one("--bundle")),
    kontrast: readJson(one("--kontrast")),
    bewegung: readJson(one("--bewegung")),
    ladezeit: readJson(one("--ladezeit")),
    tests,
    prText: readText(one("--pr-text")),
    raised: budgetsBase ? raisedBudgets(budgetsNow, budgetsBase) : [],
    // Gibt es die Liste auf main noch nicht (Einführung), ist nichts „neu“.
    knownAdded: knownBase ? knownGrowth(knownNow, knownBase) : [],
  });
  const sha = one("--sha") || "";
  const base = readJson(one("--basis"));
  const record = { version: 1, sha, date: new Date().toISOString().slice(0, 10), ...result };
  if (one("--out-json")) writeFileSync(one("--out-json"), `${JSON.stringify(record, null, 2)}\n`);
  const comment = renderComment(result, { base, sha, runUrl: one("--lauf") || "" });
  if (one("--out-md")) writeFileSync(one("--out-md"), comment);
  for (const check of CHECKS) console.log(`${check.label}: ${result.checks[check.id].status}`);
  if (!result.ok) {
    console.error(`\nPrüftor rot: ${result.blocking.join(", ")}. Einzelheiten im Kommentar bzw. in der Zusammenfassung des Laufs.`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
