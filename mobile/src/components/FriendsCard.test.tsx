import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FriendsCard } from "./FriendsCard";

// Freunde (#240): offene Anfragen oben mit Annehmen/Ablehnen, gesendete zurückziehbar, Liste
// mit Zähler; Antippen öffnet das Profil.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args), delete: (...args: unknown[]) => mockDelete(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  resolveMediaUrl: (url?: string | null) => url || "",
}));
jest.mock("../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => {} }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const LIST = {
  friends: [{ id: "f1", status: "accepted", user: { id: "u2", username: "max", display_name: "Max M." } }],
  incoming: [{ id: "f2", status: "pending", incoming: true, user: { id: "u3", username: "anna", display_name: "Anna" } }],
  outgoing: [{ id: "f3", status: "pending", outgoing: true, user: { id: "u4", username: "ben" } }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: LIST });
  mockPost.mockResolvedValue({ data: { ok: true } });
  mockDelete.mockResolvedValue({ data: { ok: true } });
});

test("Anfragen oben, Zähler, Annehmen ruft den Server und lädt neu", async () => {
  const onOpenProfile = jest.fn();
  await render(<FriendsCard onOpenProfile={onOpenProfile} />);
  await waitFor(() => expect(screen.getByText("Freunde (1)")).toBeTruthy());
  expect(screen.getByText("1 offen")).toBeTruthy();
  expect(screen.getByTestId("friend-incoming-f2")).toBeTruthy();
  expect(screen.getByTestId("friend-outgoing-f3")).toBeTruthy();
  expect(screen.getByText("Anfrage gesendet")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("friend-accept-f2"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/friends/f2/accept"));
  expect(mockGet).toHaveBeenCalledTimes(2);

  await fireEvent.press(screen.getByTestId("friend-cancel-f3"));
  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("/friends/u4"));

  await fireEvent.press(screen.getByText("Max M."));
  expect(onOpenProfile).toHaveBeenCalledWith("max");
});

test("ohne Freunde steht der Hinweis, wie es geht", async () => {
  mockGet.mockResolvedValue({ data: { friends: [], incoming: [], outgoing: [] } });
  await render(<FriendsCard onOpenProfile={jest.fn()} />);
  await waitFor(() => expect(screen.getByText(/Noch keine Freunde/)).toBeTruthy());
  expect(screen.getByText("Freunde (0)")).toBeTruthy();
});
