import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { DirectMessagesScreen } from "./DirectMessagesScreen";

// Gast zuerst (#918): Nachrichten gibt es mit Konto - als Gast keine Anfrage und kein „Not authenticated“, sondern
// der Weg zum Konto. Mit Konto wie bisher die Unterhaltungen.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (value: string) => value,
}));
const GUEST = jest.requireActual("../../live").liveGuestUser;
const mockAuth: { user: Record<string, unknown> } = { user: GUEST };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: (...args: unknown[]) => mockOpenSignIn(...args) }));
jest.mock("../../seasons/anchors", () => ({ useSeasonOverlay: () => null, SeasonPerch: () => null, SeasonAnchor: ({ children }: { children?: React.ReactNode }) => children ?? null }));

const navigation = { navigate: jest.fn(), addListener: jest.fn(() => () => {}) } as never;
const route = { key: "dm", name: "DirectMessages" } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: [] });
});

test("als Gast: der Weg zum Konto statt einer Fehlermeldung - und keine Anfrage", async () => {
  mockAuth.user = GUEST;
  await render(<DirectMessagesScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("messages-sign-in")).toBeTruthy());
  expect(mockGet).not.toHaveBeenCalled();
  expect(screen.queryByText("Keine Nachrichten")).toBeNull();
  await fireEvent.press(screen.getByTestId("messages-sign-in-button"));
  expect(mockOpenSignIn).toHaveBeenCalledTimes(1);
});

test("mit Konto: die Unterhaltungen wie bisher", async () => {
  mockAuth.user = { id: "u-1", username: "paula" };
  await render(<DirectMessagesScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/messages/conversations"));
  expect(screen.queryByTestId("messages-sign-in")).toBeNull();
  await waitFor(() => expect(screen.getByText("Keine Nachrichten")).toBeTruthy());
});
