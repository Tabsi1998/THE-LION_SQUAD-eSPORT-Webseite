import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Staffel-Tabelle auf der Ligaseite (E.1, #1625): Hinweis, was den Gleichstand entschied, „kampflos“, Tabellenende,
// keine Spalte „U“ ohne Remis, „beide nicht erschienen“ im Spielplan.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (url) => url || "" }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));

const { StaffelPanel } = await import("./StaffelPanel");

const row = (id, rank, extra = {}) => ({ registration_id: id, display_name: `Team ${id}`, rank, played: 2, won: 1, drawn: 0, lost: 1,
  score_for: 2, score_against: 2, score_diff: 0, points: 3, form: ["W", "L"], previous_rank: null, ...extra });

const DATA = {
  staffel: { tournament_id: "t1", staffel: "A", table_rules: { allow_draws: false, tiebreakers: ["head_to_head", "score_diff", "lead_decision"] } },
  standings: [
    row("a", 1, { tiebreak: "lead_decision", lead_decision: { reason: "Los vor beiden Captains" } }),
    row("b", 2, { tiebreak: "lead_decision", forfeit_won: 1 }),
    row("c", 3, { tiebreak: "head_to_head" }),
    row("x", 4, { exit: { kind: "withdrawn", at: "2026-11-20T10:00:00+00:00" }, points: 0, forfeit_lost: 2 }),
  ],
  teams: [],
  weeks: [{ week: 1, kind: "matchday", label: "Spielwoche 1", start_day: "2026-11-10", end_day: "2026-11-16", matches: [
    { id: "m1", done: true, forfeit: true, double_forfeit: true, home: { name: "Team a", registration_id: "a" }, away: { name: "Team b", registration_id: "b" }, games: [] },
  ] }],
  current: 1,
};

test("die Tabelle sagt, was entschied, und zeigt das Tabellenende", async () => {
  apiMock.get.mockResolvedValue({ data: DATA });
  render(<MemoryRouter><StaffelPanel leagueSlug="liga" seasonSlug="season-1" staffel={{ tournament_id: "t1", staffel: "A" }} /></MemoryRouter>);
  const table = await screen.findByRole("table", { name: "Tabelle Staffel A" });
  expect(within(table).queryByText("U")).toBeNull();
  expect(screen.getByTestId("standing-notes-a")).toHaveTextContent("Platz durch Entscheid der Leitung: Los vor beiden Captains");
  expect(screen.getByTestId("standing-notes-b")).toHaveTextContent("1× kampflos gewonnen");
  expect(screen.getByTestId("standing-notes-c")).toHaveTextContent("Direkter Vergleich");
  expect(screen.getByTestId("standing-notes-x")).toHaveTextContent("Ausgetreten");
  expect(screen.getByTestId("league-tiebreak-order-A")).toHaveTextContent("Punkte → Direkter Vergleich → Map-Differenz → Entscheid der Leitung");
  expect(screen.getByTestId("league-match-m1")).toHaveTextContent("beide nicht erschienen");
});

test("mit Remis bleibt die Spalte, ohne die neuen Felder bleibt die Zeile wie bisher", async () => {
  apiMock.get.mockResolvedValue({ data: { ...DATA, staffel: { tournament_id: "t1", staffel: "A", table_rules: null },
    standings: [row("a", 1)] } });
  render(<MemoryRouter><StaffelPanel leagueSlug="liga" seasonSlug="season-1" staffel={{ tournament_id: "t1", staffel: "A" }} /></MemoryRouter>);
  const table = await screen.findByRole("table", { name: "Tabelle Staffel A" });
  expect(within(table).getByText("U")).toBeInTheDocument();
  expect(screen.queryByTestId("standing-notes-a")).toBeNull();
  expect(screen.queryByTestId("league-tiebreak-order-A")).toBeNull();
});
