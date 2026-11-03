import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Liga-Termine auf der Matchseite (#2194): Grenzen im Klartext, Verschiebung beantragen und beantworten, Verlauf und das Feld
// der Liga-Leitung. Erfundene Namen.

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

const RULES = { home_rule: true, home_rule_hours: 72, reschedule_notice_hours: 24, reschedule_max: 2, reschedule_same_week: true,
  result_reminder_hours: 24, result_overdue_hours: 48 };
const FUTURE = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
const BLOCK = {
  rules: RULES, fixed: true, source: "accepted", scheduled_at: FUTURE, window: null, count: 1, remaining: 1,
  request_until: "2026-11-14T19:00:00+00:00", can_request: true, request_hint: null, requests: [],
  history: [{ id: "h1", kind: "agreement", to: FUTURE, from: null, by_name: "Falke", side_name: "Falken · Horst", at: "2026-11-10T10:00:00+00:00" }],
  home_rule_at: null, own_registration_id: "a", can_lead_set: false,
};
const BASE = {
  tournament: { id: "t1", slug: "liga-a", title: "Probe-Liga · Staffel A" },
  match: { id: "m1", match_key: "L1", status: "scheduled", schedule_status: "accepted", schedule_source: "accepted", scheduled_at: FUTURE,
    slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  participants: [{ slot: 1, registration_id: "a", display_name: "Loewen · Rudel A" }, { slot: 2, registration_id: "b", display_name: "Falken · Horst" }],
  matchday_label: "Spieltag 1", collection: "matches_v2", can_act: true, can_propose_schedule: false, can_manage_schedule: false,
  can_player_report_result: false, can_submit_result: false, can_staff_submit_result: false, can_dispute: false,
  event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a",
  schedule_proposals: [], schedule_block: BLOCK,
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
  apiMock.patch.mockReset();
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  apiMock.patch.mockResolvedValue({ data: { ok: true } });
});

test("fester Termin: Grenze im Klartext, kein Vorschlagsfeld, Verlauf, Antrag mit Grund", async () => {
  renderMatch(BASE);
  expect(await screen.findByTestId("schedule-limit")).toHaveTextContent("Noch 1 Verschiebung möglich, beantragen bis Sa 14.11. 20:00.");
  expect(screen.queryByTestId("match-proposal-at")).toBeNull();
  expect(screen.queryByText("Noch kein Terminvorschlag vorhanden.")).toBeNull();
  expect(screen.getByTestId("schedule-history-agreement")).toHaveTextContent("Einigung");
  expect(screen.getByTestId("schedule-rules")).toHaveTextContent("72 Stunden");

  fireEvent.click(screen.getByTestId("reschedule-form-submit"));
  expect(screen.getByTestId("reschedule-form-problem")).toHaveTextContent("Grund");
  expect(apiMock.post).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("reschedule-form-reason"), { target: { value: "Zwei Spieler im Nachtdienst" } });
  fireEvent.click(screen.getByTestId("reschedule-form-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/reschedule", expect.objectContaining({ reason: "Zwei Spieler im Nachtdienst" })));
});

test("die andere Seite stimmt zu oder lehnt ab, die eigene zieht zurück", async () => {
  const request = { id: "r1", status: "pending", from_at: FUTURE, to_at: FUTURE, reason: "Dienstreise", side_name: "Falken · Horst",
    requested_by_name: "Falke", own: false, can_answer: true, can_withdraw: false };
  renderMatch({ ...BASE, schedule_block: { ...BLOCK, can_request: false, request_hint: "Es ist schon eine Verschiebung offen", requests: [request] } });
  const row = await screen.findByTestId("reschedule-request-r1");
  expect(within(row).getByTestId("reschedule-status-r1")).toHaveTextContent("wartet auf Zustimmung");
  expect(screen.queryByTestId("reschedule-hint")).toBeNull();
  fireEvent.click(within(row).getByTestId("reschedule-accept-r1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/reschedule/r1/decision", { action: "accept" }));
});

test("aufgebraucht: der Weg zur Leitung; die Leitung legt mit Grund fest", async () => {
  renderMatch({ ...BASE, schedule_block: { ...BLOCK, remaining: 0, can_request: false,
    request_hint: "Dieses Spiel wurde schon 2-mal verschoben. Das entscheidet die Liga-Leitung – bitte im Matchchat @leitung schreiben.", can_lead_set: true } });
  expect(await screen.findByTestId("schedule-limit")).toHaveTextContent("Keine Verschiebung mehr möglich");
  expect(screen.getByTestId("reschedule-hint")).toHaveTextContent("2-mal");
  fireEvent.change(screen.getByTestId("lead-schedule-form-reason"), { target: { value: "Serverausfall am Abend" } });
  fireEvent.click(screen.getByTestId("lead-schedule-form-submit"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/matches/m1", expect.objectContaining({ schedule_reason: "Serverausfall am Abend" })));
});

test("fester Termin: alter offener Vorschlag lässt sich ablehnen, aber nicht annehmen oder kontern", async () => {
  const theirs = { id: "p-old", status: "pending", kind: "proposal", actor_registration_id: "b", scheduled_at: FUTURE, actor: { display_name: "Falke" } };
  const own = { id: "p-own", status: "pending", kind: "proposal", actor_registration_id: "a", scheduled_at: FUTURE, actor: { display_name: "Kapitaen" } };
  renderMatch({ ...BASE, can_manage_schedule: true, schedule_proposals: [theirs, own] });
  expect(await screen.findByTestId("match-proposal-decline-p-old")).toBeInTheDocument();
  expect(screen.queryByTestId("match-proposal-accept-p-old")).toBeNull();
  expect(screen.queryByText("Gegenvorschlag")).toBeNull();
  expect(screen.getByTestId("match-proposal-withdraw-p-own")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("match-proposal-decline-p-old"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/p-old/decision", expect.objectContaining({ action: "decline" })));
});

test("ohne Block (andere Turniere, Unbeteiligte) bleibt alles wie vorher", async () => {
  renderMatch({ ...BASE, can_propose_schedule: true, can_manage_schedule: true, schedule_block: null });
  expect(await screen.findByTestId("match-proposal-at")).toBeInTheDocument();
  expect(screen.queryByTestId("schedule-change")).toBeNull();
});
