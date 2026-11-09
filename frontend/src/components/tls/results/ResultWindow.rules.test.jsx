import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Ergebnis-Fenster und Ergebnisregeln (docs/LIGA.md, C.3, #1617): die Leitung prüft dieselben Regeln; übergehen darf nur der
// Superadmin mit Grund. Zusatzfelder einer Map bleiben bei der Korrektur erhalten. Erfundene Namen und Werte.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value, resolveMediaUrl: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ResultWindow } = await import("./ResultWindow");

const ENTRY = {
  id: "m1", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false, label: "Spieltag 1",
  participants: [{ registration_id: "a", name: "Rudel A" }, { registration_id: "b", name: "Horst" }], advance: {}, has_result: true, result: [],
};
const LEAGUE = {
  best_of: 1, needed: 1, team_size: 1, mode_order: [],
  pool: { modes: [{ mode: "suchen", label: "Suchen", maps: [{ map_id: "turm", name: "Turm" }] }] },
  sides: [{ registration_id: "a", name: "Rudel A" }, { registration_id: "b", name: "Horst" }],
  rosters: {}, roster: [], proposal_games: [], lineups_missing: [],
  result_rules: { suchen: { kind: "rounds", target: 6, round_limit: 11 } }, scores_required: true,
  games: [{ position: 1, mode: "suchen", map_id: "turm", winner_registration_id: "a", scores: { a: 7, b: 5 }, lineups: {},
    status: "replayed", replay_reason: "Verbindung brach ab" }],
};

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { held: true, hold: { id: "h1", undo_seconds: 10 } } });
});

test("die Leitung prüft dieselbe Regel - ohne Recht „Ergebnisse“ gibt es kein Übergehen", () => {
  render(<ResultWindow entry={ENTRY} league={LEAGUE} onClose={() => {}} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByTestId("result-reason"), { target: { value: "Stand korrigiert" } });
  fireEvent.click(screen.getByTestId("result-save"));
  expect(screen.getByTestId("result-error")).toHaveTextContent("Map 1: höchstens 11 Runden – 7:5 sind 12.");
  expect(screen.queryByTestId("result-rule-override")).not.toBeInTheDocument();
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("die Liga-Leitung übergeht die Regel mit Grund, Zusatzfelder der Map bleiben", async () => {
  render(<ResultWindow entry={ENTRY} league={{ ...LEAGUE, can_override_rules: true }} onClose={() => {}} onSaved={vi.fn()} />);
  expect(screen.getByTestId("result-rule-override")).toHaveTextContent("Ergebnisregel übergehen (Liga-Leitung, mit Grund)");
  expect(screen.getByTestId("result-rule-override")).not.toHaveTextContent("Superadmin");
  fireEvent.change(screen.getByTestId("result-reason"), { target: { value: "Stand korrigiert" } });
  fireEvent.change(screen.getByTestId("result-rule-override-reason"), { target: { value: "Server stürzte ab" } });
  fireEvent.click(screen.getByTestId("result-save"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const [, body] = apiMock.post.mock.calls[0];
  expect(body.rule_override_reason).toBe("Server stürzte ab");
  expect(body.games[0]).toMatchObject({ scores: { a: 7, b: 5 }, status: "replayed", replay_reason: "Verbindung brach ab" });
});

// Sieger aus den Punkten (#2334): Die Leitung behält die Knöpfe - vorgewählt aus den Punkten, übergehen bleibt möglich.
test("Leitung: Punkte wählen den Sieger vor, die Knöpfe bleiben, ein Widerspruch wird angezeigt", () => {
  const games = [{ ...LEAGUE.games[0], winner_registration_id: "b", scores: { a: 6, b: 4 }, status: undefined, replay_reason: undefined }];
  render(<ResultWindow entry={ENTRY} league={{ ...LEAGUE, games }} onClose={() => {}} onSaved={vi.fn()} />);
  expect(screen.getByTestId("league-game-1-winner-mismatch")).toHaveTextContent("Der Sieger passt nicht zu den Punkten – mehr Punkte hat Rudel A.");
  fireEvent.click(screen.getByTestId("league-game-1-winner-adopt"));
  expect(screen.getByTestId("league-game-1-winner-a")).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByTestId("league-game-1-winner-mismatch")).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId("league-game-1-score-b"), { target: { value: "6" } });
  fireEvent.change(screen.getByTestId("league-game-1-score-a"), { target: { value: "3" } });
  expect(screen.getByTestId("league-game-1-winner-b")).toHaveAttribute("aria-pressed", "true");
});

test("Leitung: mit Grund übergangen geht ein Sieger auch ohne Punkte", async () => {
  const games = [{ position: 1, mode: "suchen", map_id: "turm", winner_registration_id: "", scores: {}, lineups: {} }];
  render(<ResultWindow entry={ENTRY} league={{ ...LEAGUE, games, can_override_rules: true }} onClose={() => {}} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByTestId("league-game-1-winner-b"));
  fireEvent.change(screen.getByTestId("result-reason"), { target: { value: "Stand korrigiert" } });
  fireEvent.change(screen.getByTestId("result-rule-override-reason"), { target: { value: "Endstand nicht mehr bekannt" } });
  fireEvent.click(screen.getByTestId("result-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(apiMock.post.mock.calls[0][1].games[0]).toMatchObject({ winner_registration_id: "b" });
});
