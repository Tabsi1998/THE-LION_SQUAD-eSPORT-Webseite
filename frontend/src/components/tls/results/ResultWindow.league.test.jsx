import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Ergebnis-Fenster der Turnierleitung bei Liga-Spielen (#1650): Maps, Sieger je Map und die Aufstellungen beider
// Seiten eintragen oder korrigieren; dazu der Nachtrag einer fehlenden Aufstellung mit Grund. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value, resolveMediaUrl: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ResultWindow } = await import("./ResultWindow");
const { StaffLineupAmend } = await import("@/components/tls/league/LeagueGamesView");

const ENTRY = {
  id: "m1", kind: "duel", best_of: 3, ranking_mode: "higher_score", allows_draw: false, label: "Spieltag 1",
  participants: [{ registration_id: "a", name: "Loewen · Rudel A" }, { registration_id: "b", name: "Falken · Horst" }],
  advance: {}, has_result: false, result: [],
};
const LEAGUE = {
  best_of: 3, needed: 2, team_size: 2, mode_order: ["stellung", "suchen"],
  pool: { modes: [{ mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafen" }, { map_id: "nebel", name: "Nebel" }] },
                  { mode: "suchen", label: "Suchen", maps: [{ map_id: "turm", name: "Turm" }] }] },
  sides: [{ registration_id: "a", name: "Loewen · Rudel A" }, { registration_id: "b", name: "Falken · Horst" }],
  rosters: { a: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }], b: [{ id: "f1", name: "Falke 1" }, { id: "f2", name: "Falke 2" }] },
  roster: [], games: [], proposal_games: [], lineups_missing: [],
};

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { held: true, hold: { id: "h1", undo_seconds: 10 } } });
});

test("eintragen: je Map Map und Sieger, Aufstellungen beider Seiten - gespeichert wird mit Maps", async () => {
  render(<ResultWindow entry={ENTRY} league={LEAGUE} onClose={() => {}} onSaved={vi.fn()} />);
  expect(screen.getByTestId("result-window")).toHaveAttribute("data-kind", "maps");
  fireEvent.click(screen.getByTestId("league-game-1-map-nebel"));
  fireEvent.click(screen.getByTestId("league-game-1-winner-b"));
  fireEvent.click(screen.getByTestId("league-game-1-lineup-a-u1"));
  fireEvent.click(screen.getByTestId("result-save"));
  expect(screen.getByTestId("result-error")).toHaveTextContent("Map 2: bitte die Map wählen.");

  fireEvent.click(screen.getByTestId("league-game-2-map-turm"));
  fireEvent.click(screen.getByTestId("league-game-2-winner-b"));
  fireEvent.click(screen.getByTestId("result-save"));
  expect(screen.getByTestId("result-error")).toHaveTextContent("Aufstellung Loewen · Rudel A – genau 2 Spieler oder keine.");
  // Map 2 hatte dieselbe Aufstellung - sie zieht mit.
  fireEvent.click(screen.getByTestId("league-game-1-lineup-a-u2"));
  expect(screen.getByTestId("league-game-2-lineup-a-u2")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("result-sentence")).toHaveTextContent("Falken · Horst gewinnt 2:0");
  fireEvent.click(screen.getByTestId("result-save"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const [url, body] = apiMock.post.mock.calls[0];
  expect(url).toBe("/matches/m1/result");
  expect(body.hold).toBe(true);
  expect(body.results).toEqual([{ registration_id: "b", rank: 1, score: 2 }, { registration_id: "a", rank: 2, score: 0 }]);
  expect(body.games.map((game) => [game.map_id, game.winner_registration_id, game.lineups])).toEqual([
    ["nebel", "b", { a: ["u1", "u2"] }],
    ["turm", "b", { a: ["u1", "u2"] }],
  ]);
});

test("korrigieren: beginnt mit den geltenden Maps samt Aufstellungen, braucht einen Grund", async () => {
  const league = {
    ...LEAGUE,
    games: [
      { position: 1, mode: "stellung", map_id: "hafen", winner_registration_id: "a", scores: { a: 250 }, lineups: { a: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }] } },
      { position: 2, mode: "suchen", map_id: "turm", winner_registration_id: "a", scores: {}, lineups: {} },
    ],
  };
  render(<ResultWindow entry={{ ...ENTRY, has_result: true }} league={league} onClose={() => {}} onSaved={vi.fn()} />);
  expect(screen.getByTestId("league-game-1-map-hafen")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("league-game-1-lineup-a-u1")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTestId("league-game-2-lineup-b-f1"));
  fireEvent.click(screen.getByTestId("league-game-2-lineup-b-f2"));
  fireEvent.click(screen.getByTestId("result-save"));
  expect(screen.getByTestId("result-error")).toHaveTextContent("Grund");
  fireEvent.change(screen.getByTestId("result-reason"), { target: { value: "Aufstellung nachgereicht" } });
  fireEvent.click(screen.getByTestId("result-save"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const [url, body] = apiMock.post.mock.calls[0];
  expect(url).toBe("/matches/m1/result?force=true");
  expect(body.reason).toBe("Aufstellung nachgereicht");
  expect(body.games[0].scores).toEqual({ a: 250 });
  expect(body.games[1].lineups).toEqual({ b: ["f1", "f2"] });
});

test("Nachtrag der Turnierleitung: Seite wählen, Aufstellung je Map, Grund", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const league = {
    ...LEAGUE,
    games: [{ position: 1, map_name: "Hafen", winner_registration_id: "a", lineups: { a: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }] } }],
    lineups_missing: ["b"],
  };
  render(<StaffLineupAmend league={league} onSave={onSave} />);
  fireEvent.click(screen.getByTestId("league-staff-amend-open"));
  expect(screen.getByTestId("league-staff-amend-side-b")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTestId("league-staff-amend-lineup-1-f1"));
  fireEvent.click(screen.getByTestId("league-staff-amend-lineup-1-f2"));
  fireEvent.click(screen.getByTestId("league-staff-amend-save"));
  expect(screen.getByTestId("league-staff-amend-error")).toHaveTextContent("Grund");
  fireEvent.change(screen.getByTestId("league-staff-amend-reason"), { target: { value: "Per Discord gemeldet" } });
  fireEvent.click(screen.getByTestId("league-staff-amend-save"));

  await waitFor(() => expect(onSave).toHaveBeenCalledWith({
    games: [{ position: 1, lineup: ["f1", "f2"] }], registration_id: "b", reason: "Per Discord gemeldet",
  }));
});

test("ohne Maps: „Nicht erschienen“ über die gewohnten Eingaben, ohne Maps im Aufruf", async () => {
  render(<ResultWindow entry={ENTRY} league={LEAGUE} onClose={() => {}} onSaved={vi.fn()} />);
  expect(screen.getByTestId("result-maps-on")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTestId("result-maps-off"));
  expect(screen.getByTestId("result-window")).not.toHaveAttribute("data-kind", "maps");
  expect(screen.queryByTestId("league-game-1")).toBeNull();
  expect(screen.getByTestId("result-maps-off-hint")).toHaveTextContent("Nicht erschienen");
  fireEvent.click(screen.getByTestId("result-flag-b-no_show"));
  fireEvent.click(screen.getByTestId("result-save"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const body = apiMock.post.mock.calls[0][1];
  expect(body).not.toHaveProperty("games");
  expect(body.results.find((row) => row.registration_id === "b")).toMatchObject({ forfeit: true });

  fireEvent.click(screen.getByTestId("result-maps-on"));
  expect(screen.getByTestId("league-game-1")).toBeInTheDocument();
});