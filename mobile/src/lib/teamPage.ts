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

// Wappen-Kopf (#1347): Rollen in Alltagsworten unter den Gesichtern - wie im Web.
export type TeamRole = "captain" | "co_captain" | "player";
export const ROLE_LABELS: Record<TeamRole, string> = { captain: "Kapitän", co_captain: "Co-Kapitän", player: "Spieler" };

type FaceTeam = { leader_id?: string | null; co_leader_ids?: string[] | null; members?: Array<{ id: string; username?: string | null; display_name?: string | null; avatar_url?: string | null }> | null };

export function memberRole(team: FaceTeam | null | undefined, member: { id: string } | null | undefined): TeamRole {
  if (!team || !member) return "player";
  if (team.leader_id === member.id) return "captain";
  if ((team.co_leader_ids || []).includes(member.id)) return "co_captain";
  return "player";
}

export function orderedFaces(team: FaceTeam | null | undefined) {
  const order: Record<TeamRole, number> = { captain: 0, co_captain: 1, player: 2 };
  return (team?.members || [])
    .map((member, index) => ({ member, index, role: memberRole(team, member) }))
    .sort((a, b) => order[a.role] - order[b.role] || a.index - b.index)
    .map(({ member, role }) => ({ ...member, role, roleLabel: ROLE_LABELS[role] }));
}

export function initials(name?: string | null): string {
  const text = String(name || "").trim();
  if (!text) return "?";
  const words = text.split(/[\s_.-]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const capitals = text.match(/[A-ZÄÖÜ]/g) || [];
  if (capitals.length >= 2) return (capitals[0] + capitals[1]).toUpperCase();
  return text.slice(0, 2).toUpperCase();
}
