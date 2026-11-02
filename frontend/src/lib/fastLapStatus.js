// Status einer Fast Lap (#2130): eine Liste für Verwaltung und Filter, damit beide dasselbe sagen.

export const F1_STATUS_OPTIONS = Object.freeze([
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
  ["registration_open", "Einreichung offen"],
  ["registration_closed", "Einreichung geschlossen"],
  ["live", "Live"],
  ["paused", "Pausiert"],
  ["completed", "Beendet"],
  ["results_published", "Ergebnisse veröffentlicht"],
  ["archived", "Archiviert"],
  ["cancelled", "Abgesagt"],
]);

export const F1_STATUS_LABELS = Object.freeze(Object.fromEntries(F1_STATUS_OPTIONS));

// Online-Einreichen gibt es noch nicht (#1278): die beiden Status bleiben nur für alte Challenges, die sie schon tragen.
export const SUBMISSION_STATUSES = new Set(["registration_open", "registration_closed"]);

/** Was im Status-Feld einer Challenge zur Wahl steht. */
export function statusOptionsFor(status) {
  return F1_STATUS_OPTIONS.filter(([value]) => !SUBMISSION_STATUSES.has(value) || value === status);
}

/** Was im Filter der Liste steht: alle Status - die Einreichungs-Status nur, wenn es solche Challenges gibt. */
export function statusFilterOptions(counts = {}) {
  return F1_STATUS_OPTIONS.filter(([value]) => !SUBMISSION_STATUSES.has(value) || (counts[value] || 0) > 0);
}

// Der Planer schaltet nur auf „Live“; „Beendet“ und „Ergebnisse veröffentlicht“ setzt die Turnierleitung (#1584).
export const LIVE_HINT = "Live schaltet sich mit dem Start von selbst. „Beendet“ und „Ergebnisse veröffentlicht“ setzt die Turnierleitung, wenn die Zeiten geprüft sind.";

const ARCHIVE_FREELY_FROM = new Set(["results_published", "archived", "cancelled"]);

/** Mit gewerteten Zeiten geht es erst über „Ergebnisse veröffentlicht“ ins Archiv - sonst gäbe es nie Saisonpunkte (#2130). */
export function archiveBlocked(challenge) {
  return !ARCHIVE_FREELY_FROM.has(challenge?.status) && (Number(challenge?.participant_count) || 0) > 0;
}
