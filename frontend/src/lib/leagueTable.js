// Tabelle der Liga-Staffel (E.1, #1625, docs/LIGA.md „E.1 Tabelle“): Wörter für Gleichstand, kampflos und Ausscheiden,
// dazu die Tabellenregeln der Season als Formular. Gerechnet wird nur auf dem Server - hier wird beschriftet.

/** Was einen Gleichstand entschied - kurz für die Tabelle und die Einstellungen. */
export const TIEBREAK_LABELS = {
  head_to_head: "Direkter Vergleich",
  score_diff: "Map-Differenz",
  score_for: "Mehr gewonnene Maps",
  wins: "Mehr Siege",
  lead_decision: "Entscheid der Leitung",
};
export const TIEBREAK_KEYS = Object.keys(TIEBREAK_LABELS);
export const HEAD_TO_HEAD_LABELS = { points: "Punkte", score_diff: "Map-Differenz", score_for: "Gewonnene Maps" };
export const FORFEIT_SCORE_OPTIONS = [
  ["best_of", "Maps des Best of (BO5 3:0)"],
  ["recorded", "Wie eingetragen"],
];
export const EXIT_RULE_OPTIONS = [
  ["all_for_opponents", "Alle Spiele zählen für die Gegner, Team ans Tabellenende"],
  ["half", "50-%-Regel: annullieren oder Rest kampflos"],
];
const EXIT_LABELS = { withdrawn: "Ausgetreten", disqualified: "Disqualifiziert" };

// Vorgaben neuer Liga-Seasons (Server: scoring_rules.LEAGUE_TABLE_DEFAULTS) - nur, wenn die Season die Felder nicht trägt.
const OLD_DEFAULTS = { table_tiebreakers: ["score_diff", "score_for"], head_to_head_criteria: ["points", "score_diff", "score_for"],
  allow_draws: true, forfeit_score: "recorded", exit_rule: "half" };

/** Die Tabellenregeln einer Season als Formularwerte; fehlt ein Feld (ältere Season), gilt, was der Server dann rechnet. */
export function tableRulesToForm(rules = {}) {
  return {
    table_tiebreakers: rules.table_tiebreakers || OLD_DEFAULTS.table_tiebreakers,
    head_to_head_criteria: rules.head_to_head_criteria || OLD_DEFAULTS.head_to_head_criteria,
    allow_draws: rules.allow_draws ?? OLD_DEFAULTS.allow_draws,
    forfeit_score: rules.forfeit_score || OLD_DEFAULTS.forfeit_score,
    exit_rule: rules.exit_rule || OLD_DEFAULTS.exit_rule,
  };
}

/** Die Formularwerte zurück in ``scoring_rules`` (ohne Punkte - die setzt das Season-Formular). */
export function tableRulesPayload(form) {
  return {
    table_tiebreakers: form.table_tiebreakers,
    head_to_head_criteria: form.head_to_head_criteria,
    allow_draws: Boolean(form.allow_draws),
    forfeit_score: form.forfeit_score,
    exit_rule: form.exit_rule,
  };
}

/** Kurztext der Reihenfolge: „Punkte → Direkter Vergleich → Map-Differenz …“. */
export function tiebreakOrder(keys) {
  return ["Punkte", ...(keys || []).map((key) => TIEBREAK_LABELS[key]).filter(Boolean)].join(" → ");
}

/** Hinweise an einer Zeile der Staffel-Tabelle: was den Platz entschied, kampflos, Abzug, Ausscheiden. Leer bei
 *  Tabellen ohne diese Felder (andere Turniere). */
export function standingNotes(row) {
  const notes = [];
  if (!row) return notes;
  if (row.exit?.kind) notes.push({ key: "exit", tone: "exit", text: EXIT_LABELS[row.exit.kind] || "Ausgeschieden" });
  if (row.tiebreak === "lead_decision") {
    const reason = row.lead_decision?.reason;
    notes.push({ key: "tiebreak", tone: "decision", text: "Platz durch Entscheid der Leitung", title: reason ? `Grund: ${reason}` : undefined, reason });
  } else if (row.tiebreak && TIEBREAK_LABELS[row.tiebreak]) {
    notes.push({ key: "tiebreak", tone: "tiebreak", text: TIEBREAK_LABELS[row.tiebreak], title: `Bei Punktgleichheit entschied: ${TIEBREAK_LABELS[row.tiebreak]}` });
  }
  const won = Number(row.forfeit_won) || 0;
  const lost = Number(row.forfeit_lost) || 0;
  if (won) notes.push({ key: "forfeit_won", tone: "forfeit", text: `${won}× kampflos gewonnen` });
  if (lost && !row.exit) notes.push({ key: "forfeit_lost", tone: "forfeit", text: `${lost}× kampflos verloren` });
  const deducted = Number(row.deducted_points) || 0;
  if (deducted) notes.push({ key: "deducted", tone: "exit", text: `−${String(deducted).replace(".", ",")} ${deducted === 1 ? "Punkt" : "Punkte"} Abzug` });
  return notes;
}

/** Ohne Remis (``allow_draws: false``) fällt die Spalte „U“ weg - außer es gibt doch eines (alter Stand). */
export function hidesDraws(rules, rows) {
  return rules?.allow_draws === false && !(rows || []).some((row) => Number(row?.drawn) > 0);
}
