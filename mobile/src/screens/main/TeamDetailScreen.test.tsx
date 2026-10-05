import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TeamDetailScreen } from "./TeamDetailScreen";

// Gast zuerst (#918): Team-Chat und Beitritt brauchen ein Konto - als Gast statt eines Fehlers gleich der Weg dorthin.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
// Ein festes Objekt je Fall: der Screen lädt neu, wenn sich `user` ändert.
const GUEST = jest.requireActual("../../live").liveGuestUser;
const MEMBER = { id: "u-1", username: "paula" };
const mockAuth: { user: Record<string, unknown> } = { user: GUEST };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: (...args: unknown[]) => mockOpenSignIn(...args) }));
jest.mock("../../seasons/anchors", () => ({ useSeasonOverlay: () => null, SeasonPerch: () => null, SeasonAnchor: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigate = jest.fn();
const navigation = { navigate, setOptions: jest.fn() } as never;
const route = { key: "team", name: "TeamDetail", params: { id: "t1" } } as never;
const TEAM = { id: "t1", name: "Lions", tag: "TLS", members: [], member_ids: [], is_member: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith("/squads") ? [] : TEAM }));
});

test("als Gast: „Anmelden oder registrieren“ statt Team-Chat und Beitritt", async () => {
  mockAuth.user = GUEST;
  await render(<TeamDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("team-sign-in")).toBeTruthy());
  expect(screen.getByText("Team-Chat und Beitritt gibt es mit einem Konto.")).toBeTruthy();
  expect(screen.queryByText("Team-Chat öffnen")).toBeNull();
  expect(screen.queryByText("Team beitreten")).toBeNull();
  await fireEvent.press(screen.getByTestId("team-sign-in"));
  expect(mockOpenSignIn).toHaveBeenCalledTimes(1);
});

test("mit Konto wie bisher: Team-Chat öffnen und beitreten mit Code", async () => {
  mockAuth.user = MEMBER;
  await render(<TeamDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Team-Chat öffnen")).toBeTruthy());
  expect(screen.getByText("Team beitreten")).toBeTruthy();
  expect(screen.queryByTestId("team-sign-in")).toBeNull();
});
