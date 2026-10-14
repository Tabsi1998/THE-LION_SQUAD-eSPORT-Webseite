import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TournamentDetailScreen } from "./TournamentDetailScreen";
import { expectLateAnswerDiscarded } from "./lateAnswer.testkit";

// Turnier nur mit Event-Anmeldung (#875): wer einzeln antritt und nicht beim Event angemeldet ist, bekommt statt
// „Zum Turnier anmelden“ den Weg zum Event; angemeldet geht es normal weiter. Teams sehen, wie viele beim Event sein
// müssen - geprüft wird das Team beim Anmelden auf dem Server.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(), delete: jest.fn() },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
// Ein festes Objekt: der Screen lädt neu, wenn sich `user` ändert - ein neues Objekt je Render wäre eine Endlosschleife.
const mockAuth = { user: { id: "u-1", username: "paula" } };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockGuest = { value: false };
jest.mock("../../live", () => ({ isGuestUser: () => mockGuest.value }));
const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: (...args: unknown[]) => mockOpenSignIn(...args) }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => {} }));
jest.mock("../../seasons/anchors", () => ({ useSeasonOverlay: () => null, SeasonAnchor: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
// Der Kalender-Knopf als Marke: da, wenn die Seite ihm einen Termin gibt (#1221).
jest.mock("../../components/AddToCalendarButton", () => ({
  AddToCalendarButton: ({ item, items }: { item?: unknown; items?: unknown[] | null }) => {
    const { createElement } = jest.requireActual("react");
    const { Text } = jest.requireActual("react-native");
    return item || items?.length ? createElement(Text, { testID: "add-to-calendar" }, "In meinen Kalender") : null;
  },
}));

const navigate = jest.fn();
const navigation = { navigate, setOptions: jest.fn(), getParent: () => ({ navigate }) } as never;
const route = { key: "t", name: "TournamentDetail", params: { id: "cup" } } as never;

const GATE = { required: true, event: { id: "e1", name: "Vereins-LAN", slug: "vereins-lan" }, registered: false, team_need: 1 };
const TOURNAMENT = {
  id: "t1", slug: "cup", title: "LAN-Cup", status: "registration_open", registration_enabled: true, team_mode: "solo", team_size: 1,
  max_participants: 16, participant_count: 0, public_phase: { state: "registration_open", label: "Anmeldung offen" }, event_gate: GATE,
};

function answer(tournament: Record<string, unknown>) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: tournament });
    if (path.endsWith("/bracket")) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGuest.value = false;
});

// Gast zuerst (#918): statt „bitte einloggen“ gleich der Weg zum Konto - danach geht es zurück zu diesem Turnier.
test("als Gast: „Anmelden oder registrieren“ statt der Anmeldung, kein Turnier-Chat", async () => {
  mockGuest.value = true;
  answer({ ...TOURNAMENT, event_gate: null, show_chat: true });
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-sign-in")).toBeTruthy());
  expect(screen.getByText("Teilnehmen kannst du mit einem Konto.")).toBeTruthy();
  expect(screen.queryByText("Zum Turnier anmelden")).toBeNull();
  expect(screen.queryByText("Turnier-Chat öffnen")).toBeNull();
  await fireEvent.press(screen.getByTestId("tournament-sign-in"));
  expect(mockOpenSignIn).toHaveBeenCalledTimes(1);
});

test("ohne Event-Anmeldung: der Hinweis und „Zuerst beim Event anmelden“ führen zum Event", async () => {
  answer(TOURNAMENT);
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-event-gate")).toBeTruthy());
  expect(screen.getByTestId("tournament-event-gate")).toHaveTextContent("Anmeldung nur mit Event-Anmeldung: Melde dich zuerst beim Event „Vereins-LAN“ an.");
  expect(screen.queryByText("Zum Turnier anmelden")).toBeNull();
  await fireEvent.press(screen.getByTestId("tournament-event-first"));
  // Mit returnTournament geht es nach der Event-Anmeldung hierher zurück (#1184).
  expect(navigate).toHaveBeenCalledWith("EventDetail", { id: "vereins-lan", returnTournament: "cup" });
});

test("beim Event angemeldet: die Turnieranmeldung ist frei", async () => {
  answer({ ...TOURNAMENT, event_gate: { ...GATE, registered: true } });
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Zum Turnier anmelden")).toBeTruthy());
  expect(screen.getByTestId("tournament-event-gate")).toHaveTextContent("Du bist beim Event „Vereins-LAN“ angemeldet – die Turnieranmeldung ist frei.");
  expect(screen.queryByTestId("tournament-event-first")).toBeNull();
});

test("Teams sehen, wie viele beim Event sein müssen; ohne Schalter kein Hinweis", async () => {
  answer({ ...TOURNAMENT, team_mode: "team", team_size: 5, event_gate: { ...GATE, team_need: 5 } });
  const view = await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-event-gate")).toBeTruthy());
  expect(screen.getByTestId("tournament-event-gate")).toHaveTextContent("Anmeldung nur mit Event-Anmeldung: Mindestens 5 Spieler deines Teams müssen beim Event „Vereins-LAN“ angemeldet sein.");
  await view.unmount();
  answer({ ...TOURNAMENT, event_gate: null });
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Zum Turnier anmelden")).toBeTruthy());
  expect(screen.queryByTestId("tournament-event-gate")).toBeNull();
});

// Nach dem Ende (#1221): ein beendetes Turnier hat keinen Kalender-Knopf mehr.
test("Kalender-Knopf nur, solange das Turnier nicht vorbei ist", async () => {
  answer({ ...TOURNAMENT, event_gate: null, start_date: "2099-11-14T13:00:00Z" });
  const view = await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("add-to-calendar")).toBeTruthy());
  await view.unmount();
  answer({ ...TOURNAMENT, event_gate: null, start_date: "2026-05-23T19:00:00Z", status: "results_published", public_phase: { state: "results_published", label: "Ergebnisse veröffentlicht" } });
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("LAN-Cup")).toBeTruthy());
  expect(screen.queryByTestId("add-to-calendar")).toBeNull();
});

// Vor-Ort-Turniere (#1135): die Turnierleitung checkt ein - kein „Jetzt einchecken“, sondern der Hinweis wie im Web.
test("vor Ort: kein Check-in-Knopf, sondern „Check-in vor Ort bei der Turnierleitung“ mit Zeitfenster; online der Knopf", async () => {
  const checkIn = {
    ...TOURNAMENT, event_gate: null, status: "check_in", public_phase: { state: "check_in", label: "Check-in offen" },
    check_in_from: "2026-11-14T17:00:00Z", check_in_until: "2026-11-14T17:45:00Z",
    my_registration: { id: "reg-1", status: "approved", user_id: "u-1" },
  };
  answer({ ...checkIn, event_mode: "local" });
  const view = await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-checkin-local")).toBeTruthy());
  expect(screen.getByTestId("tournament-checkin-local")).toHaveTextContent(
    "Check-in vor Ort bei der Turnierleitung · ab 14.11.2026, 18:00 bis 14.11.2026, 18:45",
  );
  expect(screen.queryByText("Jetzt einchecken")).toBeNull();
  await view.unmount();

  answer({ ...checkIn, event_mode: "online" });
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-checkin")).toBeTruthy());
  expect(screen.queryByTestId("tournament-checkin-local")).toBeNull();
});

// Kleinigkeiten (#1139): keine Kennzahl „Engine“, „Vom Turnier abmelden“ als leiser Link.
test("keine „Engine“-Kennzahl; abmelden ist ein leiser Link", async () => {
  answer({ ...TOURNAMENT, event_gate: null, my_registration: { id: "reg-1", status: "approved", user_id: "u-1" } });
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-unregister")).toBeTruthy());
  expect(screen.queryByText("Engine")).toBeNull();
  expect(screen.getByTestId("tournament-unregister")).toHaveTextContent("Vom Turnier abmelden");
  expect(screen.queryByText("Abmeldung ist für diese Anmeldung aktuell nicht möglich.")).toBeNull();
});

// Klartext statt Kürzel (#1140): ein leerer Platz zeigt „Sieger aus A“ statt „W:A:1“, ein Setzplatz vor dem Start
// „noch offen“ statt der nackten Zahl, und statt „Zeit noch offen“ steht „geplant ca. 15:20 · 30 Minuten“.
test("leere Plätze im Klartext, geplante Zeit mit Dauer", async () => {
  jest.useFakeTimers({ now: new Date("2026-10-10T08:00:00Z"), doNotFake: ["nextTick", "setImmediate"] });
  try {
    const matches = [
      { id: "m-a", match_key: "A", stage_id: "s1", status: "completed", slots: [{ slot: 1 }, { slot: 2 }], settings: { match_size: 2, qualifiers_per_match: 1 } },
      { id: "m-f", match_key: "F", stage_id: "s1", status: "scheduled", scheduled_at: "2026-10-10T13:20:00Z", duration_minutes: 30,
        slots: [{ slot: 1, status: "pending", source: { raw: "W:A:1" } }, { slot: 2, status: "preview", source: { type: "seed", seed: 7, raw: "7" } }] },
    ];
    mockGet.mockImplementation((path: string) => {
      if (path === "/tournaments/cup") return Promise.resolve({ data: { ...TOURNAMENT, event_gate: null, status: "live" } });
      if (path.endsWith("/bracket")) return Promise.resolve({ data: { matches_v2: matches, registrations: [] } });
      return Promise.resolve({ data: [] });
    });
    await render(<TournamentDetailScreen navigation={navigation} route={route} />);
    await waitFor(() => expect(screen.getByTestId("match-card-m-f")).toBeTruthy());
    const card = screen.getByTestId("match-card-m-f");
    expect(card).toHaveTextContent(/Sieger aus A/);
    expect(card).toHaveTextContent(/noch offen/);
    expect(card).toHaveTextContent(/geplant ca\. 15:20 · 30 Minuten/);
    expect(card).not.toHaveTextContent(/W:A:1/);
    expect(screen.queryByText("7")).toBeNull();
    expect(screen.queryByText("Zeit noch offen")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

// Zurück vom Event (#1184): nach Event-Anmeldung und „Spielst du auch mit?“ lädt die Turnierseite frisch - der Weg zum
// Event wird zur Turnieranmeldung (bzw. zum eigenen Stand).
test("zurück vom Event: die Seite lädt neu und zeigt die freie Anmeldung", async () => {
  const handlers: Record<string, () => void> = {};
  const listening = { ...(navigation as object), addListener: (name: string, handler: () => void) => { handlers[name] = handler; return () => undefined; } } as never;
  answer(TOURNAMENT);
  await render(<TournamentDetailScreen navigation={listening} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-event-first")).toBeTruthy());
  handlers.focus();
  expect(mockGet.mock.calls.filter(([path]) => path === "/tournaments/cup")).toHaveLength(1);
  answer({ ...TOURNAMENT, event_gate: { ...GATE, registered: true } });
  handlers.blur();
  handlers.focus();
  await waitFor(() => expect(screen.queryByTestId("tournament-event-first")).toBeNull());
  expect(screen.getByText("Zum Turnier anmelden")).toBeTruthy();
});

test("eine verspätete Antwort für das vorige Turnier wird verworfen (#1000)", async () => {
  answer({ ...TOURNAMENT, event_gate: null });
  await expectLateAnswerDiscarded({
    mockGet,
    renderFor: (id) => <TournamentDetailScreen navigation={navigation} route={{ key: "t", name: "TournamentDetail", params: { id } } as never} />,
    newId: "cup",
    oldPrefix: "/tournaments/alt",
    oldAnswer: (path) => (path === "/tournaments/alt" ? { ...TOURNAMENT, event_gate: null, id: "t0", slug: "alt", title: "Altes Turnier" } : path.endsWith("/bracket") ? {} : []),
    newText: "LAN-Cup",
    oldText: "Altes Turnier",
  });
});

test("Bracket oder Tabelle kommen nicht: das Turnier steht, die Seite sagt es (#1000)", async () => {
  mockGet.mockImplementation((path: string) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...TOURNAMENT, event_gate: null } });
    if (path.endsWith("/bracket") || path.endsWith("/standings")) return Promise.reject(Object.assign(new Error("Network Error"), { isAxiosError: true }));
    return Promise.resolve({ data: [] });
  });
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-partial-load")).toBeTruthy());
  expect(screen.getAllByText("LAN-Cup").length).toBeGreaterThan(0);
});

test("eigene Teams kommen nicht: das Turnier steht, die Seite sagt es statt still „keine Teams“ (#1512)", async () => {
  mockGet.mockImplementation((path: string) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...TOURNAMENT, event_gate: null } });
    if (path === "/teams/my") return Promise.reject(Object.assign(new Error("Network Error"), { isAxiosError: true }));
    if (path.endsWith("/bracket")) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: [] });
  });
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-partial-load")).toBeTruthy());
  expect(screen.getAllByText("LAN-Cup").length).toBeGreaterThan(0);
});
