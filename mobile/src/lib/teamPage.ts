import { viennaDateTime } from "./vienna";

// Team-Seite (#1191): dieselben Zeilen wie im Web (frontend/src/lib/teamPage.js) - Termine, letzte Spiele und der
// Schlüssel des Einladungs-Links.

export const INVITE_PARAM = "einladung";

export type TeamUpcoming = {
  registration_id: string;
  status?: string;
  status_label?: string;
  tournament: { id?: string; slug?: string | null; title?: string; start_date?: string | null; event_name?: string | null; game_name?: string | null };
};

export type TeamRecent = {
  match_id: string;
  kind?: "duel" | "heat";
  outcome?: "win" | "loss" | "draw" | "placed" | null;
  score?: string | null;
  opponent?: string | null;
  forfeit?: boolean;
  rank?: number | null;
  field?: number | null;
  round_label?: string;
  tournament?: { id?: string; slug?: string | null; title?: string };
};

export type TeamOverview = { upcoming: TeamUpcoming[]; recent: TeamRecent[]; header?: Record<string, unknown> };

const OUTCOME_LABELS: Record<string, string> = { win: "Sieg", loss: "Niederlage", draw: "Unentschieden" };

export function outcomeLabel(row?: TeamRecent | null): string {
  if (!row) return "";
  if (row.kind === "heat") return row.rank ? `Platz ${row.rank}` : "Gewertet";
  return OUTCOME_LABELS[String(row.outcome || "")] || "Gewertet";
}

export function recentLine(row?: TeamRecent | null): string {
  if (!row) return "";
  if (row.kind === "heat") return row.rank ? `Platz ${row.rank}${row.field ? ` von ${row.field}` : ""}` : "Durchgang gewertet";
  const against = row.opponent ? `gegen ${row.opponent}` : "";
  if (row.forfeit && !row.score) return `${row.outcome === "win" ? "Gewonnen" : "Verloren"} ${against} (kampflos)`.trim();
  return [row.score, against].filter(Boolean).join(" ");
}

export function upcomingLine(row?: TeamUpcoming | null): string {
  const t = row?.tournament || {};
  const when = t.start_date ? viennaDateTime(t.start_date, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  return [t.event_name, when ? when.replace(", ", " · ") : "", !t.event_name ? t.game_name : ""].filter(Boolean).join(" · ");
}
