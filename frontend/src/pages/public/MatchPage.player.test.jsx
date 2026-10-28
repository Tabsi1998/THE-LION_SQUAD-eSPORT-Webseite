import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Matchseite für Spieler (#2124): Läufe nach Platz, Termin nur in der Zukunft, Entscheidung zur eigenen Meldung,
// kein „Login zum Ergebnis melden“, wo Spieler nichts melden, und die Teilnehmer nur einmal. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
const authState = { user: null };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/tls/MentionTextarea", () => ({ MentionTextarea: () => <textarea /> }));
vi.mock("@/components/tls/CommendButton", () => ({ CommendButton: () => null }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useChats", () => ({ useChatRead: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MatchPage = (await import("./MatchPage")).default;

const BASE = {
  tournament: { id: "t1", slug: "kart-cup", title: "Kart Cup" },
  schedule_proposals: [], can_act: false, can_report_score: false, can_player_report_result: false, can_submit_result: false,
  can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", collection: "matches_v2", matchday: 1,
  matchday_label: "Runde 1",
};
const FFA = [
  { slot: 1, status: "filled", registration_id: "r1", display_name: "NeonFalke" },
  { slot: 2, status: "filled", registration_id: "r2", display_name: "LunaByte" },
  { slot: 3, status: "filled", registration_id: "r3", display_name: "KiwiKomet" },
];
const DUEL = FFA.slice(0, 2);

function renderMatch(page) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/matches/m1/page") return { data: page };
    if (url === "/matches/m1/chat") return { data: [] };
    return { data: [] };
  });
  return render(
    <MemoryRouter initialEntries={["/matches/m1"]}>
      <Routes><Route path="/matches/:id" element={<MatchPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-20T10:00:00Z"));
  authState.user = null;
  apiMock.post.mockReset();
});
afterEach(() => vi.useRealTimers());

test("Lauf nach Reihenfolge gemeldet: Platz groß, in Platzreihenfolge statt „-“ in Startreihenfolge (TP1)", async () => {
  renderMatch({
    ...BASE,
    match: { id: "m1", match_key: "H1", match_type: "ffa", status: "completed",
      slots: FFA.map(({ slot, registration_id }) => ({ slot, registration_id })),
      results: [{ registration_id: "r1", rank: 3 }, { registration_id: "r2", rank: 1 }, { registration_id: "r3", rank: 2 }] },
    participants: FFA,
  });
  const sides = await screen.findAllByTestId("match-heat-side");
  expect(sides.map((side) => within(side).getByTestId("match-heat-place").textContent)).toEqual(["Platz 1", "Platz 2", "Platz 3"]);
  expect(sides.map((side) => side.textContent)).toEqual([
    expect.stringContaining("LunaByte"), expect.stringContaining("KiwiKomet"), expect.stringContaining("NeonFalke"),
  ]);
  expect(within(sides[0]).getByTestId("match-heat-detail")).toHaveTextContent("Startplatz 2");
});

test("Lauf mit Punkten und Zeiten: Punkte bzw. Zeit stehen klein unter dem Platz, wer fehlte, steht hinten", async () => {
  renderMatch({
    ...BASE,
    match: { id: "m1", match_key: "H2", match_type: "ffa", status: "completed", settings: { calculation: "time" },
      slots: FFA.map(({ slot, registration_id }) => ({ slot, registration_id })),
      results: [{ registration_id: "r1", rank: 3, forfeit: true }, { registration_id: "r2", rank: 2, time_ms: 93450 }, { registration_id: "r3", rank: 1, time_ms: 92010 }] },
    participants: FFA,
  });
  const sides = await screen.findAllByTestId("match-heat-side");
  expect(within(sides[0]).getByTestId("match-heat-detail")).toHaveTextContent("1:32,010");
  expect(within(sides[2]).getByTestId("match-heat-detail")).toHaveTextContent("Nicht erschienen");
});

test("Lauf vor dem Ergebnis: noch kein Platz - Startreihenfolge mit „–“", async () => {
  renderMatch({
    ...BASE,
    match: { id: "m1", match_key: "H3", match_type: "ffa", status: "ready", slots: FFA.map(({ slot, registration_id }) => ({ slot, registration_id })) },
    participants: FFA,
  });
  const places = await screen.findAllByTestId("match-heat-place");
  expect(places.map((node) => node.textContent)).toEqual(["–", "–", "–"]);
});

test("Terminvorschlag: das Feld beginnt bei jetzt + 5 Minuten, ein Termin von gestern geht nicht an den Server (TP8)", async () => {
  authState.user = { id: "u1" };
  renderMatch({
    ...BASE, can_act: true, can_propose_schedule: true, can_manage_schedule: true, acting_registration_id: "r1",
    match: { id: "m1", match_key: "A", status: "ready", slots: DUEL.map(({ slot, registration_id }) => ({ slot, registration_id })) },
    participants: DUEL,
  });
  const input = await screen.findByTestId("match-proposal-at");
  expect(input).toHaveAttribute("min");
  expect(new Date(input.getAttribute("min")).getTime()).toBeGreaterThanOrEqual(new Date("2026-05-20T10:04:00Z").getTime());
  fireEvent.change(input, { target: { value: "2026-05-19T18:00" } });
  // Der Browser hält das Absenden schon am `min` an; die Seite prüft trotzdem (das Feld kann veraltet sein).
  fireEvent.submit(input.closest("form"));
  expect(await screen.findByText(/liegt in der Vergangenheit/)).toBeInTheDocument();
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Teilnehmer stehen nur einmal - in den Ergebnis-Kacheln, kein eigener Kasten „Teilnehmer“ mit „Slot“ (TP7)", async () => {
  renderMatch({
    ...BASE,
    match: { id: "m1", match_key: "A", status: "ready", slots: DUEL.map(({ slot, registration_id }) => ({ slot, registration_id })) },
    participants: DUEL,
  });
  expect(await screen.findByTestId("match-result-sides")).toHaveTextContent("NeonFalke");
  expect(screen.getAllByText("NeonFalke")).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: "Teilnehmer" })).toBeNull();
  expect(screen.queryByText(/^Slot/)).toBeNull();
});

describe("„Login zum Ergebnis melden“ nur, wo Spieler selbst melden (TP6)", () => {
  const open = { id: "m1", match_key: "A", status: "ready", slots: DUEL.map(({ slot, registration_id }) => ({ slot, registration_id })) };

  test("online mit Spieler-Meldung: Gäste sehen den Weg zum Login", async () => {
    renderMatch({ ...BASE, match: open, participants: DUEL });
    expect(await screen.findByTestId("match-login-to-report")).toHaveAttribute("href", "/login?next=/matches/m1");
  });

  test.each([
    ["Nur Turnierleitung", { result_entry_mode: "staff_only" }],
    ["vor Ort", { event_mode: "local", result_entry_mode: "hybrid" }],
  ])("%s: kein Login-Knopf, sondern wer das Ergebnis einträgt", async (_label, mode) => {
    renderMatch({ ...BASE, ...mode, match: open, participants: DUEL });
    await screen.findByTestId("match-result-card");
    expect(screen.queryByTestId("match-login-to-report")).toBeNull();
  });
});
describe("Deine Meldung – Entscheidung (TP4)", () => {
  const decided = (disputes, extra = {}) => ({
    ...BASE, can_act: true, acting_registration_id: "r1",
    match: { id: "m1", match_key: "A", status: "completed", winner_id: "r2",
      slots: DUEL.map(({ slot, registration_id }) => ({ slot, registration_id })),
      results: [{ registration_id: "r1", rank: 2, score: 1 }, { registration_id: "r2", rank: 1, score: 2 }], disputes, ...extra },
    participants: DUEL,
  });

  test("„Ergebnis bleibt“ mit Begründung der Turnierleitung", async () => {
    authState.user = { id: "u1" };
    renderMatch(decided([{ user_id: "u1", reason: "Lag im zweiten Spiel", category: "technical", at: "2026-05-19T18:00:00Z",
      resolved_at: "2026-05-19T18:20:00Z", decision: "keep", decision_note: "Lag war auf beiden Seiten" }]));
    const box = await screen.findByTestId("match-own-dispute");
    expect(box).toHaveTextContent("Deine Meldung · Technik");
    expect(box).toHaveTextContent("„Lag im zweiten Spiel“");
    expect(within(box).getByTestId("match-own-dispute-decision")).toHaveTextContent("Entschieden: Das Ergebnis bleibt.");
    expect(within(box).getByTestId("match-own-dispute-note")).toHaveTextContent("Begründung: Lag war auf beiden Seiten");
  });

  test("offen: „Die Turnierleitung prüft“; korrigiert: „Das Ergebnis wurde korrigiert“ - die neueste zuerst", async () => {
    authState.user = { id: "u1" };
    renderMatch(decided([
      { user_id: "u1", reason: "Stand vertauscht", category: "wrong_result", at: "2026-05-19T18:00:00Z", resolved_at: "2026-05-19T18:10:00Z", decision: "change" },
      { user_id: "u1", reason: "Noch einmal falsch", category: "wrong_result", at: "2026-05-19T19:00:00Z" },
    ]));
    const boxes = await screen.findAllByTestId("match-own-dispute");
    expect(boxes.map((box) => box.getAttribute("data-state"))).toEqual(["open", "change"]);
    expect(boxes[0]).toHaveTextContent("Die Turnierleitung prüft deine Meldung.");
    expect(boxes[1]).toHaveTextContent("Entschieden: Das Ergebnis wurde korrigiert.");
  });

  test("Meldungen anderer (nur Zeitpunkt) und Gäste: kein Kasten", async () => {
    authState.user = { id: "u9" };
    renderMatch(decided([{ at: "2026-05-19T18:00:00Z" }]));
    await screen.findByTestId("match-result-card");
    expect(screen.queryByTestId("match-own-disputes")).toBeNull();
  });
});