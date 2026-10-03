import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { announceAchievementUnlocked, announceLevelChanged } from "../lib/achievements";
import { ceremonyQueue } from "../achievements/ceremony/queue";
import { AchievementCatchUpOverlay } from "./AchievementCatchUpOverlay";

// Freischalt-Moment (#218, Zeremonie E13 #623): beim Start wird nachgeholt; ist die App offen, erscheint die
// Zeremonie, sobald die Benachrichtigung den neuen Erfolg meldet. Level-Aufstiege wie im Web über den gemerkten
// Stand je Konto.

const mockGet = jest.fn();
const mockStore: Record<string, string> = {};

jest.mock("../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => false, navigate: jest.fn() } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const groups = (earnedAt: string | null, extra: Array<Record<string, unknown>> = []) => ({ data: { groups: [{ code: "g", name: "Turniersiege", category: "tournament", tiers: [
  { code: "t1", name: "Erster Sieg", level: 1, material: "wood", rank: 1, points: 50, earned: Boolean(earnedAt), earned_at: earnedAt || undefined },
  ...extra,
] }] } });

let level = { level: 4, title: "Rookie", prestige: 0 };
function route(achievements: unknown) {
  mockGet.mockImplementation(async (url: string) => (url === "/users/me/level" ? { data: level } : achievements));
}

beforeEach(() => {
  mockGet.mockReset();
  Object.keys(mockStore).forEach((key) => delete mockStore[key]);
  level = { level: 4, title: "Rookie", prestige: 0 };
  // Noch ist nichts gerendert - leeren ohne act.
  ceremonyQueue.clear();
});

test("ist die App offen, erscheint die Zeremonie, sobald ein Erfolg gemeldet wird", async () => {
  mockStore["tls_ach_seen_user-1"] = "2026-09-21T10:00:00.000Z";
  route(groups(null));
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/achievements/me"));
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();

  route(groups(new Date(Date.now() + 1000).toISOString(), [{ code: "t0", name: "Alt", level: 1, earned: true, earned_at: "2026-01-01T00:00:00.000Z" }]));
  await act(async () => { announceAchievementUnlocked(); });
  await waitFor(() => expect(screen.getByTestId("achievement-unlock-overlay")).toBeTruthy());
  expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Neues Achievement!");
  expect(screen.getByTestId("ceremony-motion-lift")).toBeTruthy();
  expect(screen.getByText("Erster Sieg")).toBeTruthy();
});

test("beim Start wird nachgeholt, was seit dem letzten Blick dazukam – der Marker rückt erst nach dem Zeigen vor", async () => {
  mockStore["tls_ach_seen_user-1"] = "2026-09-01T00:00:00.000Z";
  route(groups("2026-09-20T18:00:00.000Z", [{ code: "t0", name: "Alt", level: 1, earned: true, earned_at: "2026-01-01T00:00:00.000Z" }]));
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Während du weg warst!"));
  expect(screen.getByTestId("ceremony-sub")).toHaveTextContent("Nachgeholte Erfolge");
  expect(mockStore["tls_ach_seen_user-1"]).toBe("2026-09-01T00:00:00.000Z");
  await act(async () => { ceremonyQueue.advance(); });
  await waitFor(() => expect(mockStore["tls_ach_seen_user-1"]).not.toBe("2026-09-01T00:00:00.000Z"));
});

test("beim allerersten Start gibt es keinen Rückblick über alles je Erreichte", async () => {
  route(groups("2026-01-01T00:00:00.000Z"));
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(mockStore["tls_ach_seen_user-1"]).toBeTruthy());
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
});

test("Prestige im Profil wird sofort gefeiert, seine Rücknahme nicht", async () => {
  mockStore["tls_ach_seen_user-1"] = "2026-09-21T10:00:00.000Z";
  mockStore["tls_level_seen_user-1"] = JSON.stringify({ level: 60, title: "Legende", prestige: 0 });
  level = { level: 60, title: "Legende", prestige: 0 };
  route(groups(null));
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/users/me/level"));
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();

  level = { level: 1, title: "Rookie", prestige: 1 };
  await act(async () => { announceLevelChanged(); });
  await waitFor(() => expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Prestige"));
  expect(screen.queryByTestId("ceremony-title-banner")).toBeNull();
  await act(async () => { ceremonyQueue.advance(); });
  await waitFor(() => expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull());

  level = { level: 60, title: "Legende", prestige: 0 };
  await act(async () => { announceLevelChanged(); });
  await waitFor(() => expect(JSON.parse(mockStore["tls_level_seen_user-1"])).toEqual({ level: 60, title: "Legende", prestige: 0 }));
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
});

test("ein neues Level seit dem letzten Blick wird gefeiert, ein gleiches nicht", async () => {
  mockStore["tls_ach_seen_user-1"] = "2026-09-21T10:00:00.000Z";
  mockStore["tls_level_seen_user-1"] = JSON.stringify({ level: 4, title: "Rookie", prestige: 0 });
  level = { level: 5, title: "Kämpfer", prestige: 0 };
  route(groups(null));
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Level 5 erreicht"));
  expect(screen.getByTestId("ceremony-title-banner")).toHaveTextContent("Neuer Titel: Kämpfer");
  expect(JSON.parse(mockStore["tls_level_seen_user-1"])).toEqual({ level: 5, title: "Kämpfer", prestige: 0 });
});
