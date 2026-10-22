import { sessionLabel, type WeekendRound } from "./raceWeekend";
import { formatNumber, number, shortDay } from "./seriesFormat";

// Sonderregeln einer Rennliga in der App (#1960, #1974): Anpassungen („−5“ mit Grund), abgebrochene Saison mit
// Nachfolger, Termin ohne Wertung, Regeländerungen ab Runde X und Quelle und Modus der Teamwertung. Dieselben Texte wie
// im Web (frontend/src/lib/seriesSpecialRules.js). Gerechnet wird im Server - hier wird nur beschriftet. Ein älterer
// Server schickt die Felder nicht: dann bleibt alles leer.

export type Adjustment = { points?: number | null; reason?: string | null; day?: string | null; round_id?: string | null };
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

/** „Ohne Wertung · Zu wenig Fahrer – Nur zwei am Start“ - leer ohne Grund. */
export function noScoreText(round: { no_score_reason?: string | null; no_score_note?: string | null } | null | undefined): string {
  const reason = NO_SCORE_LABELS[String(round?.no_score_reason)];
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
