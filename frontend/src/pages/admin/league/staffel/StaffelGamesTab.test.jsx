import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Reiter „Spiele und Ergebnisse“ der Staffel-Seite (#2262, Paket B): Liste je Spielwoche, Chips nur als Anzeige, „Zum Spiel“,
// Ergebnis mit „Ergebnisse korrigieren“ (Befangenheit wie überall), „Beide nicht erschienen“. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({
  API: "http://test.local/api",
  api: apiMock,
  formatApiError: (detail) => String(detail || "Fehler"),
  formatRequestError: (_error, fallback) => fallback,
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { StaffelGamesTab } = await import("./StaffelGamesTab");

const REGS = [{ id: "r1", display_name: "Nebelwölfe · Rudel" }, { id: "r2", display_name: "Sturmfalken · Horst" }, { id: "r3", display_name: "Bergdohlen" }];
const slots = (a, b) => [{ slot: 1, registration_id: a, status: "filled" }, { slot: 2, registration_id: b, status: "filled" }];
const MATCHES = [
  { id: "m1", tournament_id: "t1", matchday_number: 1, status: "completed", slots: slots("r1", "r2"),
    results: [{ registration_id: "r1", score: 2, rank: 1 }, { registration_id: "r2", score: 1, rank: 2 }] },
  { id: "m2", tournament_id: "t1", matchday_number: 2, status: "scheduled", scheduled_at: "2026-11-25T19:00:00Z", slots: slots("r2", "r3"),
    league_marks: { checkin: "open", checked_in: 1, veto: null, incidents: 1, procedures: 0 } },
  { id: "m3", tournament_id: "t1", matchday_number: 2, status: "scheduled", slots: slots("r3", "r1"), viewer_involved: true, viewer_override: false },
  { id: "p1", tournament_id: "t1", matchday_number: 1, status: "pending", is_preview: true, slots: slots("r1", "r3") },
];
const LIVE = { id: "t1", status: "live", league_context: { season_id: "s1", staffel: "A" }, can_manage_all_results: true };

function renderTab(tournament = LIVE, matches = MATCHES) {
  return render(<MemoryRouter><StaffelGamesTab tournament={tournament} registrations={REGS} matches={matches} onReload={vi.fn()} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: {} });
});

test("je Spielwoche Stand, Ergebnis und Chips - Vorschau-Spiele zählen nicht", () => {
  renderTab();
  expect(screen.getByTestId("staffel-games-count")).toHaveTextContent("1 von 3 gespielt");
  expect(screen.getByTestId("staffel-week-1")).toHaveTextContent("alle gespielt");
  expect(screen.getByTestId("staffel-week-2")).toHaveTextContent("0 von 2 gespielt");
  expect(screen.queryByTestId("staffel-game-p1")).toBeNull();
  expect(screen.getByTestId("staffel-game-score-m1")).toHaveTextContent("2 : 1");
  expect(screen.getByTestId("staffel-game-state-m1")).toHaveTextContent("Gespielt");
  expect(screen.getByTestId("staffel-game-state-m2")).toHaveTextContent("Geplant");
  const chips = screen.getByTestId("staffel-game-chips-m2");
  expect(chips).toHaveTextContent("Check-in 1 von 2");
  expect(chips).toHaveTextContent("Vorfall offen");
  expect(screen.getByTestId("staffel-week-warn-2")).toHaveTextContent("1 Spiel mit offenem Punkt");
  expect(screen.queryByTestId("staffel-week-warn-1")).toBeNull();
  // Gespielte Wochen klappen zu, offene sind aufgeklappt.
  expect(screen.getByTestId("staffel-week-1")).not.toHaveAttribute("open");
  expect(screen.getByTestId("staffel-week-2")).toHaveAttribute("open");
  expect(screen.getByTestId("staffel-game-open-m2")).toHaveAttribute("href", "/matches/m2");
});

test("Ergebnis eintragen öffnet das eine Ergebnis-Fenster; im eigenen Spiel steht der Satz statt der Knöpfe", async () => {
  const user = userEvent.setup();
  renderTab();
  expect(screen.getByTestId("staffel-game-result-m1")).toHaveTextContent("Ergebnis korrigieren");
  expect(screen.getByTestId("staffel-game-result-m2")).toHaveTextContent("Ergebnis eintragen");
  expect(within(screen.getByTestId("staffel-game-m2")).getByTestId("match-double-no-show")).toBeInTheDocument();
  expect(screen.queryByTestId("staffel-game-result-m3")).toBeNull();
  expect(screen.getByTestId("staffel-game-own-m3")).toHaveTextContent("eigenes Team");
  expect(within(screen.getByTestId("staffel-game-m3")).getByTestId("match-double-no-show-own")).toBeInTheDocument();
  await user.click(screen.getByTestId("staffel-game-result-m2"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/matches/m2/page"));
});

test("ohne „Ergebnisse korrigieren“ oder außerhalb des Spielbetriebs nur „Zum Spiel“", () => {
  const { unmount } = renderTab({ ...LIVE, can_manage_all_results: false });
  expect(screen.queryByTestId("staffel-game-result-m2")).toBeNull();
  expect(screen.queryByTestId("match-double-no-show")).toBeNull();
  expect(screen.getByTestId("staffel-game-open-m2")).toBeInTheDocument();
  unmount();
  renderTab({ ...LIVE, status: "completed" });
  expect(screen.queryByTestId("staffel-game-result-m2")).toBeNull();
});

test("vor dem Start: keine festen Spiele, Hinweis auf den Spielplan", () => {
  renderTab({ ...LIVE, status: "draft" }, [MATCHES[3]]);
  expect(screen.getByTestId("staffel-games-empty")).toHaveTextContent("Noch keine festen Spiele.");
  expect(screen.getByText(/Liga starten/)).toBeInTheDocument();
});

test("kampflos und beide nicht erschienen in Liga-Wörtern", () => {
  renderTab(LIVE, [
    { ...MATCHES[0], id: "f1", status: "forfeit", results: [{ registration_id: "r1", score: 3, rank: 1 }, { registration_id: "r2", score: 0, rank: 2, forfeit: true }] },
    { ...MATCHES[0], id: "f2", status: "forfeit", double_forfeit: true, results: [] },
  ]);
  expect(screen.getByTestId("staffel-game-state-f1")).toHaveTextContent("Kampflos gewertet");
  expect(screen.getByTestId("staffel-game-score-f1")).toHaveTextContent("3 : 0");
  expect(screen.getByTestId("staffel-game-state-f2")).toHaveTextContent("Beide nicht erschienen");
  expect(within(screen.getByTestId("staffel-game-f2")).getByTestId("match-double-no-show-undo")).toHaveTextContent("Neu ansetzen");
});
