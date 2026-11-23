// Ergebnisregeln je Map (docs/LIGA.md, C.3, #1617; App #2173): die Regel, die die Staffel für den Modus trägt, als Hinweis und als
// Vorabprüfung - dieselben Sätze wie frontend/src/components/tls/league/leagueResultRules.js und der Server
// (services/league_result_rules.py). Der Server bleibt maßgeblich.

export type ResultRule = {
  kind?: "score" | "rounds" | "highest" | string | null;
  target?: number | null;
  round_limit?: number | null;
  overtime?: boolean | null;
  draw_allowed?: boolean | null;
  time_limit_seconds?: number | null;
  time_limit_minutes?: number | null;
  round_time_seconds?: number | null;
};

type RuleLeague = {
  sides?: Array<{ registration_id: string; name?: string | null }>;
  result_rules?: Record<string, ResultRule | null | undefined> | null;
  scores_required?: boolean | null;
};

type RuleGame = { position: number; mode?: string | null; winner?: string | null; scores?: Record<string, unknown> | null; decision?: string | null };

const count = (number: unknown, one: string, many: string) => `${number} ${Number(number) === 1 ? one : many}`;

/** „4 Min.“ oder „4:30 Min.“ - wie durationText im Web (lib/modeSettings.js). */
export function durationText(seconds: unknown): string {
  const total = Math.trunc(Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes}:${String(rest).padStart(2, "0")} Min.` : `${minutes} Min.`;
}

/** Das Zeitlimit je Map in Sekunden - auch aus dem Altbestand in Minuten. */
export function ruleTimeLimitSeconds(rule?: ResultRule | null): number | null {
  const seconds = Number(rule?.time_limit_seconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.trunc(seconds);
  const minutes = Number(rule?.time_limit_minutes);
  return Number.isFinite(minutes) && minutes > 0 ? Math.trunc(minutes * 60) : null;
}

/** „bis 250 Punkte“, „6 Runden, höchstens 11“, „höherer Endstand gewinnt“ - mit Zeitlimit, Verlängerung und Remis. */
export function ruleHint(rule?: ResultRule | null): string {
  if (!rule?.kind) return "";
  const heads: Record<string, string> = {
    score: `bis ${rule.target} Punkte`,
    rounds: `${count(rule.target, "Runde", "Runden")}${rule.round_limit ? `, höchstens ${rule.round_limit}` : ""}`,
    highest: "höherer Endstand gewinnt",
  };
  const time = ruleTimeLimitSeconds(rule);
  return [heads[rule.kind] || "", time ? durationText(time) : "", rule.round_time_seconds ? `${durationText(rule.round_time_seconds)} je Runde` : "",
    rule.overtime ? "Verlängerung" : "", rule.draw_allowed ? "Remis möglich" : ""].filter(Boolean).join(" · ");
}

/** „Map 4 und 5 nicht gespielt – …“: die Positionen nach dem Serienende (`not_played`). */
export function notPlayedText(positions: number[]): string {
  const list = positions.length > 1 ? `${positions.slice(0, -1).join(", ")} und ${positions[positions.length - 1]}` : String(positions[0]);
  return `Map ${list} nicht gespielt – die Serie war entschieden.`;
}

/** Die Regel einer Map: die der Staffel für ihren Modus - sonst keine. */
export function ruleFor(league: RuleLeague | null | undefined, mode?: string | null): ResultRule | null {
  const rule = mode ? league?.result_rules?.[mode] : null;
  return rule?.kind ? rule : null;
}

/** Eine Eingabe als Zahl: leer = `null`, keine Zahl = `undefined` (das meldet schon das Formular). */
function numberOf(value: unknown): number | null | undefined {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

const shown = (number: number) => String(number).replace(".", ",");

/** Was am Endstand einer Map nicht zur Regel passt - der Satz für die Seite, sonst `null`. */
export function mapRuleProblem(game: RuleGame, league: RuleLeague | null | undefined): string | null {
  const label = `Map ${game.position}`;
  if (game.decision === "awarded") return null;
  const winner = game.winner || "";
  const loser = (league?.sides || []).map((side) => side.registration_id).find((id) => id !== winner) || "";
  const won = numberOf(game.scores?.[winner]);
  const lost = numberOf(game.scores?.[loser]);
  if (won === undefined || lost === undefined) return null;
  const have = [won, lost].filter((value) => value !== null).length;
  if (league?.scores_required && have < 2) return `${label}: bitte die Punkte beider Seiten eintragen – in dieser Liga sind sie Pflicht.`;
  const rule = ruleFor(league, game.mode);
  if (!rule || !have) return null;
  if (have < 2 || won === null || lost === null) return `${label}: bitte die Punkte beider Seiten eintragen.`;
  if ((rule.kind === "score" || rule.kind === "rounds") && (!Number.isInteger(won) || !Number.isInteger(lost))) {
    return `${label}: Punkte bitte als ganze Zahl angeben.`;
  }
  const stand = `${shown(won)}:${shown(lost)}`;
  if (won < lost) {
    const name = (league?.sides || []).find((side) => side.registration_id === loser)?.name || "die Gegenseite";
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
  if (!ruleTimeLimitSeconds(rule) && !tie && target && won < target) {
    return `${label}: Die Map endet erst bei ${target} ${rule.kind === "score" ? "Punkten" : "gewonnenen Runden"} – der Sieger hat ${shown(won)}.`;
  }
  return null;
}
