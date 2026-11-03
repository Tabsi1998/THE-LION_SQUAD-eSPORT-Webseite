// Ergebnisregeln je Map (docs/LIGA.md, C.3, #1617): die Regel, die die Staffel für den Modus trägt, als Hinweis und als
// Vorabprüfung. Dieselben Sätze wie der Server (services/league_result_rules.py) - der bleibt maßgeblich.

const count = (number, one, many) => `${number} ${Number(number) === 1 ? one : many}`;

/** „bis 250 Punkte“, „6 Runden, höchstens 11“, „höherer Endstand gewinnt“ - mit Zeitlimit, Verlängerung und Remis. */
export function ruleHint(rule) {
  if (!rule?.kind) return "";
  const head = {
    score: `bis ${rule.target} Punkte`,
    rounds: `${count(rule.target, "Runde", "Runden")}${rule.round_limit ? `, höchstens ${rule.round_limit}` : ""}`,
    highest: "höherer Endstand gewinnt",
  }[rule.kind] || "";
  return [head, rule.time_limit_minutes ? `${rule.time_limit_minutes} Min.` : "", rule.overtime ? "Verlängerung" : "",
    rule.draw_allowed ? "Remis möglich" : ""].filter(Boolean).join(" · ");
}

/** Die Regel einer Map: die der Staffel für ihren Modus - sonst keine. */
export function ruleFor(league, mode) {
  const rule = mode ? league?.result_rules?.[mode] : null;
  return rule?.kind ? rule : null;
}

/** Eine Eingabe als Zahl: leer = `null`, keine Zahl = `undefined` (das meldet schon das Formular). */
function numberOf(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

const shown = (number) => String(number).replace(".", ",");

/**
 * Was am Endstand einer Map nicht zur Regel passt - der Satz für die Seite, sonst `null`. `game`: `{position, mode, winner,
 * scores, decision}` wie im Formular.
 */
export function mapRuleProblem(game, league) {
  const label = `Map ${game.position}`;
  if (game.decision === "awarded") return null;
  const winner = game.winner;
  const loser = (league?.sides || []).map((side) => side.registration_id).find((id) => id !== winner);
  const won = numberOf(game.scores?.[winner]);
  const lost = numberOf(game.scores?.[loser]);
  if (won === undefined || lost === undefined) return null;
  const have = [won, lost].filter((value) => value !== null).length;
  if (league?.scores_required && have < 2) return `${label}: bitte die Punkte beider Seiten eintragen – in dieser Liga sind sie Pflicht.`;
  const rule = ruleFor(league, game.mode);
  if (!rule || !have) return null;
  if (have < 2) return `${label}: bitte die Punkte beider Seiten eintragen.`;
  if ((rule.kind === "score" || rule.kind === "rounds") && (!Number.isInteger(won) || !Number.isInteger(lost))) {
    return `${label}: Punkte bitte als ganze Zahl angeben.`;
  }
  const stand = `${shown(won)}:${shown(lost)}`;
  if (won < lost) {
    const name = (league.sides || []).find((side) => side.registration_id === loser)?.name || "die Gegenseite";
    return `${label}: Der Endstand ${stand} passt nicht zum Sieger – mehr Punkte hat ${name}.`;
  }
  const tie = won === lost;
  if (tie && !rule.draw_allowed) return `${label}: Gleichstand (${stand}) gibt es in diesem Modus nicht – bitte Endstand und Sieger prüfen.`;
  if (rule.kind === "highest") return null;
  const target = Number(rule.target || 0);
  if (rule.kind === "rounds" && !rule.overtime && rule.round_limit && won + lost > rule.round_limit) {
    return `${label}: höchstens ${rule.round_limit} Runden – ${stand} sind ${shown(won + lost)}.`;
  }
  if (!rule.overtime && target && won > target) {
    return `${label}: höchstens ${target} ${rule.kind === "score" ? "Punkte" : "Rundensiege"} – die Map endet beim Ziel (Endstand ${stand}).`;
  }
  if (!rule.time_limit_minutes && !tie && target && won < target) {
    return `${label}: Die Map endet erst bei ${target} ${rule.kind === "score" ? "Punkten" : "gewonnenen Runden"} – der Sieger hat ${shown(won)}.`;
  }
  return null;
}
