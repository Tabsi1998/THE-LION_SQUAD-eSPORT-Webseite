import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Vorfälle auf der Matchseite (D.5, #1619): Beteiligte und Leitung bekommen die Fläche „Vorfälle im Spiel“, alle anderen
// lesen nur „in Klärung“ je Map. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", formatApiError: (value) => value, resolveMediaUrl: (value) => value }));
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
  best_of: 3, needed: 2, team_size: 2, mode_order: [], sides: SIDES, own_registration_id: null, pool: { modes: [] }, roster: [],
  games: [], lineups_missing: [], own_games: [], proposal_games: [], can_amend_lineup: false,
  map_state: [{ position: 1, state: "open" }, { position: 2, state: "in_clarification" }, { position: 3, state: "open" }],
  incidents: [], incident_info: null,
};
const BASE = {
  tournament: { id: "t1", slug: "liga-a", title: "CoD-Liga · Staffel A" },
  match: { id: "m1", match_key: "L1", status: "in_progress", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  participants: [{ slot: 1, registration_id: "a", display_name: "Loewen · Rudel A" }, { slot: 2, registration_id: "b", display_name: "Falken · Horst" }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_dispute: false, event_mode: "online",
  result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
};

function renderMatch(page) {
  apiMock.get.mockImplementation(async (url) => (url === "/matches/m1/page" ? { data: page }
    : url === "/matches/m1/proofs" ? { data: { items: [], open: true, can_add: false, limit: 10, link_max_length: 500 } } : { data: [] }));
  return render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
});

test("wer nicht dazugehört, liest nur „in Klärung“ an der Map - keine Fläche, kein Vorfall", async () => {
  renderMatch({ ...BASE, league: LEAGUE });
  expect(await screen.findByTestId("map-state-2")).toHaveTextContent("Map 2 ist in Klärung");
  expect(screen.queryByTestId("incident-panel")).toBeNull();
  expect(screen.queryByTestId("map-state-1")).toBeNull();
});

test("Beteiligte sehen die Fläche mit dem Vorfall - „in Klärung“ steht einmal am Chip der Map und einmal am Abzeichen", async () => {
  const incident = {
    id: "v1", position: 2, kind: "disconnect", kind_label: "Verbindungsabbruch", between_maps: false, at: "2026-11-11T19:00:00Z", score: null,
    players: [], note: "", proposal: "replay", proposal_label: "Map wiederholen", reported_by: { registration_id: "a", name: "Loewen · Rudel A", own: false },
    state: "in_review", open: true, expired: false, answer_deadline: "2026-11-11T19:10:00Z", answer: null, review_cause: "expired", counts_quota: false,
    decision: null, voided: null, procedure: false, can_answer: false, can_withdraw: false, can_decide: false, can_settle: false,
  };
  const info = { can_report: false, as_lead: false, can_decide: false, conflict: null, kinds: [], proposals: [], outcomes: [], answer_minutes: 10,
    clarification_mode: "pause_series", break_after: 2, break_minutes: 5, quota: { limit: 1, used: [] },
    hold: { code: "in_review", position: 2, text: "Map 2 ist in Klärung – die Liga-Leitung entscheidet. Bis dahin gilt kein Ergebnis." }, server_time: "2026-11-11T19:20:00Z" };
  renderMatch({ ...BASE, league: { ...LEAGUE, own_registration_id: "b", incidents: [incident], incident_info: info } });
  expect(await screen.findByTestId("incident-panel")).toHaveTextContent("Vorfälle im Spiel");
  expect(screen.queryByTestId("incident-hold")).toBeNull();
  expect(screen.getByTestId("incident-sentence-v1")).toHaveTextContent("Keine Antwort in der Antwortzeit. Die Serie pausiert: Spätere Maps meldet ihr erst nach der Entscheidung.");
  expect(screen.getByTestId("map-state-2")).toHaveTextContent("Map 2 ist in Klärung");
  expect(screen.getByTestId("incident-state-v1")).toHaveTextContent("In Klärung");
  // Auf der ganzen Seite: der Chip der Map und das Abzeichen der Karte - sonst nirgends. Und nur eines davon atmet.
  expect(document.body.textContent.match(/in Klärung/gi)).toHaveLength(2);
  expect(document.querySelectorAll(".tls-incident-pulse")).toHaveLength(1);
  expect(screen.getByTestId("incident-state-v1")).toHaveClass("tls-incident-pulse");
});
