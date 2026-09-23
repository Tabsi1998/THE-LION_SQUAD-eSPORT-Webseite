import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { BlockedUsersCard } from "./BlockedUsersCard";

// Blockierte Benutzer (#414): Liste vom Server, „Freigeben“ ruft dieselbe Route wie die Website.

const mockGet = jest.fn();
const mockDelete = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), delete: (...args: unknown[]) => mockDelete(...args), post: jest.fn() },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockDelete.mockResolvedValue({ data: { ok: true } });
});

test("zeigt die Liste und hebt eine Blockierung auf", async () => {
  mockGet.mockResolvedValue({ data: [
    { id: "b1", blocked_id: "u-2", user: { id: "u-2", username: "max", display_name: "Max M." } },
    { id: "b2", blocked_id: "u-3", user: { id: "u-3", username: "moe" } },
  ] });
  await render(<BlockedUsersCard />);
  await waitFor(() => expect(screen.getByText("Max M.")).toBeTruthy());
  expect(screen.getByText("@moe")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("blocked-user-release-u-2"));
  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("/moderation/blocks/u-2"));
  await waitFor(() => expect(screen.queryByText("Max M.")).toBeNull());
  expect(screen.getByTestId("blocked-user-u-3")).toBeTruthy();
});

test("ohne Einträge ein ruhiger Satz", async () => {
  mockGet.mockResolvedValue({ data: [] });
  await render(<BlockedUsersCard />);
  await waitFor(() => expect(screen.getByTestId("blocked-users-empty")).toBeTruthy());
});
