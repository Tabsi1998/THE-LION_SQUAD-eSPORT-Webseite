import type { RoundResult, SeasonPage, SeasonRound, StandingRow } from "./referenceSeason";
import { formatNumber, nameOf } from "./seriesFormat";

// Turniertage einer Turnierserie in der App (#1961, #1974), wie im Web (frontend/src/lib/seriesDays.js,
// referenceSeriesTable.js, components/tls/series/TournamentDays.jsx): je Turniertag die Runden R1…Rn mit ihren Punkten,
// die Summe „GES P“ (sie ergibt den Tagesplatz) und daraus die Saisonpunkte; Lobbys je Runde, Double Up mit Partner,
// Sonderboni („Bingo +3“) und „Ausgestiegen“. Namen kommen vom Server schon ohne Tag (`hide_name_tags`) - die App
// kürzt nichts selbst. Ohne Tagesdaten (älterer Server) gibt es den Bereich nicht.

type DayEntry = NonNullable<NonNullable<RoundResult["day_rounds"]>[number]>;
export type DayRow = RoundResult & { key: string; name: string; hidden: boolean; club_member: boolean; rank: number | null };

const hasDay = (result: RoundResult | null | undefined) => Boolean(result && ((result.day_rounds || []).length || (result.day_points !== undefined && result.day_points !== null)));

/** Die Turniertage mit Tagesdaten - ohne Finale und nicht zählende Termine (wie die Spalten der Tabelle). */
export function dayRounds(page: SeasonPage | null | undefined): SeasonRound[] {
  const rounds = (page?.rounds || []).filter((round) => round?.id && round.kind !== "final" && round.counts !== false);
  const withDay = new Set((page?.standings?.rows || []).flatMap((row) => (row.results || []).filter(hasDay).map((result) => result.round_id)));
  return rounds.filter((round) => withDay.has(round.id));
}

/** Platz in einer Runde: eingetragen, sonst aus den Punkten, wenn das Schema eindeutig ist. */
export function roundPlace(entry: DayEntry | null | undefined, scheme: Array<number | null | undefined> = []): number | null {
  if (!entry) return null;
  if (entry.place) return entry.place;
  const points = Number(entry.points);
  const hits = scheme.map((value, index) => (Number(value) === points ? index + 1 : null)).filter((hit): hit is number => Boolean(hit));
  return points > 0 && hits.length === 1 ? hits[0] : null;
}

export type PlaceTone = "gold" | "silver" | "bronze" | "top" | null;

export function placeTone(place: number | null | undefined): PlaceTone {
  if (place === 1) return "gold";
  if (place === 2) return "silver";
  if (place === 3) return "bronze";
  if (place && place <= 4) return "top";
  return null;
}

/** Ein Turniertag als Tabelle: nach Tagesplatz, ohne Platz zuletzt, dann nach Gesamtrang. */
export function dayTable(rows: StandingRow[] | null | undefined, roundId: string): DayRow[] {
  const out: DayRow[] = [];
  for (const row of rows || []) {
    const result = (row.results || []).find((item) => item.round_id === roundId);
    if (!result) continue;
    out.push({ ...result, key: String(row.key), name: nameOf(row), hidden: Boolean(row.name_hidden || !row.name), club_member: Boolean(row.club_member), rank: row.rank ?? null });
  }
  return out.sort((left, right) => (left.place ?? Infinity) - (right.place ?? Infinity) || (left.rank ?? Infinity) - (right.rank ?? Infinity));
}

/** Wie viele Runden der Tag hatte (die längste Zeile). */
export function roundsOfDay(table: DayRow[]): number {
  return Math.max(0, ...table.map((item) => (item.day_rounds || []).length));
}

export function isDoubleUp(table: DayRow[]): boolean {
  return table.some((item) => item.partner);
}

export function hasLobbies(table: DayRow[]): boolean {
  return table.some((item) => (item.day_rounds || []).some((entry) => entry?.lobby));
}

/** Die Lobbys einer Runde: je Lobby die Spieler nach Platz, dann nach Punkten - `null` ohne Lobbys. */
export function lobbies(table: DayRow[], index: number, scheme: number[] = []): Array<{ lobby: string; members: Array<{ item: DayRow; entry: DayEntry; place: number | null }> }> | null {
  const groups = new Map<string, Array<{ item: DayRow; entry: DayEntry; place: number | null }>>();
  for (const item of table) {
    const entry = item.day_rounds?.[index];
    if (!entry || !entry.lobby) continue;
    if (!groups.has(entry.lobby)) groups.set(entry.lobby, []);
    groups.get(entry.lobby)?.push({ item, entry, place: item.partner ? entry.place || null : roundPlace(entry, scheme) });
  }
  if (!groups.size) return null;
  return [...groups.entries()]
    .map(([lobby, members]) => ({ lobby, members: members.sort((left, right) => (left.place ?? Infinity) - (right.place ?? Infinity) || (Number(right.entry.points) || 0) - (Number(left.entry.points) || 0)) }))
    .sort((left, right) => left.lobby.localeCompare(right.lobby, "de", { numeric: true }));
}

type Bonus = { key?: string | null; label?: string | null; points?: number | null };

/** Boni einer Zeile: „Bingo +3“ - ein unbekannter Schlüssel bleibt, wie er ist. */
export function bonusLabels(keys: string[] | null | undefined, bonuses: Bonus[] | null | undefined = []): string[] {
  return (keys || []).map((key) => {
    const bonus = (bonuses || []).find((item) => item.key === key);
    return bonus ? `${bonus.label} +${formatNumber(bonus.points)}` : key;
  });
}

/** „5 Runden je Turniertag, Platz 1 bis 8: 8 · 7 · … – die Summe ergibt den Tagesplatz“ - leer ohne Vorgabe. */
export function dayRoundsLabel(rules: SeasonPage["rules"]): string {
  const count = Number(rules?.day_rounds?.count) || 0;
  if (!count) return "";
  const scheme = (rules?.day_rounds?.points_by_place || []).map(formatNumber);
  const runden = count === 1 ? "1 Runde" : `${count} Runden`;
  return `${runden} je Turniertag${scheme.length ? `, Platz 1 bis ${scheme.length}: ${scheme.join(" · ")}` : ""} – die Summe ergibt den Tagesplatz`;
}

/** „Bingo +3 · Joker +2 – zählen zusätzlich, nie gestrichen“ - leer ohne Boni. */
export function bonusRulesLabel(rules: SeasonPage["rules"]): string {
  const bonuses = rules?.custom_bonuses || [];
  if (!bonuses.length) return "";
  return `${bonuses.map((bonus) => `${bonus.label} +${formatNumber(bonus.points)}`).join(" · ")} – zählen zusätzlich, nie gestrichen`;
}

export type DayLine = {
  key: string; place: string; tone: PlaceTone; name: string; hidden: boolean; club: boolean; partner: string; badges: string[];
  cells: Array<{ key: string; text: string; tone: PlaceTone; label: string }>; total: string; points: string; dropped: boolean;
};

/** Die Zeilen eines Turniertags: Tagesplatz, Name (mit Partner bei Double Up), Abzeichen, R1…Rn mit Platz-Farbe, GES P
 * und die Saisonpunkte (gestrichen, wenn sie nicht zählen). */
export function dayLines(page: SeasonPage | null | undefined, roundId: string): DayLine[] {
  const table = dayTable(page?.standings?.rows, roundId);
  const count = roundsOfDay(table);
  const scheme = (page?.rules?.day_rounds?.points_by_place || []).map(Number);
  const bonuses = page?.rules?.custom_bonuses || [];
  return table.map((item) => ({
    key: item.key,
    place: item.place ? String(item.place) : "–",
    tone: placeTone(item.place),
    name: item.name,
    hidden: item.hidden,
    club: item.club_member,
    partner: item.partner ? `mit ${nameOf(item.partner)}` : "",
    badges: [...((item.marks || []).includes("left") ? ["Ausgestiegen"] : []), ...bonusLabels(item.bonus_keys, bonuses)],
    cells: Array.from({ length: count }, (_, index) => {
      const entry = item.day_rounds?.[index] || null;
      // Bei Double Up zählt nur ein eingetragener Platz (zwei teilen sich die Punkte).
      const place = entry ? (item.partner ? entry.place || null : roundPlace(entry, scheme)) : null;
      const points = entry ? Number(entry.points) || 0 : 0;
      return {
        key: `R${index + 1}`,
        text: entry ? formatNumber(points) : "–",
        tone: placeTone(place),
        label: entry ? [`R${index + 1}: ${formatNumber(points)} ${points === 1 ? "Punkt" : "Punkte"}`, place ? `Platz ${place}` : "", entry.lobby ? `Lobby ${entry.lobby}` : ""].filter(Boolean).join(", ") : `R${index + 1}: nicht gespielt`,
      };
    }),
    total: item.day_points !== null && item.day_points !== undefined ? formatNumber(item.day_points) : "–",
    points: item.points !== null && item.points !== undefined ? formatNumber(item.points) : "–",
    dropped: Boolean(item.dropped),
  }));
}
