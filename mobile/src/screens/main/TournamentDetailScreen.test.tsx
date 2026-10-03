import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TournamentDetailScreen } from "./TournamentDetailScreen";

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
jest.mock("../../live", () => ({ isGuestUser: () => false }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => {} }));
jest.mock("../../seasons/anchors", () => ({ useSeasonOverlay: () => null, SeasonAnchor: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/AddToCalendarButton", () => ({ AddToCalendarButton: () => null }));

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
});

test("ohne Event-Anmeldung: der Hinweis und „Zuerst beim Event anmelden“ führen zum Event", async () => {
  answer(TOURNAMENT);
  await render(<TournamentDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("tournament-event-gate")).toBeTruthy());
  expect(screen.getByTestId("tournament-event-gate")).toHaveTextContent("Anmeldung nur mit Event-Anmeldung: Melde dich zuerst beim Event „Vereins-LAN“ an.");
  expect(screen.queryByText("Zum Turnier anmelden")).toBeNull();
  await fireEvent.press(screen.getByTestId("tournament-event-first"));
  expect(navigate).toHaveBeenCalledWith("EventDetail", { id: "vereins-lan" });
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
