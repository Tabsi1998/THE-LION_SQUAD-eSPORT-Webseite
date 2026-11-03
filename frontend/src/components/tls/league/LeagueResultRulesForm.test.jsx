import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeagueReportForm } from "./LeagueReportForm";
import { LeagueGamesView } from "./LeagueGamesView";

// Ergebnisregeln im Meldeformular (docs/LIGA.md, C.3, #1617): die Regel je Map sichtbar, Punkte bei Pflicht offen, Prüfung vorab
// im Klartext. Erfundene Namen und Werte.

const LEAGUE = {
  best_of: 3, needed: 2, team_size: 1, mode_order: ["stellung", "suchen"],
  pool: { id: "pool", modes: [
    { mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafen" }] },
    { mode: "suchen", label: "Suchen", maps: [{ map_id: "turm", name: "Turm" }] },
  ] },
  sides: [{ registration_id: "a", name: "Rudel A" }, { registration_id: "b", name: "Horst" }],
  own_registration_id: "a", roster: [{ id: "u1", name: "Mila" }],
  games: [], lineups_missing: [], own_games: [], proposal_games: [], can_amend_lineup: false,
  result_rules: { stellung: { kind: "score", target: 250, time_limit_minutes: 10 }, suchen: { kind: "rounds", target: 6, round_limit: 11 } },
  scores_required: true,
};

test("zeigt die Regel je Map, Punkte sind Pflicht und 7:5 wird vorab abgelehnt", async () => {
  const onReport = vi.fn().mockResolvedValue(true);
  render(<LeagueReportForm league={LEAGUE} state={{ status: "open" }} onReport={onReport} />);

  expect(screen.getByTestId("league-game-1-rule")).toHaveTextContent("bis 250 Punkte · 10 Min.");
  // Bei Punktepflicht stehen die Felder gleich da - ohne „freiwillig“.
  expect(screen.getByTestId("league-game-1-score-a")).toBeInTheDocument();
  expect(screen.queryByText("Punkte eintragen (freiwillig)")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("league-game-1-map-hafen"));
  fireEvent.click(screen.getByTestId("league-game-1-winner-a"));
  fireEvent.click(screen.getByTestId("league-game-1-lineup-u1"));
  fireEvent.click(screen.getByTestId("league-game-2-map-turm"));
  fireEvent.click(screen.getByTestId("league-game-2-winner-a"));
  expect(screen.getByTestId("league-game-2-rule")).toHaveTextContent("6 Runden, höchstens 11");
  expect(screen.getByTestId("match-report-sentence")).toHaveTextContent("Map 1: bitte die Punkte beider Seiten eintragen – in dieser Liga sind sie Pflicht.");

  fireEvent.change(screen.getByTestId("league-game-1-score-a"), { target: { value: "250" } });
  fireEvent.change(screen.getByTestId("league-game-1-score-b"), { target: { value: "180" } });
  fireEvent.change(screen.getByTestId("league-game-2-score-a"), { target: { value: "7" } });
  fireEvent.change(screen.getByTestId("league-game-2-score-b"), { target: { value: "5" } });
  fireEvent.click(screen.getByTestId("match-report-submit"));
  expect(screen.getByTestId("match-report-error")).toHaveTextContent("Map 2: höchstens 11 Runden – 7:5 sind 12.");
  expect(onReport).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("league-game-2-score-a"), { target: { value: "6" } });
  fireEvent.click(screen.getByTestId("match-report-submit"));
  await waitFor(() => expect(onReport).toHaveBeenCalled());
  expect(onReport.mock.calls[0][0].games[1].scores).toEqual({ a: 6, b: 5 });
});

test("ohne Regel und Pflicht bleibt das Formular wie vorher", () => {
  render(<LeagueReportForm league={{ ...LEAGUE, result_rules: {}, scores_required: false }} state={{ status: "open" }} onReport={vi.fn()} />);
  expect(screen.queryByTestId("league-game-1-rule")).not.toBeInTheDocument();
  expect(screen.getByText("Punkte eintragen (freiwillig)")).toBeInTheDocument();
});

test("die gespielten Maps zeigen „wiederholt“, „zugesprochen“ und die nicht gespielten Positionen", () => {
  const games = [
    { position: 1, mode_label: "Stellung", map_name: "Hafen", winner_registration_id: "a", scores: { a: 250, b: 1 }, lineups: {},
      status: "replayed", replay_reason: "Verbindung brach ab" },
    { position: 2, mode_label: "Suchen", map_name: "Turm", winner_registration_id: "a", scores: {}, lineups: {}, decision: "awarded" },
  ];
  render(<LeagueGamesView league={{ ...LEAGUE, best_of: 5, needed: 3, games: [...games, { ...games[0], position: 3, status: undefined }], not_played: [4, 5] }} />);

  expect(screen.getByTestId("league-games-1-replayed")).toHaveTextContent("Wiederholt: Verbindung brach ab");
  expect(screen.getByTestId("league-games-2-awarded")).toHaveTextContent("Zugesprochen");
  expect(screen.getByTestId("league-games-not-played")).toHaveTextContent("Map 4 und 5 nicht gespielt – die Serie war entschieden.");
});
