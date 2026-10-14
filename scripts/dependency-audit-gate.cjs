"use strict";
// Gemeinsamer Auswerter der Paket-Audits von Website (yarn audit) und App (npm audit), #1055.
//
// Grundsatz: Grün gibt es nur für einen vollständig gelesenen Bericht. Fehlt der Bericht, meldet das Werkzeug einen
// Fehler (etwa kein Netz) oder passt das JSON nicht zum erwarteten Aufbau, schlägt das Gate fehl, statt still zu
// bestehen. Ausnahmen brauchen Paket, Ablaufdatum und Begründung; eine bald ablaufende Ausnahme wird angekündigt.
//
// Aufgerufen von frontend/scripts/audit-high.js und mobile/scripts/audit-ci.cjs; geprüft von
// scripts/dependency-audit-gate.test.mjs.

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const SEVERITIES = Object.keys(SEVERITY_RANK);
const GHSA = /^GHSA(-[0-9A-Z]{4}){3}$/;
// Ab so vielen Tagen vor dem Ablauf kündigt das Gate eine Ausnahme an.
const WARN_DAYS = 30;

class AuditReportError extends Error {}

const isCount = (value) => Number.isInteger(value) && value >= 0;
const atLeast = (severity, threshold) => SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];

function requireSeverity(severity, where) {
  if (!Object.hasOwn(SEVERITY_RANK, severity)) {
    throw new AuditReportError(`${where}: unbekannte Schwere ${JSON.stringify(severity)}`);
  }
}

function ghsaFromUrl(url) {
  const match = String(url || "").match(/GHSA(-[0-9a-z]{4}){3}/i);
  return match ? match[0].toUpperCase() : null;
}

// yarn 1: eine JSON-Zeile je Ereignis. Pflicht ist genau eine auditSummary; jede Fehlerzeile bricht ab.
function parseYarnAudit(stdout, threshold) {
  const records = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      throw new AuditReportError(`yarn audit lieferte eine Zeile, die kein JSON ist: ${line.slice(0, 120)}`);
    }
  }
  const errors = records.filter((record) => record && record.type === "error");
  if (errors.length) {
    throw new AuditReportError(`yarn audit meldete einen Fehler: ${String(errors[0].data).split("\n")[0]}`);
  }
  const summaries = records.filter((record) => record && record.type === "auditSummary");
  if (summaries.length !== 1) {
    throw new AuditReportError(`yarn audit lieferte ${summaries.length} statt genau einer Zusammenfassung (auditSummary)`);
  }
  const counts = summaries[0].data && summaries[0].data.vulnerabilities;
  if (!counts || !SEVERITIES.every((severity) => isCount(counts[severity]))) {
    throw new AuditReportError("die Zusammenfassung von yarn audit hat keine Zählung je Schwere");
  }

  const advisories = [];
  for (const record of records.filter((item) => item && item.type === "auditAdvisory")) {
    const advisory = record.data && record.data.advisory;
    if (!advisory || typeof advisory.module_name !== "string") {
      throw new AuditReportError("ein auditAdvisory von yarn audit hat keinen Paketnamen");
    }
    requireSeverity(advisory.severity, `yarn audit, ${advisory.module_name}`);
    if (!atLeast(advisory.severity, threshold)) continue;
    advisories.push({
      id: ghsaFromUrl(advisory.github_advisory_id) || ghsaFromUrl(advisory.url) || `yarn:${advisory.id}`,
      module: advisory.module_name,
      severity: advisory.severity,
      title: advisory.title || "ohne Titel",
    });
  }
  // Zählt die Zusammenfassung Funde ab der Schwelle, die Einzelmeldungen aber nicht, hat sich das Format geändert.
  const counted = SEVERITIES.filter((severity) => atLeast(severity, threshold))
    .reduce((sum, severity) => sum + counts[severity], 0);
  if (counted > 0 && advisories.length === 0) {
    throw new AuditReportError(`yarn audit zählt ${counted} Funde ab "${threshold}", aber keine lesbare Einzelmeldung`);
  }
  return dedupe(advisories);
}

// npm 7+: ein JSON-Objekt mit auditReportVersion 2. Ein Netzwerkfehler kommt als {"message", "error"} zurück.
function parseNpmAudit(stdout, threshold) {
  let report;
  try {
    report = JSON.parse(String(stdout || ""));
  } catch {
    throw new AuditReportError("npm audit lieferte kein JSON");
  }
  if (!report || typeof report !== "object") throw new AuditReportError("npm audit lieferte kein JSON-Objekt");
  if (report.error) {
    const reason = report.message || report.error.summary || report.error.code || "ohne Angabe";
    throw new AuditReportError(`npm audit meldete einen Fehler: ${String(reason).split("\n")[0]}`);
  }
  if (report.auditReportVersion !== 2) {
    throw new AuditReportError(`unbekanntes Format von npm audit (auditReportVersion ${JSON.stringify(report.auditReportVersion)})`);
  }
  const counts = report.metadata && report.metadata.vulnerabilities;
  if (!counts || !SEVERITIES.every((severity) => isCount(counts[severity]))) {
    throw new AuditReportError("der Bericht von npm audit hat keine Zählung je Schwere (metadata.vulnerabilities)");
  }
  const vulnerabilities = report.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object" || Array.isArray(vulnerabilities)) {
    throw new AuditReportError("der Bericht von npm audit hat keine Liste der Funde (vulnerabilities)");
  }

  const relevant = {};
  for (const [name, item] of Object.entries(vulnerabilities)) {
    requireSeverity(item && item.severity, `npm audit, ${name}`);
    if (!Array.isArray(item.via)) throw new AuditReportError(`npm audit, ${name}: Herkunft (via) fehlt`);
    if (atLeast(item.severity, threshold)) relevant[name] = item;
  }
  // npm zählt in metadata je Paket; weicht das von der Liste ab, ist der Bericht nicht der erwartete.
  const counted = SEVERITIES.filter((severity) => atLeast(severity, threshold))
    .reduce((sum, severity) => sum + counts[severity], 0);
  if (counted !== Object.keys(relevant).length) {
    throw new AuditReportError(
      `npm audit zählt ${counted} Pakete ab "${threshold}", die Liste enthält aber ${Object.keys(relevant).length}`,
    );
  }

  const advisories = [];
  for (const [name, item] of Object.entries(relevant)) {
    for (const source of item.via) {
      if (!source || typeof source === "string") continue;
      requireSeverity(source.severity, `npm audit, Meldung zu ${name}`);
      advisories.push({
        id: ghsaFromUrl(source.url) || `npm:${source.source || name}`,
        module: source.name || name,
        severity: source.severity,
        title: source.title || "ohne Titel",
      });
    }
  }
  // Ein Paket ab der Schwelle, das auf keine Meldung zurückführt, kann keine Ausnahme decken.
  const traced = new Set();
  const trace = (name, seen) => {
    if (traced.has(name)) return true;
    if (seen.has(name) || !relevant[name]) return false;
    seen.add(name);
    const ok = relevant[name].via.some((source) => (typeof source === "string" ? trace(source, seen) : Boolean(source)));
    if (ok) traced.add(name);
    return ok;
  };
  const untraceable = Object.keys(relevant).filter((name) => !trace(name, new Set()));
  return { advisories: dedupe(advisories), untraceable };
}

function dedupe(advisories) {
  return [...new Map(advisories.map((advisory) => [`${advisory.id}|${advisory.module}`, advisory])).values()];
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Länger als ein Kalenderjahr darf keine Ausnahme gelten, sonst wäre das Ablaufdatum nur Zierde. Heute plus ein Jahr;
// vom 29. Februar aus ist es der 28. Februar des Folgejahres.
function latestExpiry(today) {
  const [year, month, day] = today.split("-").map(Number);
  const limit = new Date(Date.UTC(year + 1, month - 1, day));
  if (limit.getUTCMonth() !== month - 1) limit.setUTCDate(0);
  return limit.toISOString().slice(0, 10);
}

// Jede Ausnahme braucht eine GHSA-Kennung, das Paket, ein echtes Ablaufdatum (höchstens ein Jahr) und eine Begründung.
function validateAllowlist(allowlist, today) {
  const problems = [];
  if (!allowlist || typeof allowlist !== "object" || Array.isArray(allowlist)) {
    return ["die Ausnahmeliste ist kein JSON-Objekt"];
  }
  for (const [id, entry] of Object.entries(allowlist)) {
    if (!GHSA.test(id)) problems.push(`${id}: keine gültige GHSA-Kennung in Großbuchstaben`);
    if (!entry || typeof entry !== "object") {
      problems.push(`${id}: Eintrag ist kein Objekt`);
      continue;
    }
    if (typeof entry.module !== "string" || !entry.module.trim()) problems.push(`${id}: Paket (module) fehlt`);
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
      problems.push(`${id}: Begründung (reason) fehlt oder ist zu knapp`);
    }
    if (!isIsoDate(entry.expires)) {
      problems.push(`${id}: Ablaufdatum (expires) fehlt oder ist kein Datum JJJJ-MM-TT`);
    } else if (entry.expires > latestExpiry(today)) {
      problems.push(`${id}: Ablaufdatum ${entry.expires} liegt nach ${latestExpiry(today)} (mehr als ein Jahr voraus)`);
    }
  }
  return problems;
}

function evaluate(advisories, allowlist, today, warnDays = WARN_DAYS) {
  const accepted = [];
  const blocking = [];
  const expiring = [];
  const used = new Set();
  for (const advisory of advisories) {
    const exception = Object.hasOwn(allowlist, advisory.id) ? allowlist[advisory.id] : null;
    if (!exception) {
      blocking.push({ ...advisory, why: "keine Ausnahme" });
      continue;
    }
    used.add(advisory.id);
    if (exception.module !== advisory.module) {
      blocking.push({ ...advisory, why: `Ausnahme gilt für ${exception.module}, nicht für ${advisory.module}` });
    } else if (exception.expires < today) {
      blocking.push({ ...advisory, why: `Ausnahme ist am ${exception.expires} abgelaufen` });
    } else {
      const daysLeft = daysBetween(today, exception.expires);
      accepted.push({ ...advisory, expires: exception.expires, daysLeft });
      if (daysLeft <= warnDays) expiring.push({ ...advisory, expires: exception.expires, daysLeft });
    }
  }
  const unused = Object.keys(allowlist).filter((id) => !used.has(id));
  return { accepted, blocking, expiring, unused };
}

// GitHub-Workflow-Befehl; Doppelpunkt und Komma im Titel müssen kodiert sein, sonst bricht GitHub den Titel ab.
function annotation(level, title, text) {
  const data = (value) => String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const property = (value) => data(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return `::${level} title=${property(title)}::${data(text)}\n`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Führt das Audit aus und gibt den Exit-Code zurück. options: name, threshold, allowlist, parse(stdout, threshold),
// result (spawnSync-Ergebnis), today, out/err (Schreibfunktionen), annotate (GitHub-Hinweise ausgeben).
function runGate(options) {
  const { name, threshold, allowlist, parse, result } = options;
  const today = options.today || todayIso();
  const out = options.out || ((text) => process.stdout.write(text));
  const err = options.err || ((text) => process.stderr.write(text));
  const annotate = options.annotate === undefined ? process.env.GITHUB_ACTIONS === "true" : options.annotate;
  const fail = (lines) => {
    for (const line of lines) err(`${line}\n`);
    err(`${name}: Gate fehlgeschlagen.\n`);
    return 1;
  };

  const allowlistProblems = validateAllowlist(allowlist, today);
  if (allowlistProblems.length) {
    return fail(allowlistProblems.map((problem) => `[Ausnahmeliste] ${problem}`));
  }
  if (result.error) {
    return fail([`[nicht auswertbar] Audit konnte nicht starten: ${result.error.message}`]);
  }

  let parsed;
  try {
    parsed = parse(result.stdout, threshold);
  } catch (error) {
    if (!(error instanceof AuditReportError)) throw error;
    const stderr = String(result.stderr || "").trim().split(/\r?\n/)
      .filter((line) => line && !/DeprecationWarning|trace-deprecation/.test(line))
      .map((line) => {
        // yarn schreibt Fehler als JSON-Zeile samt Stacktrace; die erste Zeile der Meldung genügt.
        try {
          const record = JSON.parse(line);
          if (record && typeof record.data === "string") return `${record.type}: ${record.data.split("\n")[0]}`;
        } catch {
          // keine JSON-Zeile, so ausgeben
        }
        return line;
      });
    return fail([
      `[nicht auswertbar] ${error.message}`,
      `Exit-Code des Audits: ${result.status}. Ohne lesbaren Bericht gibt es kein Grün (Netzwerk? Registry? Formatänderung?).`,
      ...stderr.slice(-5),
    ]);
  }
  const advisories = Array.isArray(parsed) ? parsed : parsed.advisories;
  const untraceable = Array.isArray(parsed) ? [] : parsed.untraceable;
  const { accepted, blocking, expiring, unused } = evaluate(advisories, allowlist, today);

  if (blocking.length || untraceable.length) {
    return fail([
      ...blocking.map((item) => `[blockiert] ${item.module}: ${item.id} (${item.severity}) ${item.title} – ${item.why}`),
      ...untraceable.map((item) => `[blockiert] ${item}: Fund ohne nachvollziehbare Meldung`),
      `${blocking.length + untraceable.length} Fund(e) ab "${threshold}" ohne gültige Ausnahme.`,
    ]);
  }

  for (const item of accepted) {
    out(`Ausnahme bis ${item.expires} (noch ${item.daysLeft} Tage): ${item.id} (${item.module})\n`);
  }
  for (const item of expiring) {
    const text = `Ausnahme ${item.id} (${item.module}) läuft am ${item.expires} ab, noch ${item.daysLeft} Tage. `
      + "Danach wird das Gate rot: Paket aktualisieren oder Ausnahme mit neuer Begründung verlängern.";
    out(`WARNUNG: ${text}\n`);
    if (annotate) out(annotation("warning", `${name}: Ausnahme läuft bald ab`, text));
  }
  for (const id of unused) {
    const text = `Ausnahme ${id} (${allowlist[id].module}) wird nicht mehr gebraucht und kann aus der Liste.`;
    out(`HINWEIS: ${text}\n`);
    if (annotate) out(annotation("notice", `${name}: Ausnahme ungenutzt`, text));
  }
  out(`${name}: Gate bestanden, keine Funde ab "${threshold}" ohne gültige Ausnahme.\n`);
  return 0;
}

module.exports = {
  AuditReportError,
  latestExpiry,
  WARN_DAYS,
  evaluate,
  parseNpmAudit,
  parseYarnAudit,
  runGate,
  validateAllowlist,
};
