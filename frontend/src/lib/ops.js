// Betrieb (#233, #265): Ampeln, Farben und Sätze für die Tageszentrale und
// Admin → Betrieb, damit Seite und Kachel dieselbe Sprache sprechen.

export const TONE_COLORS = { ok: "#00FF88", warn: "#FFD700", crit: "#FF3B30" };
export const STATUS_LABELS = { ok: "grün", warn: "gelb", crit: "rot" };
export const RATING_LABELS = { good: "gut", "needs-improvement": "mäßig", poor: "schlecht" };
export const RATING_TONES = { good: "ok", "needs-improvement": "warn", poor: "crit" };

/** Der Satz zu den Auto-Checks: „Checks: 1 rot, 2 gelb (12:05)“ oder „Checks: alle grün“. */
export function checksLabel(checks) {
  if (!checks?.status) return "";
  const counts = checks.counts || {};
  if (checks.status === "ok") return "Checks: alle grün";
  const parts = [];
  if (counts.crit) parts.push(`${counts.crit} rot`);
  if (counts.warn) parts.push(`${counts.warn} gelb`);
  return `Checks: ${parts.join(", ")}`;
}

/** Die Farbe der Kachel „Betrieb“: rote Checks und offene Fehler zuerst. */
export function opsTone(ops) {
  if (!ops) return TONE_COLORS.ok;
  if (ops.checks?.status === "crit" || (ops.open_error_groups || 0) > 0) return TONE_COLORS.crit;
  if (ops.checks?.status === "warn" || (ops.slow_requests_24h || 0) > 20) return TONE_COLORS.warn;
  return TONE_COLORS.ok;
}

/** Was in der Kachel „Betrieb“ steht. */
export function opsDetail(ops) {
  if (!ops) return "Server-Fehler, langsame Anfragen und Auto-Checks";
  const parts = [`${ops.open_error_groups ?? 0} Fehlergruppen offen`, `${ops.slow_requests_24h ?? 0} langsame Anfragen in 24 h`];
  const checks = checksLabel(ops.checks);
  if (checks) parts.push(checks);
  return parts.join(", ");
}

/** Messwert lesbar: Millisekunden ganz, CLS mit drei Stellen. */
export function formatVital(name, value) {
  if (value === null || value === undefined) return "–";
  if (name === "CLS") return Number(value).toFixed(3);
  return `${Math.round(Number(value))} ms`;
}

export function ratingTone(rating) {
  return RATING_TONES[rating] || "plain";
}

/** Eine Zeile zum letzten Lauf: Zeitpunkt und die Namen der nicht grünen Prüfungen. */
export function describeRun(run) {
  if (!run) return "Noch kein Lauf.";
  const when = run.at ? new Date(run.at).toLocaleString("de-DE") : "";
  if (run.status === "ok") return `Alle Prüfungen grün${when ? ` (${when})` : ""}.`;
  const failing = (run.checks || []).filter((c) => c.status !== "ok").map((c) => `${c.label}: ${STATUS_LABELS[c.status] || c.status}`);
  return `${failing.join(" · ")}${when ? ` (${when})` : ""}`;
}
