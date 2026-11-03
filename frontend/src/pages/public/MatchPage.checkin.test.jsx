import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Liga-Check-in auf der Matchseite (#1652): der Block steht unter dem Kopf, nur wenn der Server ihn schickt; ohne Block bleibt die
// Seite wie vorher. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value, resolveMediaUrl: (value) => value }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "c1", username: "kapitaen" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/MentionTextarea", () => ({
  MentionTextarea: ({ value, onValueChange }) => <textarea data-testid="chat-input" value={value} onChange={(e) => onValueChange(e.target.value)} />,
}));
vi.mock("@/components/tls/CommendButton", () => ({ CommendButton: () => null }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useChats", () => ({ useChatRead: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const MatchPage = (await import("./MatchPage")).default;
const { resetLeagueTrail } = await import("@/hooks/useLeagueTrail");

const LATER = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const RULES = { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 2, remind_minutes_before_close: 5 };
const CHECKIN = {
  rules: RULES, state: "open", scheduled_at: LATER, window: { opens_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), closes_at: LATER },
  ready_at: null, started_at: null,
  sides: [
    { registration_id: "a", name: "Loewen · Rudel A", own: true, checked_in: false, present: [], present_count: 0, consent_open: false },
    { registration_id: "b", name: "Falken · Horst", own: false, checked_in: true, at: LATER, present: [{ id: "f1", name: "Falke" }], present_count: 1, consent_open: false },
  ],
  own_registration_id: "a", can_checkin: true, checkin_hint: null, roster: [{ id: "c1", name: "Kapitaen", blocked: null }, { id: "u2", name: "Mila", blocked: null }],
  min_present: 2, can_start: false, start_hint: "Starten geht erst, wenn beide Seiten eingecheckt sind.", proposal: null, lead: null,
};
const BASE = {
  tournament: { id: "t1", slug: "liga-a", title: "Probe-Liga · Staffel A" },
  match: { id: "m1", match_key: "L1", status: "scheduled", scheduled_at: LATER, slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  participants: [{ slot: 1, registration_id: "a", display_name: "Loewen · Rudel A" }, { slot: 2, registration_id: "b", display_name: "Falken · Horst" }],
  matchday_label: "Spieltag 1", collection: "matches_v2", can_act: true, can_propose_schedule: false, can_manage_schedule: false,
  can_player_report_result: false, can_submit_result: false, can_staff_submit_result: false, can_dispute: false,
  event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a",
  schedule_proposals: [], schedule_block: null, checkin: CHECKIN,
};

function renderMatch(page) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/matches/m1/page") return { data: page };
    if (url === "/leagues") return { data: { leagues: [] } };
    return { data: [] };
  });
  return render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetLeagueTrail();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

test("der Check-in steht unter dem Kopf mit Stand der Gegenseite und eigener Liste", async () => {
  renderMatch(BASE);
  const panel = await screen.findByTestId("checkin-panel");
  expect(panel).toHaveAttribute("data-state", "open");
  expect(screen.getByTestId("checkin-side-b")).toHaveAttribute("data-checked", "true");
  expect(screen.getByTestId("checkin-side-status-b")).toHaveTextContent("1 Spieler");
  expect(screen.getByTestId("checkin-roster-c1")).toBeInTheDocument();
  expect(screen.getByTestId("checkin-submit")).toBeDisabled();
});

test("ohne Block (andere Turniere, Unbeteiligte) bleibt die Seite wie vorher", async () => {
  renderMatch({ ...BASE, checkin: null });
  expect(await screen.findByTestId("match-schedule")).toBeInTheDocument();
  expect(screen.queryByTestId("checkin-panel")).toBeNull();
});
