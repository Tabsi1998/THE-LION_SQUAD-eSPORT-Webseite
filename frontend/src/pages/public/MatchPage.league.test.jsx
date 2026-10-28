import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Liga-Spiel auf der Matchseite (#1650): statt Plus/Minus das Formular je Map; nach dem Ergebnis die Maps mit
// Aufstellungen und - wenn die eigene fehlt - der Nachtrag über PUT /lineups. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value, resolveMediaUrl: (value) => value }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "f1", username: "falke" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/tls/MentionTextarea", () => ({ MentionTextarea: () => <textarea /> }));
vi.mock("@/components/tls/CommendButton", () => ({ CommendButton: () => null }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useChats", () => ({ useChatRead: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const MatchPage = (await import("./MatchPage")).default;

const SIDES = [{ registration_id: "a", name: "Loewen · Rudel A" }, { registration_id: "b", name: "Falken · Horst" }];
const LEAGUE = {
  best_of: 3, needed: 2, team_size: 2, mode_order: ["stellung", "suchen"], sides: SIDES, own_registration_id: "b",
  pool: { modes: [{ mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafen" }] },
                  { mode: "suchen", label: "Suchen", maps: [{ map_id: "turm", name: "Turm" }] }] },
  roster: [{ id: "f1", name: "Falke 1" }, { id: "f2", name: "Falke 2" }],
  games: [], lineups_missing: [], own_games: [], proposal_games: [], can_amend_lineup: false,
};
const BASE = {
  tournament: { id: "t1", slug: "liga-a", title: "CoD-Liga · Staffel A" },
  match: { id: "m1", match_key: "L1", status: "scheduled", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  participants: [{ slot: 1, registration_id: "a", display_name: "Loewen · Rudel A" }, { slot: 2, registration_id: "b", display_name: "Falken · Horst" }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true, can_player_report_result: true,
  can_submit_result: false, can_staff_submit_result: false, can_dispute: false, event_mode: "online",
  result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
};

function renderMatch(page) {
  apiMock.get.mockImplementation(async (url) => (url === "/matches/m1/page" ? { data: page } : { data: [] }));
  return render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.put.mockReset();
  apiMock.post.mockResolvedValue({ data: { awaiting_confirmation: false } });
  apiMock.put.mockResolvedValue({ data: {} });
});

test("bestätigen mit eigener Aufstellung geht an /report", async () => {
  const league = { ...LEAGUE, proposal_games: [
    { position: 1, mode: "stellung", map_id: "hafen", map_name: "Hafen", winner_registration_id: "a" },
    { position: 2, mode: "suchen", map_id: "turm", map_name: "Turm", winner_registration_id: "a" },
  ] };
  renderMatch({ ...BASE, league, report_state: { status: "confirm", proposal_by: "Loewen · Rudel A" } });
  await screen.findByTestId("league-games-summary");
  expect(screen.queryByTestId("result-score")).toBeNull();
  fireEvent.click(screen.getByTestId("league-confirm-lineup-1-f1"));
  fireEvent.click(screen.getByTestId("league-confirm-lineup-1-f2"));
  fireEvent.click(screen.getByTestId("match-report-confirm"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const [url, payload] = apiMock.post.mock.calls[0];
  expect(url).toBe("/matches/m1/report");
  expect(payload.games.map((game) => [game.map_id, game.lineup])).toEqual([["hafen", ["f1", "f2"]], ["turm", ["f1", "f2"]]]);
});

test("nach dem Ergebnis: Maps mit Aufstellungen und Nachtrag der fehlenden", async () => {
  const league = {
    ...LEAGUE,
    games: [
      { position: 1, mode_label: "Stellung", map_name: "Hafen", winner_registration_id: "a", scores: {}, lineups: { a: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }] } },
      { position: 2, mode_label: "Suchen", map_name: "Turm", winner_registration_id: "a", scores: {}, lineups: { a: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }] } },
    ],
    lineups_missing: ["b"], can_amend_lineup: true,
  };
  renderMatch({ ...BASE, match: { ...BASE.match, status: "completed", results: [] }, can_player_report_result: false, league, report_state: { status: "agreed" } });
  expect(await screen.findByTestId("league-games-1")).toHaveTextContent("Mila, Tom");
  fireEvent.click(screen.getByTestId("league-amend-lineup-1-f1"));
  fireEvent.click(screen.getByTestId("league-amend-lineup-1-f2"));
  fireEvent.click(screen.getByTestId("league-amend-save"));

  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/matches/m1/lineups", {
    games: [{ position: 1, lineup: ["f1", "f2"] }, { position: 2, lineup: ["f1", "f2"] }],
  }));
});

test("ohne Einigung nennt der Terminkasten den Standardtermin der Spielwoche (#2096)", async () => {
  renderMatch({ ...BASE, league: { ...LEAGUE, default_time: "2026-11-15T19:00:00+00:00" }, report_state: { status: "open" } });
  expect(await screen.findByTestId("match-when")).toHaveTextContent("Standardtermin So 15.11., 20:00 (ohne Einigung)");
  expect(screen.getByTestId("match-schedule")).toHaveTextContent("Standardtermin");
});

test("die Sieger-Knöpfe folgen den Plätzen, auch wenn die Seiten anders herum kommen (#2096)", async () => {
  renderMatch({ ...BASE, league: { ...LEAGUE, sides: [...SIDES].reverse() }, report_state: { status: "open" } });
  const first = await screen.findByTestId("league-game-1");
  const winners = [...first.querySelectorAll('[data-testid^="league-game-1-winner-"]')].map((button) => button.textContent);
  expect(winners).toEqual(["Loewen · Rudel A", "Falken · Horst"]);
});
