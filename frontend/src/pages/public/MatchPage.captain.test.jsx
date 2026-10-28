import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Captains auf der Matchseite (#2110): der eigene Vorschlag wartet auf die Gegenseite und lässt sich zurückziehen,
// Zustände stehen auf Deutsch, nach der Nachtragsfrist steht der Weg über @leitung da, und eine Staffel führt über
// „Liga · Season · Staffel“ statt „Turniere“. Erfundene Namen.

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

const LEAGUES = [{
  id: "lg1", slug: "probe-liga", name: "Probe-Liga",
  seasons: [{ id: "s1", slug: "season-1", name: "Season 1" }],
}];
const TOURNAMENT = {
  id: "t1", slug: "liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A",
  league_context: { league_id: "lg1", season_id: "s1", division_id: "d1", staffel: "A" },
};
const BASE = {
  tournament: TOURNAMENT,
  match: { id: "m1", match_key: "L1", status: "scheduled", schedule_status: "proposed", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  participants: [{ slot: 1, registration_id: "a", display_name: "Loewen · Rudel A" }, { slot: 2, registration_id: "b", display_name: "Falken · Horst" }],
  matchday_label: "Spieltag 1", collection: "matches_v2", can_act: true, can_propose_schedule: true, can_manage_schedule: true,
  can_player_report_result: false, can_submit_result: false, can_staff_submit_result: false, can_dispute: false,
  event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a",
};
const OWN = { id: "p-own", status: "pending", kind: "proposal", actor_registration_id: "a", actor_user_id: "c1", scheduled_at: "2026-11-15T19:00:00+00:00", actor: { display_name: "Kapitaen" } };
const THEIRS = { id: "p-theirs", status: "pending", kind: "counter", actor_registration_id: "b", actor_user_id: "f1", scheduled_at: "2026-11-16T19:00:00+00:00", actor: { display_name: "Falke" } };
const OLD = { id: "p-old", status: "declined", kind: "proposal", actor_registration_id: "b", actor_user_id: "f1", scheduled_at: "2026-11-14T19:00:00+00:00", actor: { display_name: "Falke" } };

function renderMatch(page, leagues = LEAGUES) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/matches/m1/page") return { data: page };
    if (url === "/leagues") return { data: { leagues } };
    return { data: [] };
  });
  return render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { ok: true } });
});

test("der eigene Vorschlag wartet auf die Gegenseite und lässt sich zurückziehen", async () => {
  renderMatch({ ...BASE, schedule_proposals: [OWN, OLD] });
  const own = await screen.findByTestId("match-proposal-p-own");
  expect(within(own).getByTestId("match-proposal-status-p-own")).toHaveTextContent("wartet auf die Gegenseite");
  expect(within(own).queryByLabelText("Termin annehmen")).toBeNull();
  expect(within(own).queryByText("Gegenvorschlag")).toBeNull();
  expect(screen.getByTestId("match-proposal-status-p-old")).toHaveTextContent("abgelehnt");
  expect(screen.getByTestId("match-schedule-headline")).toHaveTextContent("Wartet auf Gegenseite");

  fireEvent.click(within(own).getByTestId("match-proposal-withdraw-p-own"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/p-own/decision", { action: "withdraw", note: null }));
});

test("den Vorschlag der Gegenseite beantwortet man - Zustand auf Deutsch, nie „pending“", async () => {
  renderMatch({ ...BASE, schedule_proposals: [THEIRS] });
  const card = await screen.findByTestId("match-proposal-p-theirs");
  expect(within(card).getByTestId("match-proposal-status-p-theirs")).toHaveTextContent("Gegenvorschlag, offen");
  expect(card).not.toHaveTextContent("pending");
  expect(within(card).queryByTestId("match-proposal-withdraw-p-theirs")).toBeNull();
  expect(screen.getByTestId("match-schedule-headline")).toHaveTextContent("Terminvorschlag offen");
  fireEvent.click(within(card).getByLabelText("Termin annehmen"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/p-theirs/decision", { action: "accept", note: null }));
});
