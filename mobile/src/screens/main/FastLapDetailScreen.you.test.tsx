import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react-native";
import { FastLapDetailScreen, isOwnEntry } from "./FastLapDetailScreen";

// Ecken-Klammern (#1316, Web: F1DetailPage): deine Zeit im Leaderboard trägt Winkel, Fläche und „Du“ - nur deine, über die
// Konto-Kennung; Gäste ohne Konto sind nie „du“. Die Daten sind erfunden.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn() },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-noah", username: "noah", is_club_member: false } }) }));
jest.mock("../../live", () => ({ isGuestUser: () => false }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/AddToCalendarButton", () => ({ AddToCalendarButton: () => null }));
jest.mock("../../components/FriendsAtEventCard", () => ({ FriendsAtEventCard: () => null }));

const route = { params: { id: "hotlap" } };
const CHALLENGE = {
  id: "c1", slug: "hotlap", title: "Spielberg Hotlap", status: "active", start_date: "2020-06-01T10:00:00Z", end_date: "2099-06-30T20:00:00Z",
  tracks: [{ id: "tr1", name: "Spielberg" }], participant_count: 3, allow_club_reference_times: false,
};

function serve(entries: Array<Record<string, unknown>>) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/f1/challenges/hotlap") return Promise.resolve({ data: CHALLENGE });
    if (path.endsWith("/leaderboard")) return Promise.resolve({ data: { track: { id: "tr1", name: "Spielberg" }, entries } });
    return Promise.resolve({ data: [] });
  });
}

const LENA = { user_id: "u-lena", display_name: "Lena", rank: 1, time_str: "1:24.587", gap_str: "", attempts: 2 };
const NOAH = { user_id: "u-noah", display_name: "Noah", rank: 2, time_str: "1:24.999", gap_str: "+0.412", attempts: 1 };
const GAST = { user_id: null, participant_id: "guest-1", display_name: "Gast Gerd", is_guest: true, rank: 3, time_str: "1:26.000", gap_str: "+1.413", attempts: 1 };

beforeEach(() => jest.clearAllMocks());

test("deine Zeit: Winkel, Fläche und „Du“ - die anderen Zeilen nicht", async () => {
  serve([LENA, NOAH, GAST]);
  await render(<FastLapDetailScreen route={route} />);
  await waitFor(() => expect(screen.getByTestId("fastlap-entry-you-2")).toBeTruthy());
  const own = screen.getByTestId("fastlap-entry-you-2");
  expect(within(own).getAllByTestId("you-corners")).toHaveLength(1);
  expect(within(own).getAllByTestId("you-fill")).toHaveLength(1);
  expect(within(own).getByTestId("fastlap-you-2")).toHaveTextContent("Du");
  expect(screen.getAllByTestId("you-corners")).toHaveLength(1);
  expect(screen.getAllByTestId(/^fastlap-you-/)).toHaveLength(1);
});

test("ohne eigene Zeit: keine Winkel, kein „Du“", async () => {
  serve([LENA, GAST]);
  await render(<FastLapDetailScreen route={route} />);
  await waitFor(() => expect(screen.getByText("Gast Gerd")).toBeTruthy());
  expect(screen.queryAllByTestId("you-corners")).toHaveLength(0);
  expect(screen.queryAllByTestId(/^fastlap-you-/)).toHaveLength(0);
});

test("„du“ hängt an der Konto-Kennung - ohne Anmeldung nie", () => {
  expect(isOwnEntry({ user_id: "u-noah" }, "u-noah")).toBe(true);
  expect(isOwnEntry({ user_id: null, participant_id: "u-noah" }, "u-noah")).toBe(true);
  expect(isOwnEntry({ user_id: "u-lena" }, "u-noah")).toBe(false);
  expect(isOwnEntry({ user_id: null, participant_id: "guest-1" }, null)).toBe(false);
  expect(isOwnEntry({ user_id: null }, undefined)).toBe(false);
});
