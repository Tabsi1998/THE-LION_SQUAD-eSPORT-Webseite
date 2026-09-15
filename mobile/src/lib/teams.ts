import type { Team } from "../types";

// Teamliste: was die Karte zeigt und wie sich eigene und weitere Teams
// aufteilen. Squads erscheinen nur, wenn ein Team welche hat - "0 Squads"
// stand vorher zweimal auf jeder Karte (#215).

export function teamMembers(team: Team): number {
  return Number(team.member_count ?? team.members?.length ?? 0);
}

export function teamSquads(team: Team): number {
  return Number(team.squad_count ?? team.squads?.length ?? 0);
}

export function teamMeta(team: Team): string {
  const members = teamMembers(team);
  const squads = teamSquads(team);
  const parts = [`${members} ${members === 1 ? "Mitglied" : "Mitglieder"}`];
  if (squads > 0) parts.push(`${squads} ${squads === 1 ? "Squad" : "Squads"}`);
  return parts.join(" · ");
}

export function splitTeams(mine: Team[], all: Team[]): { mine: Team[]; others: Team[] } {
  const mineIds = new Set(mine.map((team) => team.id));
  return { mine, others: all.filter((team) => !mineIds.has(team.id)) };
}

export function chatTitle(team: Team): string {
  return `${team.tag || team.name} Chat`;
}
