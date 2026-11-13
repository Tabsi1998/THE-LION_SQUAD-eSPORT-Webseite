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

// Punkteart (#2312, docs/LIGA.md E.1): Sieg/Remis/Niederlage oder je gewonnene Map (3:2 ergibt 3 und 2).
export const POINTS_MODE_OPTIONS = [
  ["result", "Sieg, Remis, Niederlage"],
  ["maps", "Punkte nach gewonnenen Maps"],
];
// Vorschlag beim Wechsel auf Map-Punkte (Server: scoring_rules.MAPS_TABLE_TIEBREAKERS) - bleibt änderbar.
export const MAPS_TIEBREAKERS = ["wins", "head_to_head", "score_diff", "lead_decision"];

// Vorgaben neuer Liga-Seasons (Server: scoring_rules.LEAGUE_TABLE_DEFAULTS) - nur, wenn die Season die Felder nicht trägt.
const OLD_DEFAULTS = { table_tiebreakers: ["score_diff", "score_for"], head_to_head_criteria: ["points", "score_diff", "score_for"],
  allow_draws: true, forfeit_score: "recorded", exit_rule: "half" };

// Vorgabe einer Season, die noch keine Regeln trägt (#2406) - dieselbe wie der Server (scoring_rules.LEAGUE_TABLE_DEFAULTS): 3/0/0, kein Remis.
export const LEAGUE_TABLE_DEFAULTS = {
  match_points: { win: 3, draw: 0, loss: 0 },
  table_tiebreakers: ["head_to_head", "score_diff", "score_for", "lead_decision"],
  head_to_head_criteria: ["points", "score_diff", "score_for"],
  allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents",
};

/** Trägt die Season Regeln? Ohne (neu oder sehr alt) zeigt das Formular die Vorgabe des Servers, nicht den alten Stand. */
export function hasTableRules(rules) {
  return Boolean(rules) && typeof rules === "object" && Object.keys(rules).length > 0;
}

/** Punkte nach gewonnenen Maps? (Season- oder Staffel-Regeln) */
export function byMaps(rules) {
  return rules?.match_points_mode === "maps";
}

/** Was beim Wechsel der Punkteart ins Formular geht: auf Map-Punkte die vorgeschlagene Reihenfolge und kampflos wie 3:0,
 *  zurück nur die Art - die Reihenfolge bleibt, wie sie ist. */
export function pointsModeChange(mode) {
  return mode === "maps"
    ? { match_points_mode: "maps", table_tiebreakers: [...MAPS_TIEBREAKERS], forfeit_score: "best_of" }
    : { match_points_mode: "result" };
}

/** Die Tabellenregeln einer Season als Formularwerte; fehlt ein Feld (ältere Season), gilt, was der Server dann rechnet. */
export function tableRulesToForm(rules = {}) {
  return {
    match_points_mode: rules.match_points_mode === "maps" ? "maps" : "result",
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
    match_points_mode: form.match_points_mode === "maps" ? "maps" : "result",
    table_tiebreakers: form.table_tiebreakers,
    head_to_head_criteria: form.head_to_head_criteria,
    allow_draws: Boolean(form.allow_draws),
    forfeit_score: form.forfeit_score,
    exit_rule: form.exit_rule,
  };
}

/** Hinweis unter der Tabelle, wenn Punkte gewonnene Maps sind (#2312) - sonst leer. */
export function pointsNote(rules) {
  return byMaps(rules) ? "Punkte = gewonnene Maps (3:2 ergibt 3 und 2, kampflos 3:0)" : "";
}

/** Punktevergabe einer Season in einem Satz: „Sieg / Remis / Niederlage: 3 / 0 / 0“ oder „Punkte je gewonnene Map“. */
export function pointsSummary(season) {
  if (byMaps(season)) return "Punkte je gewonnene Map";
  const points = season?.match_points;
  return points ? `Sieg / Remis / Niederlage: ${points.win} / ${points.draw} / ${points.loss}` : "";
}

/** Kurztext der Reihenfolge: „Punkte → Direkter Vergleich → Map-Differenz …“. */
export function tiebreakOrder(keys) {
  return ["Punkte", ...(keys || []).map((key) => TIEBREAK_LABELS[key]).filter(Boolean)].join(" → ");
}

/** Punktabzug einer Zeile in Worten („−2 Punkte Abzug“, E.3) - leer ohne Abzug. Für Web, TV und Druck derselbe Satz. */
export function deductionText(row) {
  const deducted = Number(row?.deducted_points) || 0;
  return deducted ? `−${String(deducted).replace(".", ",")} ${deducted === 1 ? "Punkt" : "Punkte"} Abzug` : "";
}

const DECISION_METHOD_NOTES = { playoff: "Platz durch Entscheidungsspiel", lot: "Platz durch Losentscheid", lead: "Platz durch Entscheid der Leitung" };

/** Hinweise an einer Zeile der Staffel-Tabelle: was den Platz entschied, kampflos, Abzug, Ausscheiden. Leer bei
 *  Tabellen ohne diese Felder (andere Turniere). */
export function standingNotes(row) {
  const notes = [];
  if (!row) return notes;
  if (row.exit?.kind) notes.push({ key: "exit", tone: "exit", text: EXIT_LABELS[row.exit.kind] || "Ausgeschieden" });
  if (row.tiebreak === "lead_decision") {
    const reason = row.lead_decision?.reason;
    // Wie entschieden wurde (F.1, Nr. 156) - ohne Angabe wie bisher „Entscheid der Leitung“.
    const text = DECISION_METHOD_NOTES[row.lead_decision?.method] || DECISION_METHOD_NOTES.lead;
    notes.push({ key: "tiebreak", tone: "decision", text, title: reason ? `Grund: ${reason}` : undefined, reason });
  } else if (row.tiebreak && TIEBREAK_LABELS[row.tiebreak]) {
    notes.push({ key: "tiebreak", tone: "tiebreak", text: TIEBREAK_LABELS[row.tiebreak], title: `Bei Punktgleichheit entschied: ${TIEBREAK_LABELS[row.tiebreak]}` });
  }
  const won = Number(row.forfeit_won) || 0;
  const lost = Number(row.forfeit_lost) || 0;
  if (won) notes.push({ key: "forfeit_won", tone: "forfeit", text: `${won}× kampflos gewonnen` });
  if (lost && !row.exit) notes.push({ key: "forfeit_lost", tone: "forfeit", text: `${lost}× kampflos verloren` });
  const deducted = deductionText(row);
  if (deducted) notes.push({ key: "deducted", tone: "exit", text: deducted, title: "Punktabzug durch eine Strafe der Liga-Leitung" });
  // Angefochtene Ergebnisse (E.2, #1619): Sie zählen vorläufig mit - die Zeile sagt, wie viele Spiele noch „in Klärung“ sind.
  const contested = Number(row.contested) || 0;
  if (contested) {
    notes.push({ key: "contested", tone: "decision", text: contested === 1 ? "1 Spiel in Klärung" : `${contested} Spiele in Klärung`,
      title: "Das Ergebnis zählt vorläufig. Die Liga-Leitung prüft einen Protest." });
  }
  return notes;
}

/** Ohne Remis (``allow_draws: false``) fällt die Spalte „U“ weg - außer es gibt doch eines (alter Stand). */
export function hidesDraws(rules, rows) {
  return rules?.allow_draws === false && !(rows || []).some((row) => Number(row?.drawn) > 0);
}

// Zonen für Auf- und Abstieg (F.2, #1627, Nr. 158): der Server schreibt ``zone`` an jede Zeile einer Liga-Staffel. Grün hinauf, Orange
// hinunter, Relegation heller - Rot bleibt Live, Gold dem Podest (LSW-Farbregel). Dieselben Wörter im PDF (pdf_service._ZONE_TEXT).
export const ZONE_LABELS = {
  promotion: "Aufstieg",
  playoff_promotion: "Relegation um den Aufstieg",
  playoff_relegation: "Relegation gegen den Abstieg",
  relegation: "Abstieg",
};
const ZONE_ORDER = ["promotion", "playoff_promotion", "playoff_relegation", "relegation"];

/** Die Zonen, die in dieser Tabelle vorkommen - in fester Reihenfolge, für die Legende unter der Tabelle. */
export function zoneLegend(rows) {
  const used = new Set((rows || []).map((row) => row?.zone).filter(Boolean));
  return ZONE_ORDER.filter((zone) => used.has(zone)).map((zone) => ({ zone, label: ZONE_LABELS[zone] }));
}

/** Kurzer Satz zu den Zonen einer Liga N für die Verwaltung: „1 Aufsteiger · 1 Absteiger“, mit den Randfällen. */
export function zonesLine(zones) {
  if (!zones) return "";
  const parts = [];
  if (zones.top) parts.push("oberste Liga: kein Aufstieg");
  else parts.push(zones.promote ? `${zones.promote} Aufsteiger` : "kein Aufstieg");
  if (zones.playoff_promote) parts.push(`${zones.playoff_promote} Relegation oben`);
  if (zones.playoff_relegate) parts.push(`${zones.playoff_relegate} Relegation unten`);
  if (zones.bottom) parts.push("unterste Liga: kein Abstieg");
  else parts.push(zones.relegate ? `${zones.relegate} Absteiger` : "kein Abstieg");
  return parts.join(" · ");
}

/** Die Zonen einer Liga N als Formularwerte (Texte für Zahlenfelder) - fehlt ein Wert, gilt 1/1 ohne Relegation. */
export function zonesToForm(zones) {
  const value = (key, fallback) => String(zones?.[key] ?? fallback);
  return { promote: value("promote", 1), relegate: value("relegate", 1), playoff_promote: value("playoff_promote", 0), playoff_relegate: value("playoff_relegate", 0) };
}

/** Formular → ``zones`` für den Server: ganze Zahlen 0–10, leer heißt Vorgabe. */
export function zonesPayload(form) {
  const number = (text, fallback) => {
    const parsed = Number.parseInt(String(text ?? "").trim(), 10);
    return Number.isFinite(parsed) ? Math.min(10, Math.max(0, parsed)) : fallback;
  };
  return { promote: number(form.promote, 1), relegate: number(form.relegate, 1), playoff_promote: number(form.playoff_promote, 0), playoff_relegate: number(form.playoff_relegate, 0) };
}
