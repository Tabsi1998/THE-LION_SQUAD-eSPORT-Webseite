import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { LeagueReportForm, LineupPicker, ParticipantsPicker } from "./LeagueReportForm";
import { LeagueGamesView, LineupAmendForm, StaffLineupAmend } from "./LeagueGamesView";
import { confirmPayload, isSeries, participantsProblem, reportPayload, staffListsStart, staffPayload, staffProblem, toggleLineup } from "./leagueGames";

// Teilnehmerliste einmal je Spiel (docs/LIGA.md, B.3, #2204). Erfundene Namen.

const ROSTER = [
  { id: "u1", name: "Kapitaen" },
  { id: "u2", name: "Mila" },
  { id: "u3", name: "Tom" },
  { id: "u4", name: "Ida" },
  { id: "u5", name: "Ben" },
  { id: "u6", name: "Pia", lineup_blocked: "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein." },
];
const SIDES = [{ registration_id: "a", name: "Loewen" }, { registration_id: "b", name: "Falken" }];
const POOL = { modes: [{ mode: "", label: "", maps: [{ map_id: "m1", name: "Hafen" }, { map_id: "m2", name: "Turm" }] }] };
const LEAGUE = {
  lineup_mode: "series", lineup_min_players: 3, best_of: 1, needed: 1, team_size: 4, pool: POOL, sides: SIDES, roster: ROSTER, own_registration_id: "a",
  mode_order: [], games: [], participants: {}, lineups_missing: [], map_repeat: "always",
};
const PLAYED = [{ position: 1, map_id: "m1", map_name: "Hafen", winner_registration_id: "a", scores: {}, lineups: {} }];

test("nur eine Staffel mit dem Feld arbeitet mit der Liste", () => {
  expect(isSeries(LEAGUE)).toBe(true);
  expect(isSeries({})).toBe(false);
  expect(isSeries({ lineup_mode: "per_map" })).toBe(false);
});

test("die Liste ist nach oben offen und verlangt die Mindestzahl", () => {
  expect(participantsProblem(["u1", "u2"], LEAGUE)).toContain("mindestens 3");
  expect(participantsProblem(["u1", "u2", "u3"], LEAGUE)).toBeNull();
  expect(toggleLineup(["u1", "u2", "u3", "u4"], "u5", null)).toHaveLength(5);
  expect(toggleLineup(["u1", "u2", "u3", "u4"], "u5", 4)).toHaveLength(4);
});

test("die Meldung trägt die Liste einmal und nicht je Map", () => {
  const body = reportPayload([{ position: 1, map_id: "m1", winner: "a", scores: {}, lineup: [] }], LEAGUE, ["u1", "u2", "u3"]);
  expect(body.lineup).toEqual(["u1", "u2", "u3"]);
  expect(body.games[0]).not.toHaveProperty("lineup");
  const confirmed = confirmPayload([{ position: 1, map_id: "m1", winner_registration_id: "a" }], ["u1", "u2", "u3"], LEAGUE);
  expect(confirmed.lineup).toEqual(["u1", "u2", "u3"]);
  const oldStyle = reportPayload([{ position: 1, map_id: "m1", winner: "a", scores: {}, lineup: ["u1"] }], { ...LEAGUE, lineup_mode: "per_map" });
  expect(oldStyle.games[0].lineup).toEqual(["u1"]);
  expect(oldStyle).not.toHaveProperty("lineup");
});

test("die Leitung schickt je Seite freiwillig, wenn, dann vollständig", () => {
  const games = [{ position: 1, map_id: "m1", winner: "a", scores: {}, lineup: [] }];
  expect(staffProblem(games, LEAGUE, { a: ["u1"] })).toContain("mindestens 3");
  expect(staffProblem(games, LEAGUE, { a: ["u1", "u2", "u3"] })).toBeNull();
  expect(staffProblem(games, LEAGUE, {})).toBeNull();
  const body = staffPayload(games, LEAGUE, { a: ["u1", "u2", "u3"], b: [] });
  expect(body.lineups).toEqual({ a: ["u1", "u2", "u3"] });
  expect(body.games[0]).not.toHaveProperty("lineups");
  expect(staffListsStart({ participants: { a: [{ id: "u1", name: "K" }] } })).toEqual({ a: ["u1"] });
});

test("der Picker zählt ohne Obergrenze und erklärt, was einzutragen ist", () => {
  const onChange = vi.fn();
  render(<ParticipantsPicker roster={ROSTER} value={["u1", "u2", "u3", "u4"]} league={LEAGUE} onChange={onChange} />);
  expect(screen.getByTestId("league-participants-count").textContent).toBe("4 · mindestens 3");
  expect(screen.getByTestId("league-participants-hint").textContent).toContain("mindestens eine Map");
  fireEvent.click(screen.getByTestId("league-participants-u5"));
  expect(onChange).toHaveBeenCalledWith(["u1", "u2", "u3", "u4", "u5"]);
  expect(screen.getByTestId("league-participants-u6")).toBeDisabled();
  expect(screen.getByTestId("league-participants-blocked").textContent).toContain("Geburtsdatum fehlt");
});

test("mit Größe bleibt der Picker genau wie bisher", () => {
  render(<LineupPicker roster={ROSTER} value={["u1"]} size={2} onChange={() => {}} testId="alt" />);
  expect(screen.getByTestId("alt-count").textContent).toBe("1/2");
});

test("das Formular meldet Maps je Map und die Liste einmal am Schluss", async () => {
  const onReport = vi.fn().mockResolvedValue(true);
  render(<LeagueReportForm league={LEAGUE} onReport={onReport} />);
  expect(screen.queryByTestId("league-game-1-lineup")).toBeNull();

  fireEvent.click(screen.getByTestId("league-game-1-map-m1"));
  fireEvent.click(screen.getByTestId("league-game-1-winner-a"));
  expect(screen.getByTestId("match-report-sentence").textContent).toContain("mindestens 3");
  fireEvent.click(screen.getByTestId("match-report-submit"));
  expect(onReport).not.toHaveBeenCalled();

  for (const id of ["u1", "u2", "u3", "u4", "u5"]) fireEvent.click(screen.getByTestId(`league-participants-${id}`));
  fireEvent.click(screen.getByTestId("match-report-submit"));

  await vi.waitFor(() => expect(onReport).toHaveBeenCalled());
  const body = onReport.mock.calls[0][0];
  expect(body.lineup).toEqual(["u1", "u2", "u3", "u4", "u5"]);
  expect(body.games[0].map_id).toBe("m1");
});

test("beim Bestätigen kreuzt die Gegenseite einmal an", async () => {
  const onReport = vi.fn().mockResolvedValue(true);
  const league = { ...LEAGUE, proposal_games: PLAYED };
  render(<LeagueReportForm league={league} state={{ status: "confirm" }} onReport={onReport} />);

  fireEvent.click(screen.getByTestId("match-report-confirm"));
  expect(screen.getByTestId("league-confirm-error").textContent).toContain("mindestens 3");

  for (const id of ["u1", "u2", "u3"]) fireEvent.click(screen.getByTestId(`league-confirm-participants-${id}`));
  fireEvent.click(screen.getByTestId("match-report-confirm"));
  await vi.waitFor(() => expect(onReport).toHaveBeenCalled());
  expect(onReport.mock.calls[0][0].lineup).toEqual(["u1", "u2", "u3"]);
});

test("die Ansicht zeigt die Liste je Seite und was fehlt", () => {
  render(<LeagueGamesView league={{ ...LEAGUE, games: PLAYED, participants: { a: [{ id: "u1", name: "Kapitaen" }] }, lineups_missing: ["b"] }} />);
  expect(screen.getByTestId("league-participants-a").textContent).toContain("Kapitaen");
  expect(screen.getByTestId("league-participants-b").textContent).toContain("Teilnehmerliste fehlt noch");
});

test("Gäste sehen die Liste nicht", () => {
  render(<LeagueGamesView league={{ ...LEAGUE, own_registration_id: null, games: PLAYED, participants: {}, lineups_missing: ["b"] }} />);
  expect(screen.queryByTestId("league-participants-view")).toBeNull();
});

test("Captain oder Vertreter tragen nur die eigene Seite nach", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  render(<LineupAmendForm league={{ ...LEAGUE, games: PLAYED, can_amend_lineup: true, lineups_missing: ["a"], amend_until: "2026-11-04T12:00:00+00:00" }} onSave={onSave} />);
  expect(screen.getByTestId("league-lineup-amend").textContent).toContain("Das Ergebnis gilt");

  fireEvent.click(screen.getByTestId("league-amend-save"));
  expect(screen.getByTestId("league-amend-error").textContent).toContain("mindestens 3");
  for (const id of ["u1", "u2", "u3"]) fireEvent.click(screen.getByTestId(`league-amend-participants-${id}`));
  fireEvent.click(screen.getByTestId("league-amend-save"));

  await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({ lineup: ["u1", "u2", "u3"] }));
});

test("nach der Frist steht da, dass das Ergebnis gilt und die Leitung entscheidet", () => {
  render(<LineupAmendForm league={{ ...LEAGUE, games: PLAYED, can_amend_lineup: false, lineups_missing: ["a"], amend_until: "2020-01-01T12:00:00+00:00" }} onSave={() => {}} />);
  const text = screen.getByTestId("league-lineup-closed").textContent;
  expect(text).toContain("Das Ergebnis bleibt gültig");
  expect(text).toContain("Liga-Leitung");
});

test("die Leitung trägt mit Grund nach", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  render(<StaffLineupAmend league={{ ...LEAGUE, games: PLAYED, rosters: { a: ROSTER, b: ROSTER }, lineups_missing: ["b"], lineup_overdue: true }} onSave={onSave} />);
  fireEvent.click(screen.getByTestId("league-staff-amend-open"));
  expect(screen.getByTestId("league-staff-amend-overdue")).toBeTruthy();
  for (const id of ["u1", "u2", "u3"]) fireEvent.click(screen.getByTestId(`league-staff-amend-participants-${id}`));
  fireEvent.click(screen.getByTestId("league-staff-amend-save"));
  expect(screen.getByTestId("league-staff-amend-error").textContent).toContain("Grund");
  fireEvent.change(screen.getByTestId("league-staff-amend-reason"), { target: { value: "Screenshot im Chat" } });
  fireEvent.click(screen.getByTestId("league-staff-amend-save"));
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({ lineup: ["u1", "u2", "u3"], registration_id: "b", reason: "Screenshot im Chat" }));
});
