import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LeagueReportForm } from "./LeagueReportForm";
import { LeagueGamesView, LineupAmendForm } from "./LeagueGamesView";

// Liga-Ergebnis (#1650): melden mit Maps und eigener Aufstellung, bestätigen mit eigener Aufstellung, Maps anzeigen
// und die fehlende Aufstellung nachtragen. Erfundene Namen.

const LEAGUE = {
  best_of: 3,
  needed: 2,
  team_size: 2,
  mode_order: ["stellung", "suchen"],
  pool: {
    id: "pool",
    modes: [
      { mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafen", image_url: "/uploads/hafen.webp" }, { map_id: "nebel", name: "Nebel" }] },
      { mode: "suchen", label: "Suchen", maps: [{ map_id: "turm", name: "Turm" }] },
    ],
  },
  sides: [{ registration_id: "a", name: "Loewen · Rudel A" }, { registration_id: "b", name: "Falken · Horst" }],
  own_registration_id: "a",
  roster: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }, { id: "u3", name: "Ida" }],
  games: [],
  lineups_missing: [],
  own_games: [],
  proposal_games: [],
  can_amend_lineup: false,
};

test("melden: Map, Sieger und Aufstellung je Map - die zweite Map übernimmt die Aufstellung", async () => {
  const onReport = vi.fn().mockResolvedValue(true);
  render(<LeagueReportForm league={LEAGUE} state={{ status: "open" }} onReport={onReport} />);

  fireEvent.click(screen.getByTestId("match-report-submit"));
  expect(screen.getByTestId("match-report-error")).toHaveTextContent("Map 1: bitte die Map wählen.");

  fireEvent.click(screen.getByTestId("league-game-1-map-hafen"));
  fireEvent.click(screen.getByTestId("league-game-1-winner-a"));
  fireEvent.click(screen.getByTestId("league-game-1-lineup-u1"));
  fireEvent.click(screen.getByTestId("league-game-1-lineup-u2"));
  expect(screen.getByTestId("league-game-1-lineup-u3")).toBeDisabled();
  expect(screen.getByTestId("league-game-2")).toHaveTextContent("Map 2 · Suchen");
  expect(within(screen.getByTestId("league-game-2")).getByTestId("league-game-2-lineup-u1")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTestId("league-game-2-map-turm"));
  fireEvent.click(screen.getByTestId("league-game-2-winner-a"));
  expect(screen.queryByTestId("league-game-3")).not.toBeInTheDocument();
  expect(screen.getByTestId("match-report-sentence")).toHaveTextContent("Loewen · Rudel A gewinnt 2:0");

  fireEvent.click(screen.getByTestId("match-report-submit"));
  await waitFor(() => expect(onReport).toHaveBeenCalled());
  const payload = onReport.mock.calls[0][0];
  expect(payload.results).toEqual([{ registration_id: "a", rank: 1, score: 2 }, { registration_id: "b", rank: 2, score: 0 }]);
  expect(payload.games.map((game) => [game.position, game.mode, game.map_id, game.winner_registration_id, game.lineup])).toEqual([
    [1, "stellung", "hafen", "a", ["u1", "u2"]],
    [2, "suchen", "turm", "a", ["u1", "u2"]],
  ]);
});

test("bestätigen: Maps der Gegenseite in Worten, die eigene Aufstellung je Map dazu", async () => {
  const onReport = vi.fn().mockResolvedValue(true);
  const league = {
    ...LEAGUE,
    proposal_games: [
      { position: 1, mode: "stellung", mode_label: "Stellung", map_id: "hafen", map_name: "Hafen", winner_registration_id: "b", lineups: {} },
      { position: 2, mode: "suchen", mode_label: "Suchen", map_id: "turm", map_name: "Turm", winner_registration_id: "b", lineups: {} },
    ],
  };
  render(<LeagueReportForm league={league} state={{ status: "confirm", proposal_by: "Falken · Horst" }} onReport={onReport} />);

  expect(screen.getByTestId("league-games-summary")).toHaveTextContent("Map 1Hafen (Stellung)→ Falken · Horst");
  fireEvent.click(screen.getByTestId("match-report-confirm"));
  expect(screen.getByTestId("league-confirm-error")).toHaveTextContent("Map 1: bitte genau 2 Spieler aufstellen.");
  fireEvent.click(screen.getByTestId("league-confirm-lineup-1-u2"));
  fireEvent.click(screen.getByTestId("league-confirm-lineup-1-u3"));
  fireEvent.click(screen.getByTestId("match-report-confirm"));

  await waitFor(() => expect(onReport).toHaveBeenCalled());
  const payload = onReport.mock.calls[0][0];
  expect(payload.results[0]).toEqual({ registration_id: "b", rank: 1, score: 2 });
  expect(payload.games.map((game) => game.lineup)).toEqual([["u2", "u3"], ["u2", "u3"]]);
});

test("Mitglieder ohne Rolle sehen die Meldung, bestätigen können Captain und Vertreter", () => {
  const league = { ...LEAGUE, proposal_games: [{ position: 1, map_id: "hafen", map_name: "Hafen", winner_registration_id: "b" }] };
  render(<LeagueReportForm league={league} readOnly state={{ status: "confirm" }} onReport={vi.fn()} />);
  expect(screen.getByTestId("match-report-lead-confirms")).toHaveTextContent("Captain und Vertreter");
  expect(screen.queryByTestId("match-report-confirm")).not.toBeInTheDocument();
});

const PLAYED = {
  ...LEAGUE,
  games: [
    { position: 1, mode_label: "Stellung", map_name: "Hafen", map_image_url: "/uploads/hafen.webp", winner_registration_id: "a", scores: { a: 250, b: 180 },
      lineups: { a: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }] } },
    { position: 2, mode_label: "Suchen", map_name: "Turm", winner_registration_id: "a", scores: {}, lineups: { a: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }] } },
  ],
  lineups_missing: ["b"],
};

test("die Maps zeigen Sieger, Punkte, Aufstellungen und „Aufstellung fehlt noch“", () => {
  render(<LeagueGamesView league={PLAYED} />);
  const first = screen.getByTestId("league-games-1");
  expect(first).toHaveTextContent("Map 1 · Stellung");
  expect(first).toHaveTextContent("Hafen");
  expect(first).toHaveTextContent("Mila, Tom");
  expect(first).toHaveTextContent("250");
  expect(within(first).getByText("Aufstellung fehlt noch")).toBeInTheDocument();
});

test("nachtragen: je Map die eigene Aufstellung, die erste gibt die übrigen vor", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const league = { ...PLAYED, own_registration_id: "b", can_amend_lineup: true, amend_until: "2026-11-17T19:00:00Z",
    roster: [{ id: "f1", name: "Falke 1" }, { id: "f2", name: "Falke 2" }, { id: "f3", name: "Falke 3" }] };
  render(<LineupAmendForm league={league} onSave={onSave} />);

  expect(screen.getByTestId("league-lineup-amend")).toHaveTextContent("Eure Aufstellung fehlt noch");
  fireEvent.click(screen.getByTestId("league-amend-lineup-1-f1"));
  fireEvent.click(screen.getByTestId("league-amend-lineup-1-f2"));
  fireEvent.click(screen.getByTestId("league-amend-save"));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0]).toEqual({ games: [{ position: 1, lineup: ["f1", "f2"] }, { position: 2, lineup: ["f1", "f2"] }] });
});

test("ohne Recht oder nach der Frist kein Nachtrag", () => {
  const { container } = render(<LineupAmendForm league={{ ...PLAYED, can_amend_lineup: false }} onSave={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

test("bestätigen: Punkte der Erstmeldung stehen da, mit dem Hinweis auf den Einspruch", () => {
  const league = { ...LEAGUE, proposal_games: [
    { position: 1, map_id: "hafen", map_name: "Hafen", winner_registration_id: "a", scores: { a: 250, b: 180 } },
    { position: 2, map_id: "turm", map_name: "Turm", winner_registration_id: "a", scores: {} },
  ] };
  render(<LeagueReportForm league={league} state={{ status: "confirm" }} onReport={vi.fn()} />);
  expect(screen.getByTestId("league-games-summary-score-1")).toHaveTextContent("250:180");
  expect(screen.queryByTestId("league-games-summary-score-2")).toBeNull();
  expect(screen.getByTestId("league-confirm-scores-hint")).toHaveTextContent("Es zählen die Punkte der ersten Meldung");
});