import { sessionLabel, type WeekendRound } from "./raceWeekend";
import { formatNumber, nameOf, number, shortDay } from "./seriesFormat";
import { kindWord, type KindProfile } from "./seriesKinds";

// Sonderregeln einer Rennliga in der App (#1960, #1974): Anpassungen („−5“ mit Grund), abgebrochene Saison mit
// Nachfolger, Termin ohne Wertung, Regeländerungen ab Runde X und Quelle und Modus der Teamwertung. Dieselben Texte wie
// im Web (frontend/src/lib/seriesSpecialRules.js). Gerechnet wird im Server - hier wird nur beschriftet. Ein älterer
// Server schickt die Felder nicht: dann bleibt alles leer.

export type Adjustment = {
  points?: number | null; reason?: string | null; day?: string | null; round_id?: string | null;
  /** #2000 (nur wo gesetzt): zählt eine Fahrer-Anpassung auch fürs Team, für welches bzw. warum für keines. */
  counts_for_team?: boolean | null; credited_team?: string | null; team_note?: string | null;
};
/** Fahrer-Anpassung an der Teamzeile (#2000): der Fahrer als Kennung wie in der Fahrerwertung. */
export type DriverAdjustment = Adjustment & { driver?: string | null };
export type AdjustedRow = { adjustment_points?: number | null; adjustments?: Adjustment[] | null };

/** Punkte einer Anpassung als Zeichen: „−5“, „+2,5“ (echtes Minus wie in den Tabellen). */
export function adjustmentText(points: unknown): string {
  const value = number(points);
  if (!value) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;
}

/** Summe der Anpassungen einer Zeile (`adjustment_points` vom Server, sonst aus der Liste). */
export function adjustmentSum(row: AdjustedRow | null | undefined): number {
  if (row?.adjustment_points !== undefined && row?.adjustment_points !== null) return number(row.adjustment_points);
  return (row?.adjustments || []).reduce((sum, item) => sum + number(item?.points), 0);
}

function roundName(roundId: string | null | undefined, rounds: WeekendRound[] | null | undefined): string {
  const round = (rounds || []).find((item) => item.id === roundId);
  return round ? sessionLabel(round) : "";
}

/** Grund, Termin und Tag einer Anpassung: „Nichtteilnahme nach Anmeldung · R4 · 12.03.2026“. */
export function adjustmentDetail(item: Adjustment | null | undefined, rounds: WeekendRound[] | null | undefined = []): string {
  return [item?.reason, roundName(item?.round_id, rounds), shortDay(item?.day)].filter(Boolean).join(" · ");
}

/** Die Marke an den Punkten in Worten (für Vorleser): „Anpassung −5 · Video fehlt · 02.11.2026“. */
export function adjustmentTitle(row: AdjustedRow | null | undefined, rounds: WeekendRound[] | null | undefined = []): string {
  return (row?.adjustments || []).map((item) => `Anpassung ${[adjustmentText(item?.points), adjustmentDetail(item, rounds)].filter(Boolean).join(" · ")}`).join("; ");
}

/** Die Marke an den Punkten: „−5“ - leer ohne Anpassung (und bei einem älteren Server). */
export function adjustmentMark(row: AdjustedRow | null | undefined): string {
  const sum = adjustmentSum(row);
  return sum && (row?.adjustments || []).length ? adjustmentText(sum) : "";
}

// ---------------------------------------------------------------- Fahrer-Anpassung in der Teamwertung (#2000)

const TEAM_NOTES: Record<string, string> = {
  substitute: "im Termin als Ersatz gefahren",
  no_team: "ohne Team gefahren",
  no_ride: "bis dahin keine Fahrt mit Team",
  guest: "Gäste zählen nicht fürs Team",
};

/** Ob eine Fahrer-Anpassung auch fürs Team zählt (vom Server): „zählt auch fürs Team · Team Adler“, „zählt für kein
 * Team – im Termin als Ersatz gefahren“ - leer ohne Haken (und bei einem älteren Server). */
export function adjustmentTeamText(item: Adjustment | null | undefined): string {
  if (!item?.counts_for_team) return "";
  if (item.credited_team) return `zählt auch fürs Team · ${item.credited_team}`;
  const note = TEAM_NOTES[String(item.team_note)];
  return note ? `zählt für kein Team – ${note}` : "zählt auch fürs Team";
}

export type DriverAdjustmentMark = { key: string; negative: boolean; text: string; title: string };

/** Die Fahrer-Anpassungen bei der Teamsumme: „−5 (Anna Probe)“, in Worten mit Grund und Termin. Der Name kommt aus der
 * Fahrerwertung (`rows`) nach den Regeln des Servers - ausgeblendet bleibt ausgeblendet, unbekannt ebenso. */
export function driverAdjustmentMarks(
  row: { driver_adjustments?: DriverAdjustment[] | null } | null | undefined,
  rows: Array<{ key?: string | null; name?: string | null; name_hidden?: boolean | null }> | null | undefined = [],
  rounds: WeekendRound[] | null | undefined = [],
): DriverAdjustmentMark[] {
  return (row?.driver_adjustments || []).filter(Boolean).map((item, index) => {
    const name = nameOf((rows || []).find((entry) => entry?.key && entry.key === item.driver));
    const line = [adjustmentText(item.points), adjustmentDetail(item, rounds)].filter(Boolean).join(" · ");
    return {
      key: `${item.driver}-${index}`,
      negative: number(item.points) < 0,
      text: `${adjustmentText(item.points)} (${name})`,
      title: `Anpassung ${line} – ${name}, zählt auch fürs Team`,
    };
  });
}

// ---------------------------------------------------------------- Teamwertung

const TEAM_MODES: Record<string, string> = {
  per_race: "Je Rennen für das gefahrene Team",
  current_lineup: "Aktuelle Besetzung: alle Saisonpunkte der Fahrer, die jetzt im Team sind",
};

/** Modus der Teamwertung in Worten (Vorgabe: je Rennen). */
export function teamModeLabel(scoring: { mode?: string | null } | null | undefined): string {
  return TEAM_MODES[String(scoring?.mode)] || TEAM_MODES.per_race;
}

/** Quelle der Teamwertung: „laut Veranstalter (nach R12)“ oder „berechnet“. */
export function teamSourceLabel(teams: { source?: string | null; round_id?: string | null } | null | undefined, rounds: WeekendRound[] | null | undefined = []): string {
  if (teams?.source !== "official") return "berechnet";
  const after = roundName(teams.round_id, rounds);
  return `laut Veranstalter${after ? ` (nach ${after})` : ""}`;
}

/** Gesamt im Modus „aktuelle Besetzung“ - wie beim Veranstalter. */
export const LINEUP_TOTAL_TEXT = "Gesamt = Saisonpunkte der aktuellen Fahrer (wie beim Veranstalter). Die Zellen je Rennen zeigen das Team, für das gefahren wurde – Ersatzfahrten für keines.";

/** Ab welchem Rennen ein Fahrer im aktuellen Team ist (nur nach einem Wechsel): „im Team seit R12“. */
export function teamSinceLabel(driver: { team_since?: string | null } | null | undefined, rounds: WeekendRound[] | null | undefined = []): string {
  const name = roundName(driver?.team_since, rounds);
  return name ? `im Team seit ${name}` : "";
}

/** Abweichung je Team zur eigenen Rechnung: „Probe Löwen: laut Veranstalter 30, berechnet 26 (+4)“. */
export function teamDeviationText(row: { team?: string | null; deviation?: number | null; official_points?: number | null; computed_points?: number | null } | null | undefined): string {
  const deviation = number(row?.deviation);
  if (row?.official_points === null || row?.official_points === undefined || !deviation) return "";
  return `${row.team}: laut Veranstalter ${formatNumber(row.official_points)}, berechnet ${formatNumber(row.computed_points)} (${adjustmentText(deviation)})`;
}

// ---------------------------------------------------------------- Termin ohne Wertung

const NO_SCORE_LABELS: Record<string, string> = {
  too_few: "Zu wenig Fahrer",
  outage: "Serverausfall bzw. Nachholung",
  restart: "Neustart",
  other: "Anderer Grund",
};

/** „Ohne Wertung · Zu wenig Fahrer – Nur zwei am Start“ - leer ohne Grund. Mit Art-Profil (#2024) in dessen Begriffen
 * („Zu wenig Spieler“), ohne wie bisher. */
export function noScoreText(round: { no_score_reason?: string | null; no_score_note?: string | null } | null | undefined, profile: KindProfile = null): string {
  const key = String(round?.no_score_reason);
  const people = key === "too_few" ? kindWord(profile, "person_many") : "";
  const reason = people ? `Zu wenig ${people}` : NO_SCORE_LABELS[key];
  if (!reason) return "";
  const note = String(round?.no_score_note || "").trim();
  return `Ohne Wertung · ${reason}${note ? ` – ${note}` : ""}`;
}

// ---------------------------------------------------------------- Saison abgebrochen

export type Successor = { season?: string | null; tier?: string | null; title?: string | null; season_slug?: string | null; status?: string | null; lineage_slug?: string | null; lineage_title?: string | null } | null | undefined;

/** „Saison abgebrochen am 20.11.2026 – Neustart mit anderem Auto“ - leer, wenn sie nicht abgebrochen ist. */
export function cancelledText(series: { status?: string | null; cancelled_on?: string | null; cancel_reason?: string | null } | null | undefined): string {
  if (series?.status !== "cancelled") return "";
  const day = shortDay(series.cancelled_on);
  const reason = String(series.cancel_reason || "").trim();
  return `Saison abgebrochen${day ? ` am ${day}` : ""}${reason ? ` – ${reason}` : ""}`;
}

/** Ziel und Name des Nachfolgers - in der App öffnet er die Saison. */
export function successorLink(successor: Successor): { lineage: string; season: string; label: string } | null {
  if (!successor?.lineage_slug || !successor?.season_slug) return null;
  return {
    lineage: successor.lineage_slug,
    season: successor.season_slug,
    label: successor.title || [successor.season, successor.tier].filter(Boolean).join(" · ") || "Neue Saison",
  };
}

// ---------------------------------------------------------------- Regeländerungen

export type RuleChange = { kind?: string | null; from_round?: number | null; to_round?: number | null; day?: string | null; note?: string | null; sessions?: string[] | null; version?: number | null };

/** Die Regeländerungen der Saison: „Ab R5 · 12.11.2026“ mit Hinweis (sonst die Läufe des neuen Formats) bzw.
 * „Regeländerung · 04.03.2026“ mit dem Hinweis der neuen Version. Zeilen ohne Text fallen weg. */
export function ruleChangeLines(changes: RuleChange[] | null | undefined): Array<{ key: string; head: string; text: string }> {
  return (changes || []).map((item, index) => {
    const day = shortDay(item?.day);
    if (item?.kind === "format") {
      const head = item.to_round ? `R${item.from_round}–R${item.to_round}` : `Ab R${item.from_round}`;
      const text = item.note || (item.sessions?.length ? `Ablauf: ${item.sessions.join(" + ")}` : "Neuer Ablauf je Runde");
      return { key: `format-${item.from_round}`, head: [head, day].filter(Boolean).join(" · "), text };
    }
    return { key: `rules-${item?.version || index}`, head: ["Regeländerung", day].filter(Boolean).join(" · "), text: item?.note || "" };
  }).filter((item) => item.text);
}
