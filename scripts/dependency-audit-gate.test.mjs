// Selbsttest des Audit-Auswerters (#1055). Läuft vor jedem Audit (audit:high im Web, audit:ci in der App).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseNpmAudit, parseYarnAudit, runGate, validateAllowlist } = require("./dependency-audit-gate.cjs");

const TODAY = "2026-10-13";
const REASON = "Keine reparierte Version, nur Entwicklungswerkzeug, nicht im App-Paket.";

function gate({ parse, threshold, stdout, allowlist = {}, status = 0, error, stderr = "" }) {
  const lines = { out: [], err: [] };
  const code = runGate({
    name: "Test-Audit",
    threshold,
    allowlist,
    parse,
    result: { stdout, stderr, status, error },
    today: TODAY,
    annotate: true,
    out: (text) => lines.out.push(text),
    err: (text) => lines.err.push(text),
  });
  return { code, out: lines.out.join(""), err: lines.err.join("") };
}

// ------------------------------------------------------------------ yarn 1 (Website)

const yarnSummary = (counts = {}) => JSON.stringify({
  type: "auditSummary",
  data: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...counts }, totalDependencies: 263 },
});
const yarnAdvisory = (overrides = {}) => JSON.stringify({
  type: "auditAdvisory",
  data: {
    resolution: { id: 1, path: "a>b" },
    advisory: {
      id: 1240001,
      module_name: "beispiel",
      severity: "high",
      title: "Beispielmeldung",
      github_advisory_id: "GHSA-AAAA-BBBB-CCCC",
      ...overrides,
    },
  },
});
const yarn = (stdout, extra = {}) => gate({ parse: parseYarnAudit, threshold: "high", stdout, ...extra });

test("yarn: sauberer Bericht besteht", () => {
  const result = yarn(`${yarnSummary()}\n`);
  assert.equal(result.code, 0);
  assert.match(result.out, /Gate bestanden/);
});

test("yarn: Netzwerkfehler (nur Info-Zeile, keine Zusammenfassung) wird rot", () => {
  const stdout = '{"type":"info","data":"Visit https://yarnpkg.com/en/docs/cli/audit for documentation about this command."}\n';
  const result = yarn(stdout, { status: 1, stderr: '{"type":"error","data":"Error: ... ECONNREFUSED"}' });
  assert.equal(result.code, 1);
  assert.match(result.err, /nicht auswertbar.*Zusammenfassung/);
});

test("yarn: leere Ausgabe und Fehlerzeilen werden rot", () => {
  assert.equal(yarn("").code, 1);
  const result = yarn(`{"type":"error","data":"Error: getaddrinfo ENOTFOUND"}\n${yarnSummary()}\n`);
  assert.equal(result.code, 1);
  assert.match(result.err, /meldete einen Fehler.*ENOTFOUND/);
});

test("yarn: Zusammenfassung zählt Funde, Einzelmeldungen fehlen (Formatänderung) – rot", () => {
  const result = yarn(`${yarnSummary({ high: 2 })}\n`);
  assert.equal(result.code, 1);
  assert.match(result.err, /zählt 2 Funde/);
});

test("yarn: Fund ohne Ausnahme blockiert und nennt Paket und Kennung", () => {
  const result = yarn(`${yarnAdvisory()}\n${yarnSummary({ high: 1 })}\n`);
  assert.equal(result.code, 1);
  assert.match(result.err, /\[blockiert\] beispiel: GHSA-AAAA-BBBB-CCCC \(high\).*keine Ausnahme/);
});

test("yarn: gültige Ausnahme lässt bestehen; moderate liegt unter der Schwelle", () => {
  const allowlist = { "GHSA-AAAA-BBBB-CCCC": { module: "beispiel", expires: "2026-12-31", reason: REASON } };
  const stdout = `${yarnAdvisory()}\n${yarnAdvisory({ severity: "moderate", github_advisory_id: "GHSA-DDDD-EEEE-FFFF" })}\n${yarnSummary({ high: 1, moderate: 1 })}\n`;
  const result = yarn(stdout, { allowlist });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Ausnahme bis 2026-12-31 \(noch 79 Tage\): GHSA-AAAA-BBBB-CCCC/);
  assert.doesNotMatch(result.out, /WARNUNG/);
});

test("yarn: unbekannte Schwere ist ein Formatfehler", () => {
  const result = yarn(`${yarnAdvisory({ severity: "severe" })}\n${yarnSummary({ high: 1 })}\n`);
  assert.equal(result.code, 1);
  assert.match(result.err, /unbekannte Schwere/);
});

// ------------------------------------------------------------------ npm 7+ (App)

function npmReport(vulnerabilities, countsOverride) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const item of Object.values(vulnerabilities)) counts[item.severity] += 1;
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { ...counts, ...countsOverride, total: Object.keys(vulnerabilities).length } },
  });
}
const direct = (name, severity, ghsa) => ({
  name,
  severity,
  via: [{ source: 1, name, dependency: name, title: `${name}-Meldung`, url: `https://github.com/advisories/${ghsa}`, severity }],
});
const viaPackage = (name, severity, ...via) => ({ name, severity, via });
// Nachbau des aktuellen App-Befunds: drei Meldungen ohne Reparatur, über Werkzeugketten erreicht.
const appFinding = {
  "node-forge": direct("node-forge", "high", "GHSA-86w9-cpqp-85rv"),
  braces: direct("braces", "high", "GHSA-vfj7-8cjw-p6xm"),
  micromatch: viaPackage("micromatch", "high", "braces"),
  "sprintf-js": direct("sprintf-js", "moderate", "GHSA-hp3w-g68c-fv3c"),
  argparse: viaPackage("argparse", "moderate", "sprintf-js"),
};
const appAllowlist = (expires = "2027-01-02") => ({
  "GHSA-86W9-CPQP-85RV": { module: "node-forge", expires, reason: REASON },
  "GHSA-VFJ7-8CJW-P6XM": { module: "braces", expires, reason: REASON },
  "GHSA-HP3W-G68C-FV3C": { module: "sprintf-js", expires, reason: REASON },
});
const npm = (stdout, extra = {}) => gate({ parse: parseNpmAudit, threshold: "moderate", stdout, status: 1, ...extra });

test("npm: aktueller Befund mit gültigen Ausnahmen besteht", () => {
  const result = npm(npmReport(appFinding), { allowlist: appAllowlist() });
  assert.equal(result.code, 0, result.err);
  for (const id of ["GHSA-86W9-CPQP-85RV", "GHSA-VFJ7-8CJW-P6XM", "GHSA-HP3W-G68C-FV3C"]) {
    assert.match(result.out, new RegExp(`Ausnahme bis 2027-01-02 \\(noch 81 Tage\\): ${id}`));
  }
});

test("npm: Netzwerkfehler (so wie npm 11 ihn liefert) wird rot statt grün", () => {
  const stdout = JSON.stringify({
    message: "request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED",
    error: { summary: "", detail: "" },
  });
  const result = npm(stdout, { allowlist: appAllowlist() });
  assert.equal(result.code, 1);
  assert.match(result.err, /nicht auswertbar.*ECONNREFUSED/);
});

test("npm: kein JSON, fehlende Version, fehlende Zählung oder Liste – jeweils rot", () => {
  assert.equal(npm("").code, 1);
  assert.equal(npm("npm ERR! something").code, 1);
  assert.match(npm(JSON.stringify({ vulnerabilities: {}, metadata: {} })).err, /auditReportVersion/);
  assert.match(npm(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} })).err, /Zählung je Schwere/);
  const noList = JSON.stringify({ auditReportVersion: 2, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } });
  assert.match(npm(noList).err, /Liste der Funde/);
});

test("npm: Zählung und Liste passen nicht zusammen (Formatänderung) – rot", () => {
  const result = npm(npmReport({}, { high: 3 }));
  assert.equal(result.code, 1);
  assert.match(result.err, /zählt 3 Pakete/);
});

test("npm: unbekannte Schwere ist ein Formatfehler", () => {
  const result = npm(npmReport({ x: { name: "x", severity: "high", via: [] } }).replace('"severity":"high"', '"severity":"urgent"'));
  assert.equal(result.code, 1);
  assert.match(result.err, /unbekannte Schwere/);
});

test("npm: abgelaufene Ausnahme blockiert mit Datum", () => {
  const result = npm(npmReport(appFinding), { allowlist: appAllowlist("2026-10-12") });
  assert.equal(result.code, 1);
  assert.match(result.err, /node-forge: GHSA-86W9-CPQP-85RV \(high\).*Ausnahme ist am 2026-10-12 abgelaufen/);
});

test("npm: Ausnahme für ein anderes Paket deckt den Fund nicht", () => {
  const allowlist = appAllowlist();
  allowlist["GHSA-86W9-CPQP-85RV"].module = "anderes-paket";
  const result = npm(npmReport(appFinding), { allowlist });
  assert.equal(result.code, 1);
  assert.match(result.err, /gilt für anderes-paket, nicht für node-forge/);
});

test("npm: bald ablaufende Ausnahme wird angekündigt (Text und GitHub-Hinweis), Ablauftag selbst noch gültig", () => {
  const soon = npm(npmReport(appFinding), { allowlist: appAllowlist("2026-11-02") });
  assert.equal(soon.code, 0, soon.err);
  assert.match(soon.out, /WARNUNG: Ausnahme GHSA-VFJ7-8CJW-P6XM \(braces\) läuft am 2026-11-02 ab, noch 20 Tage/);
  assert.match(soon.out, /::warning title=Test-Audit%3A Ausnahme läuft bald ab::Ausnahme GHSA-/);
  const lastDay = npm(npmReport(appFinding), { allowlist: appAllowlist(TODAY) });
  assert.equal(lastDay.code, 0, lastDay.err);
  assert.match(lastDay.out, /noch 0 Tage/);
});

test("npm: Fund ohne nachvollziehbare Meldung blockiert", () => {
  const result = npm(npmReport({ waise: viaPackage("waise", "high", "gibt-es-nicht") }));
  assert.equal(result.code, 1);
  assert.match(result.err, /waise: Fund ohne nachvollziehbare Meldung/);
});

test("npm: nicht mehr gebrauchte Ausnahme wird gemeldet, Gate bleibt grün", () => {
  const result = npm(npmReport({}), { status: 0, allowlist: appAllowlist() });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /HINWEIS: Ausnahme GHSA-86W9-CPQP-85RV \(node-forge\) wird nicht mehr gebraucht/);
});

test("Audit startet nicht (Programm fehlt) – rot", () => {
  const result = npm(undefined, { error: new Error("spawn npm ENOENT") });
  assert.equal(result.code, 1);
  assert.match(result.err, /konnte nicht starten.*ENOENT/);
});

// ------------------------------------------------------------------ Ausnahmeliste

test("Ausnahmen brauchen Paket, Ablaufdatum (höchstens ein Jahr) und Begründung", () => {
  assert.deepEqual(validateAllowlist(appAllowlist(), TODAY), []);
  const problems = validateAllowlist({
    "GHSA-AAAA-BBBB-CCCC": { module: "a", expires: "2027-01-02" },
    "GHSA-AAAA-BBBB-DDDD": { module: "b", reason: REASON },
    "GHSA-AAAA-BBBB-EEEE": { module: "c", expires: "2026-02-30", reason: REASON },
    "GHSA-AAAA-BBBB-FFFF": { module: "d", expires: "2099-01-01", reason: REASON },
    "ghsa-aaaa-bbbb-gggg": { module: "e", expires: "2027-01-02", reason: REASON },
    "GHSA-AAAA-BBBB-HHHH": { expires: "2027-01-02", reason: REASON },
  }, TODAY);
  assert.equal(problems.length, 6, problems.join("\n"));
  const result = npm(npmReport({}), { status: 0, allowlist: { "GHSA-AAAA-BBBB-CCCC": { module: "a", expires: "2027-01-02" } } });
  assert.equal(result.code, 1);
  assert.match(result.err, /\[Ausnahmeliste\] GHSA-AAAA-BBBB-CCCC: Begründung/);
});

test("die echten Ausnahmelisten von Website und App sind gültig", () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const file of ["../frontend/scripts/security-audit-allowlist.json", "../mobile/scripts/security-audit-allowlist.json"]) {
    assert.deepEqual(validateAllowlist(require(file), today), [], file);
  }
});
