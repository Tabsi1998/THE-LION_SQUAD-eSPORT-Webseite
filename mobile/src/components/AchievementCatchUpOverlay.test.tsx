import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { announceAchievementUnlocked } from "../lib/achievements";
import { AchievementCatchUpOverlay } from "./AchievementCatchUpOverlay";

// Freischalt-Moment (#218): beim Start wird nachgeholt; ist die App offen, erscheint der Moment,
// sobald die Benachrichtigung den neuen Erfolg meldet – nicht erst beim nächsten Start.

const mockGet = jest.fn();
const mockStore: Record<string, string> = {};

jest.mock("../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}), notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 0, Medium: 1, Heavy: 2 }, NotificationFeedbackType: { Success: 0 },
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const groups = (earnedAt: string | null) => ({ data: { groups: [{ code: "g", name: "Turniersiege", tiers: [
  { code: "t1", name: "Erster Sieg", level: 1, points: 50, earned: Boolean(earnedAt), earned_at: earnedAt || undefined },
] }] } });

beforeEach(() => {
  mockGet.mockReset();
  Object.keys(mockStore).forEach((key) => delete mockStore[key]);
});

test("ist die App offen, erscheint der Moment, sobald ein Erfolg gemeldet wird", async () => {
  mockStore["tls_ach_seen_user-1"] = "2026-09-21T10:00:00.000Z";
  mockGet.mockResolvedValueOnce(groups(null));
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();

  mockGet.mockResolvedValueOnce(groups(new Date(Date.now() + 1000).toISOString()));
  announceAchievementUnlocked();
  await waitFor(() => expect(screen.getByTestId("achievement-unlock-overlay")).toBeTruthy());
  expect(screen.getByText("Erfolg freigeschaltet!")).toBeTruthy();
  expect(screen.getByText("Erster Sieg")).toBeTruthy();
});

test("beim Start wird nachgeholt, was seit dem letzten Blick dazukam", async () => {
  mockStore["tls_ach_seen_user-1"] = "2026-09-01T00:00:00.000Z";
  mockGet.mockResolvedValueOnce(groups("2026-09-20T18:00:00.000Z"));
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(screen.getByText("Während du weg warst!")).toBeTruthy());
});

test("beim allerersten Start gibt es keinen Rückblick über alles je Erreichte", async () => {
  mockGet.mockResolvedValueOnce(groups("2026-01-01T00:00:00.000Z"));
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(Object.keys(mockStore)).toHaveLength(1));
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
});
