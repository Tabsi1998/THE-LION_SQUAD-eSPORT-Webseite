import { chatTitle, splitTeams, teamMeta } from "./teams";
import type { Team } from "../types";

const team = (over: Partial<Team>): Team => ({ id: "t", name: "Lions", ...over });

test("Squads stehen nur dabei, wenn es welche gibt", () => {
  expect(teamMeta(team({ member_count: 12, squad_count: 0 }))).toBe("12 Mitglieder");
  expect(teamMeta(team({ member_count: 1 }))).toBe("1 Mitglied");
  expect(teamMeta(team({ member_count: 12, squad_count: 2 }))).toBe("12 Mitglieder · 2 Squads");
  expect(teamMeta(team({ members: [{ id: "a" }, { id: "b" }], squads: [{ name: "A" }] }))).toBe("2 Mitglieder · 1 Squad");
});

test("eigene Teams tauchen unter den weiteren nicht noch einmal auf", () => {
  const mine = [team({ id: "1" })];
  const all = [team({ id: "1" }), team({ id: "2", name: "Andere" })];
  expect(splitTeams(mine, all)).toEqual({ mine, others: [all[1]] });
  expect(splitTeams([], all).others).toHaveLength(2);
});

test("der Chat trägt das Kürzel, sonst den Namen", () => {
  expect(chatTitle(team({ tag: "TLS" }))).toBe("TLS Chat");
  expect(chatTitle(team({}))).toBe("Lions Chat");
});
