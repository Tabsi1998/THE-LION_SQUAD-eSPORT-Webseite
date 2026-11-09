import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Mehrere Termine auf einmal (#2325): bis zu drei Termine mit einer Notiz und einem Knopf, Fehler am betroffenen Termin, die
// Gegenseite nimmt mit einem Klick einen an, lehnt alle ab oder schlägt bis zu drei andere vor. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatApiError: (value) => (typeof value === "string" ? value : value?.message),
  resolveMediaUrl: (value) => value,
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "c1", username: "kapitaen" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/MentionTextarea", () => ({ MentionTextarea: () => null }));
vi.mock("@/components/tls/CommendButton", () => ({ CommendButton: () => null }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useChats", () => ({ useChatRead: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useLeagueTrail", () => ({ useLeagueTrail: () => null }));

const MatchPage = (await import("./MatchPage")).default;

const BASE = {
  tournament: { id: "t1", slug: "cup", title: "Probe-Cup" },
  match: { id: "m1", match_key: "A1", status: "ready", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  participants: [{ slot: 1, registration_id: "a", display_name: "Loewen" }, { slot: 2, registration_id: "b", display_name: "Falken" }],
  matchday_label: "Runde 1", collection: "matches_v2", can_act: true, can_propose_schedule: true, can_manage_schedule: true,
  can_player_report_result: false, can_submit_result: false, can_staff_submit_result: false, can_dispute: false,
  event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a",
  schedule_proposals: [],
};
const THEIRS = ["2027-03-10T19:00:00+00:00", "2027-03-11T18:30:00+00:00", "2027-03-12T20:00:00+00:00"].map((scheduled_at, index) => ({
  id: `f${index + 1}`, status: "pending", kind: "proposal", group_id: "g-falken", actor_registration_id: "b", actor_user_id: "f1",
  scheduled_at, note: "Abends geht immer", created_at: "2027-03-01T10:00:00+00:00", actor: { display_name: "Falke" },
}));
const local = (value) => new Date(value).toISOString();

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
  apiMock.post.mockResolvedValue({ data: { ok: true } });
});

test("drei Termine mit einer Notiz und einem Knopf - entfernen geht, mehr als drei nicht", async () => {
  renderMatch(BASE);
  fireEvent.change(await screen.findByTestId("match-proposal-at"), { target: { value: "2027-03-10T20:00" } });
  fireEvent.click(screen.getByTestId("match-proposal-at-weiter"));
  fireEvent.change(screen.getByTestId("match-proposal-at-2"), { target: { value: "2027-03-11T19:00" } });
  fireEvent.click(screen.getByTestId("match-proposal-at-weiter"));
  fireEvent.change(screen.getByTestId("match-proposal-at-3"), { target: { value: "2027-03-12T21:00" } });
  expect(screen.queryByTestId("match-proposal-at-weiter")).toBeNull();
  expect(screen.getByLabelText("Termin 2: Datum und Uhrzeit")).toHaveValue("2027-03-11T19:00");
  expect(screen.getByTestId("match-proposal-send")).toHaveTextContent("3 Termine vorschlagen");
  fireEvent.change(screen.getByPlaceholderText("z.B. nach 20:00 Uhr möglich"), { target: { value: "Bitte Bescheid geben" } });
  fireEvent.click(screen.getByTestId("match-proposal-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/group", {
    scheduled_ats: [local("2027-03-10T20:00"), local("2027-03-11T19:00"), local("2027-03-12T21:00")], note: "Bitte Bescheid geben",
  }));
  expect(apiMock.post).toHaveBeenCalledTimes(1);
});

test("ein Termin weniger: das X entfernt genau diesen", async () => {
  renderMatch(BASE);
  fireEvent.change(await screen.findByTestId("match-proposal-at"), { target: { value: "2027-03-10T20:00" } });
  fireEvent.click(screen.getByTestId("match-proposal-at-weiter"));
  fireEvent.change(screen.getByTestId("match-proposal-at-2"), { target: { value: "2027-03-11T19:00" } });
  fireEvent.click(screen.getByLabelText("Termin 1 entfernen"));
  expect(screen.getByTestId("match-proposal-at")).toHaveValue("2027-03-11T19:00");
  expect(screen.queryByTestId("match-proposal-at-2")).toBeNull();
  expect(screen.getByTestId("match-proposal-send")).toHaveTextContent(/^Vorschlagen$/);
});

test("doppelter Termin: Fehler am zweiten, nichts geht an den Server", async () => {
  renderMatch(BASE);
  fireEvent.change(await screen.findByTestId("match-proposal-at"), { target: { value: "2027-03-10T20:00" } });
  fireEvent.click(screen.getByTestId("match-proposal-at-weiter"));
  fireEvent.change(screen.getByTestId("match-proposal-at-2"), { target: { value: "2027-03-10T20:00" } });
  fireEvent.click(screen.getByTestId("match-proposal-send"));
  expect(await screen.findByTestId("match-proposal-at-fehler-2")).toHaveTextContent("schon eingetragen");
  expect(screen.queryByTestId("match-proposal-at-fehler-1")).toBeNull();
  expect(screen.getByTestId("match-proposal-at-2")).toHaveAttribute("aria-invalid", "true");
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Liga: ein Termin außerhalb der Spielwoche bekommt einen Hinweis und geht trotzdem raus", async () => {
  renderMatch({ ...BASE, schedule_block: { fixed: false, window: { start: "2027-03-08T23:00:00Z", end: "2027-03-15T23:00:00Z" }, rules: {}, requests: [], history: [] } });
  fireEvent.change(await screen.findByTestId("match-proposal-at"), { target: { value: "2027-03-10T20:00" } });
  fireEvent.click(screen.getByTestId("match-proposal-at-weiter"));
  fireEvent.change(screen.getByTestId("match-proposal-at-2"), { target: { value: "2027-03-20T20:00" } });
  expect(screen.getByTestId("match-proposal-at-hinweis-2")).toHaveTextContent("außerhalb der Spielwoche");
  expect(screen.queryByTestId("match-proposal-at-hinweis-1")).toBeNull();
  expect(screen.getByTestId("match-proposal-at-2")).toHaveAttribute("aria-invalid", "false");
  fireEvent.click(screen.getByTestId("match-proposal-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/group", expect.objectContaining({
    scheduled_ats: [local("2027-03-10T20:00"), local("2027-03-20T20:00")],
  })));
});

test("der Server nennt die Stelle: Sperrzeit am dritten Termin", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: {
    code: "schedule_times_invalid", message: "Termin 3: In dieser Zeit wird nicht gespielt (Osterpause, 12.3.2027).",
    errors: [{ index: 2, detail: "In dieser Zeit wird nicht gespielt (Osterpause, 12.3.2027)." }],
  } } } });
  renderMatch(BASE);
  fireEvent.change(await screen.findByTestId("match-proposal-at"), { target: { value: "2027-03-10T20:00" } });
  fireEvent.click(screen.getByTestId("match-proposal-at-weiter"));
  fireEvent.change(screen.getByTestId("match-proposal-at-2"), { target: { value: "2027-03-11T20:00" } });
  fireEvent.click(screen.getByTestId("match-proposal-at-weiter"));
  fireEvent.change(screen.getByTestId("match-proposal-at-3"), { target: { value: "2027-03-12T20:00" } });
  fireEvent.click(screen.getByTestId("match-proposal-send"));
  expect(await screen.findByTestId("match-proposal-at-fehler-3")).toHaveTextContent("Osterpause");
  expect(screen.getByTestId("match-proposal-at-3")).toHaveValue("2027-03-12T20:00");
});

test("Gegenseite: drei Termine als Liste - ein Klick nimmt einen an", async () => {
  renderMatch({ ...BASE, match: { ...BASE.match, schedule_status: "proposed" }, schedule_proposals: THEIRS });
  const card = await screen.findByTestId("match-proposal-group-g-falken");
  expect(card).toHaveTextContent("3 Termine zur Auswahl");
  expect(within(card).getByTestId("match-proposal-group-status-g-falken")).toHaveTextContent("Falke · einen annehmen");
  expect(card).toHaveTextContent("Abends geht immer");
  expect(within(card).getAllByRole("listitem")).toHaveLength(3);
  expect(within(card).getAllByText("Annehmen")).toHaveLength(3);
  fireEvent.click(within(card).getByTestId("match-proposal-accept-f2"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/f2/decision", { action: "accept", note: null }));
});

test("Gegenseite: alle ablehnen und Gegenvorschlag mit zwei Terminen gehen an die ganze Gruppe", async () => {
  renderMatch({ ...BASE, match: { ...BASE.match, schedule_status: "proposed" }, schedule_proposals: THEIRS });
  const card = await screen.findByTestId("match-proposal-group-g-falken");
  fireEvent.click(within(card).getByTestId("match-proposal-group-decline-g-falken"));
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(within(card).getByLabelText("Grund für die Ablehnung"), { target: { value: "Diese Woche keine Zeit" } });
  fireEvent.click(within(card).getByTestId("match-decline-send-gruppe-g-falken"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/f1/group-decision", { action: "decline", note: "Diese Woche keine Zeit" }));
  await waitFor(() => expect(within(card).queryByTestId("match-decline-gruppe-g-falken")).toBeNull());

  fireEvent.click(within(card).getByTestId("match-counter-open-gruppe-g-falken"));
  const counter = within(card).getByTestId("match-counter-gruppe-g-falken");
  expect(within(counter).getByTestId("match-counter-at-gruppe-g-falken")).toHaveValue("");
  fireEvent.change(within(counter).getByTestId("match-counter-at-gruppe-g-falken"), { target: { value: "2027-03-13T20:00" } });
  fireEvent.click(within(counter).getByTestId("match-counter-at-gruppe-g-falken-weiter"));
  fireEvent.change(within(counter).getByTestId("match-counter-at-gruppe-g-falken-2"), { target: { value: "2027-03-14T19:00" } });
  fireEvent.change(within(counter).getByLabelText("Antwort oder Grund"), { target: { value: "Wochenende besser" } });
  expect(within(counter).getByTestId("match-counter-send-gruppe-g-falken")).toHaveTextContent("2 Termine als Gegenvorschlag senden");
  fireEvent.click(within(counter).getByTestId("match-counter-send-gruppe-g-falken"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/f1/group-decision", {
    action: "counter", scheduled_ats: [local("2027-03-13T20:00"), local("2027-03-14T19:00")], note: "Wochenende besser",
  }));
});

test("einzelner Vorschlag: Ablehnen fragt nach einem Grund, ohne Grund geht es auch", async () => {
  const single = { ...THEIRS[0], group_id: undefined };
  renderMatch({ ...BASE, match: { ...BASE.match, schedule_status: "proposed" }, schedule_proposals: [single] });
  fireEvent.click(await screen.findByTestId("match-proposal-decline-f1"));
  fireEvent.change(screen.getByLabelText("Grund für die Ablehnung"), { target: { value: "  Sonntag geht nicht  " } });
  fireEvent.click(screen.getByTestId("match-decline-send-f1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/f1/decision", { action: "decline", note: "Sonntag geht nicht" }));

  apiMock.post.mockClear();
  fireEvent.click(screen.getByTestId("match-proposal-decline-f1"));
  fireEvent.click(screen.getByTestId("match-decline-send-f1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/f1/decision", { action: "decline", note: null }));
});

test("eigene Gruppe: wartet auf die Gegenseite, Zurückziehen nimmt alle zurück", async () => {
  const own = THEIRS.map((row) => ({ ...row, group_id: "g-own", actor_registration_id: "a", actor_user_id: "c1", actor: { display_name: "Kapitaen" } }));
  renderMatch({ ...BASE, match: { ...BASE.match, schedule_status: "proposed" }, schedule_proposals: own });
  const card = await screen.findByTestId("match-proposal-group-g-own");
  expect(card).toHaveTextContent("3 Termine vorgeschlagen");
  expect(within(card).getByTestId("match-proposal-group-status-g-own")).toHaveTextContent("wartet auf die Gegenseite");
  expect(within(card).queryByText("Annehmen")).toBeNull();
  expect(within(card).queryByText("Alle ablehnen")).toBeNull();
  expect(screen.getByTestId("match-schedule-headline")).toHaveTextContent("Wartet auf Gegenseite");
  fireEvent.click(within(card).getByTestId("match-proposal-group-withdraw-g-own"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/schedule-proposals/f1/group-decision", { action: "withdraw", note: null }));
});

test("fester Liga-Termin: eine alte Gruppe lässt sich nur noch ablehnen", async () => {
  renderMatch({ ...BASE, can_propose_schedule: false, schedule_proposals: THEIRS,
    schedule_block: { fixed: true, rules: {}, requests: [], history: [], window: null } });
  const card = await screen.findByTestId("match-proposal-group-g-falken");
  expect(within(card).queryByText("Annehmen")).toBeNull();
  expect(within(card).queryByText("Gegenvorschlag")).toBeNull();
  expect(within(card).getByTestId("match-proposal-group-decline-g-falken")).toBeInTheDocument();
});

test("nach der Annahme: erledigte Termine stehen einzeln mit Zustand", async () => {
  const done = [{ ...THEIRS[1], status: "accepted" }, { ...THEIRS[0], status: "declined", decision_rule: "agreed_elsewhere" }];
  renderMatch({ ...BASE, schedule_proposals: done });
  expect(await screen.findByTestId("match-proposal-status-f2")).toHaveTextContent("angenommen");
  expect(screen.getByTestId("match-proposal-status-f1")).toHaveTextContent("erledigt – anderer Termin steht");
  expect(screen.queryByTestId("match-proposal-group-g-falken")).toBeNull();
});
