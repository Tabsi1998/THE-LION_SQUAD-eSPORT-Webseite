import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { ceremonyQueue } from "../achievements/ceremony/queue";
import { resetCeremonySeen } from "../achievements/ceremony/seen";
import { AchievementCatchUpOverlay } from "./AchievementCatchUpOverlay";

// Zeremonie einmal je Konto (#2450): die App richtet sich nach dem Stand am Server. Was dort gesehen ist, kommt nicht
// noch einmal - auch wenn der Merker im Gerät es für neu hält; der Altbestand des Geräts geht einmalig an den Server,
// nach dem Deploy gibt es keine Flut alter Erfolge, und jedes Schließen meldet „gesehen“.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockStore: Record<string, string> = {};
jest.mock("../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) } }));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => false, navigate: jest.fn() } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const tier = (code: string, earnedAt: string) => ({ code, name: `Stufe ${code}`, level: 1, material: "wood", rank: 1, points: 50, earned: true, earned_at: earnedAt });
const groups = (...tiers: ReturnType<typeof tier>[]) => ({ groups: [{ code: "g", name: "Turniersiege", category: "tournament", tiers }] });
const serverState = (extra: Record<string, unknown> = {}) => ({ since: "2026-11-16T08:00:00+00:00", unseen: [], level: { level: 4, title: "Jungtier", prestige: 0 }, recount_seen: [], ...extra });

function answer({ me = groups(), state = serverState(), level = { level: 4, title: "Jungtier", prestige: 0 } }: { me?: unknown; state?: unknown; level?: unknown } = {}) {
  mockGet.mockImplementation(async (url: string) => {
    if (url === "/achievements/me") return { data: me };
    if (url === "/achievements/me/ceremony") return { data: state };
    if (url === "/users/me/level") return { data: level };
    throw new Error(`unerwartet: ${url}`);
  });
  mockPost.mockImplementation(async (url: string) => (url === "/achievements/me/ceremony/import" ? { data: state } : { data: { ok: true } }));
}

function seenBodies() {
  return mockPost.mock.calls.filter(([url]) => url === "/achievements/me/ceremony/seen").map(([, body]) => body);
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  Object.keys(mockStore).forEach((key) => delete mockStore[key]);
  resetCeremonySeen();
  ceremonyQueue.clear();
});

test("holt nach, was am Server offen ist; Schließen meldet „gesehen“", async () => {
  mockStore["tls_ceremony_imported_user-1"] = "x";
  answer({ me: groups(tier("t1", "2026-11-10T10:00:00.000Z"), tier("t2", "2026-11-12T10:00:00.000Z")), state: serverState({ unseen: ["t2"] }) });
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Während du weg warst!"));
  expect(screen.getByText("Stufe t2")).toBeTruthy();
  expect(screen.queryByText("Stufe t1")).toBeNull();
  expect(seenBodies()).toEqual([]);
  await act(async () => { ceremonyQueue.advance(); });
  expect(seenBodies()).toEqual([{ codes: ["t2"] }]);
});

test("am Server bereits gesehen: keine Zeremonie - auch wenn der Merker im Gerät sie für neu hält", async () => {
  mockStore["tls_ceremony_imported_user-1"] = "x";
  mockStore["tls_ach_seen_user-1"] = "2026-09-01T00:00:00.000Z";
  answer({ me: groups(tier("t1", "2026-11-12T10:00:00.000Z")), state: serverState({ unseen: [] }) });
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/users/me/level"));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
});

test("Altbestand: der Merker des Geräts geht einmal an den Server, danach zählt nur noch er - keine Flut", async () => {
  mockStore["tls_ach_seen_user-1"] = "2026-09-01T00:00:00.000Z";
  mockStore["tls_level_seen_user-1"] = JSON.stringify({ level: 3, title: "", prestige: 0 });
  const old = Array.from({ length: 20 }, (_, n) => tier(`t${n}`, `2026-10-${String(n + 1).padStart(2, "0")}T10:00:00.000Z`));
  answer({ me: groups(...old), state: serverState({ unseen: [] }) });
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/users/me/level"));
  expect(mockPost).toHaveBeenCalledWith("/achievements/me/ceremony/import", { seen_until: "2026-09-01T00:00:00.000Z", level: { level: 3, title: "", prestige: 0 } });
  expect(mockPost.mock.calls.filter(([url]) => url === "/achievements/me/ceremony/import")).toHaveLength(1);
  expect(mockStore["tls_ceremony_imported_user-1"]).toBeTruthy();
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
});

test("Level-Aufstieg: Vergleich mit dem Server, Schließen meldet den Stand", async () => {
  mockStore["tls_ceremony_imported_user-1"] = "x";
  answer({ state: serverState({ level: { level: 4, title: "Jungtier", prestige: 0 } }), level: { level: 5, title: "Fährte", prestige: 0 } });
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Level 5 erreicht"));
  await act(async () => { ceremonyQueue.advance(); });
  expect(seenBodies()).toEqual([{ level: { level: 5, title: "Fährte", prestige: 0 } }]);
});

test("Level-Aufstieg, der auf einem anderen Gerät schon gesehen wurde, kommt nicht", async () => {
  mockStore["tls_ceremony_imported_user-1"] = "x";
  mockStore["tls_level_seen_user-1"] = JSON.stringify({ level: 2, title: "", prestige: 0 });
  answer({ state: serverState({ level: { level: 6, title: "", prestige: 0 } }), level: { level: 6, title: "", prestige: 0 } });
  await render(<AchievementCatchUpOverlay />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/users/me/level"));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
});
