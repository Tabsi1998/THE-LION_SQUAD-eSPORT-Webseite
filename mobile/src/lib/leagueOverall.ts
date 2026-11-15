import { viennaDate } from "./vienna";

// Gesamtwertung über Seasons (F.5, #2215; App: #2173, docs/LIGA.md „F.5“): Wörter und Zellen wie im Web (frontend/src/lib/leagueOverall.js,
// components/tls/league/LeagueOverallStanding.jsx, pages/public/LeagueSeasonOverallPage.jsx). Gerechnet wird auf dem Server nach der
// Sichtbarkeit der Person - die App zeigt nur, was kommt. Ein „Gesamtsieger“ steht nur, wenn die Wertung abgeschlossen ist und die
// Person jede Season der Fassung sieht (`complete`).

/** Platz in der Gesamtwertung an Profil und Team (`league_overall`). Alle Felder optional - ältere Server liefern sie nicht. */
export type OverallStandingRow = {
  league_name?: string | null;
  period_name?: string | null;
  division_label?: string | null;
  level?: number | null;
  place?: number | null;
  of?: number | null;
  points?: number | null;
  closed?: boolean | null;
  complete?: boolean | null;
  url?: string | null;
  /** Teamseite: der Name des Co-Teams. */
  name?: string | null;
};

export type OverallCell = {
  season_id: string;
  played?: boolean;
  points?: number | null;
  place?: number | null;
  of?: number | null;
  counted?: boolean;
  champion?: boolean;
  exit?: string | null;
  staffel?: string | null;
  co_team_name?: string | null;
};

export type OverallRow = {
  key?: string | null;
  name?: string | null;
  team_id?: string | null;
  username?: string | null;
  private?: boolean;
  place: number;
  total: number;
  tie?: boolean;
  climbed?: boolean;
  lead_decision?: { reason?: string | null; method?: string | null; method_label?: string | null } | null;
  seasons?: OverallCell[];
};

export type OverallSettings = {
  points_mode?: string;
  points_table?: number[];
  champion_bonus?: number;
  counting?: string;
  best_count?: number | null;
  tiebreakers?: Array<{ key?: string; label?: string } | string>;
};

export type OverallLevel = {
  level: number;
  label?: string | null;
  closed?: boolean;
  complete?: boolean;
  final?: { version?: number | null; closed_at?: string | null } | null;
  season_ids?: string[];
  settings?: OverallSettings | null;
  teams?: OverallRow[];
  players?: OverallRow[];
};

export type OverallView = {
  period?: { id?: string; name?: string | null } | null;
  seasons?: Array<{ id: string; name?: string | null; url?: string | null }>;
  levels?: OverallLevel[];
  settings?: OverallSettings | null;
};

/** „1 Punkt“, „6 Punkte“. */
export function pointsWord(value?: number | null): string {
  const number = Number(value) || 0;
  return `${number} ${number === 1 ? "Punkt" : "Punkte"}`;
}

/** Profil und Team: „Endstand“, ohne ganze Sicht „Endstand ohne nicht öffentliche Seasons“, sonst „laufend“. */
export function standingState(row: Pick<OverallStandingRow, "closed" | "complete">): string {
  if (!row.closed) return "laufend";
  return row.complete ? "Endstand" : "Endstand ohne nicht öffentliche Seasons";
}

/** Gesamtsieger nur bei abgeschlossener Wertung, ganzer Sicht und Platz 1. */
export function isOverallWinner(row: Pick<OverallStandingRow, "closed" | "complete" | "place">): boolean {
  return Boolean(row.closed && row.complete && row.place === 1);
}

/** Der Stand einer Liga N auf der Ligaseite - wie `stateLine` im Web. */
export function levelState(block?: Pick<OverallLevel, "closed" | "complete" | "final"> | null): string {
  if (!block?.closed) return "Laufende Wertung – rechnet mit jedem neuen Endstand einer Season neu.";
  let when = "";
  try {
    when = block.final?.closed_at ? viennaDate(block.final.closed_at, { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  } catch {
    when = "";
  }
  if (block.complete === false) return `Endstand ohne nicht öffentliche Seasons${when ? ` · abgeschlossen am ${when}` : ""}`;
  return `Endstand${when ? ` seit ${when}` : ""}${Number(block.final?.version) > 1 ? ` · Fassung ${block.final?.version}` : ""}`;
}

/** Der Gesamtsieger einer Liga N - nur, wenn genau einer auf Platz 1 steht, die Wertung abgeschlossen ist und die Person alles sieht. */
export function overallWinner(block?: OverallLevel | null): OverallRow | null {
  if (!block?.closed || !block.complete) return null;
  const leaders = (block.teams || []).filter((row) => row.place === 1);
  return leaders.length === 1 ? leaders[0] : null;
}

/** Die Seasons der Spalten in der Reihenfolge der Antwort - mit Namen. */
export function seasonColumns(seasons: OverallView["seasons"], ids?: string[] | null): Array<{ id: string; name: string }> {
  const byId = new Map((seasons || []).map((row) => [row.id, row]));
  return (ids || []).map((id) => ({ id, name: byId.get(id)?.name || "Season" }));
}

/** Eine Season-Zelle als Satz: „Season 2: 6 Punkte · Platz 1 von 4 · Staffelsieg · Streichergebnis“. */
export function cellText(cell: OverallCell | null | undefined, seasonName = "Season"): string {
  if (!cell?.played) return `${seasonName}: nicht dabei`;
  const parts = [`${seasonName}: ${pointsWord(cell.points ?? 0)}`];
  if (cell.exit) parts.push("ausgeschieden");
  else if (cell.place) parts.push(`Platz ${cell.place} von ${cell.of}`);
  if (cell.champion) parts.push("Staffelsieg");
  if (cell.counted === false) parts.push("Streichergebnis");
  if (cell.co_team_name) parts.push(`für ${cell.co_team_name}`);
  return parts.join(" · ");
}

/** Ein Streichergebnis: gespielt, aber zählt nicht (nur bei „die besten X“). */
export function isStruck(cell?: OverallCell | null): boolean {
  return Boolean(cell?.played) && cell?.counted === false;
}

/** Wie gerechnet wird - die Zeile unter der Tabelle. */
export function rulesLine(settings?: OverallSettings | null): string {
  if (!settings) return "";
  const points = settings.points_mode === "table"
    ? `Punkte je Platz: ${(settings.points_table || []).join(", ") || "–"}`
    : "Punkte nach Teamzahl: Platz 1 bekommt so viele Punkte, wie die Staffel Teams hat, der Letzte 1";
  const bonus = Number(settings.champion_bonus) > 0 ? `, Platz 1 der Staffel +${settings.champion_bonus}` : "";
  const counting = settings.counting === "best" && settings.best_count ? `Es zählen die besten ${settings.best_count} Seasons.` : "Es zählen alle Seasons.";
  return `${points}${bonus}. ${counting}`;
}

/** Der Abruf der Gesamtwertung aus dem Link des Servers (`/liga/<liga>/<season>/gesamtwertung`) - nur saubere Teile, sonst `null`. */
export function overallParams(url?: string | null): { league: string; season: string } | null {
  const path = String(url || "").split(/[?#]/)[0];
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[0] !== "liga" || parts[3] !== "gesamtwertung") return null;
  const clean = (part: string) => /^[A-Za-z0-9_-]{1,80}$/.test(part);
  return clean(parts[1]) && clean(parts[2]) ? { league: parts[1], season: parts[2] } : null;
}

export function overallApiPath(league: string, season: string): string {
  return `/leagues/${encodeURIComponent(league)}/${encodeURIComponent(season)}/overall`;
}
