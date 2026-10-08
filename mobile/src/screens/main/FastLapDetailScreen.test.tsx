import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { FastLapDetailScreen } from "./FastLapDetailScreen";

// Nach dem Ende (#1221): an einer beendeten Fast-Lap-Challenge gibt es keinen Kalender-Knopf mehr - solange sie läuft
// oder kommt, bleibt er. Die Daten sind erfunden.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn() },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/AddToCalendarButton", () => ({
  AddToCalendarButton: ({ item }: { item?: unknown }) => {
    const { createElement } = jest.requireActual("react");
    const { Text } = jest.requireActual("react-native");
    return item ? createElement(Text, { testID: "add-to-calendar" }, "In meinen Kalender") : null;
  },
}));

const route = { params: { id: "hotlap" } };
const CHALLENGE = {
  id: "c1", slug: "hotlap", title: "Spielberg Hotlap", status: "active", start_date: "2099-06-01T10:00:00Z", end_date: "2099-06-30T20:00:00Z",
  tracks: [{ id: "tr1", name: "Spielberg" }], participant_count: 0, allow_club_reference_times: false,
};

function answer(challenge: Record<string, unknown>) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/f1/challenges/hotlap") return Promise.resolve({ data: challenge });
    if (path.endsWith("/leaderboard")) return Promise.resolve({ data: { entries: [], track: { id: "tr1", name: "Spielberg" } } });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => jest.clearAllMocks());

test("Kalender-Knopf an einer kommenden Challenge, nicht an einer beendeten", async () => {
  answer(CHALLENGE);
  const view = await render(<FastLapDetailScreen route={route} />);
  await waitFor(() => expect(screen.getByTestId("add-to-calendar")).toBeTruthy());
  await view.unmount();

  answer({ ...CHALLENGE, status: "completed", start_date: "2026-05-01T10:00:00Z", end_date: "2026-05-31T20:00:00Z" });
  await render(<FastLapDetailScreen route={route} />);
  await waitFor(() => expect(screen.getByText("Spielberg Hotlap")).toBeTruthy());
  expect(screen.queryByTestId("add-to-calendar")).toBeNull();
});
