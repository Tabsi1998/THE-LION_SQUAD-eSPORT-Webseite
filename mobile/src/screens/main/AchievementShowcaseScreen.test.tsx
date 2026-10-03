import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";

// Der Schaukasten in der App (E13, #623) - wie /achievements im Web (#619): Erfolg der Woche, Zahlen, zuletzt
// freigeschaltet, Kategorien, Bestenliste mit Podest und Schaltern, Katalog mit Seltenheit; als Gast der öffentliche
// Katalog, angemeldet der eigene Fortschritt.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) }, errorMessage: (_e: unknown, f: string) => f }));
const mockAuth: { user: Record<string, unknown> | null } = { user: null };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../live", () => ({ isGuestUser: (user: Record<string, unknown> | null) => !user || user.user_type === "guest" }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => {} }));
const mockRootNavigate = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, navigate: (...args: unknown[]) => mockRootNavigate(...args) } }));
jest.mock("@expo/vector-icons", () => {
  const { Text } = require("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
});

const { AchievementShowcaseScreen } = require("./AchievementShowcaseScreen");

const tier = (code: string, rank: number, name: string, extra: Record<string, unknown> = {}) => ({
  code, rank, level: 1, name, points: 5 * rank, material: "wood", material_name: "Holz", earned: false, current: 0, target: 10, percent: 0, ...extra,
});
const GROUPS = [
  { code: "matches_played", name: "Spielmacher", category: "match", icon: "swords", accent_color: "#29B6E8", tiers: [tier("matches_played_1", 1, "Spielmacher I"), tier("matches_played_2", 2, "Spielmacher II", { material: "iron", material_name: "Eisen" })] },
  { code: "lap_hunter", name: "Rundenjäger", category: "fastlap", icon: "flag", accent_color: "#A855F7", tiers: [tier("lap_hunter_1", 1, "Rundenjäger I")] },
];
const USER_BEN = { id: "u2", username: "ben", display_name: "Ben" };
const OVERVIEW = {
  categories: [
    { key: "match", label: "Spielen", icon: "swords", accent: "#29B6E8", groups: 1, tiers: 2, holders: 3, community_percent: 12.5 },
    { key: "fastlap", label: "Fast Lap", icon: "flag", accent: "#A855F7", groups: 1, tiers: 1, holders: 1, community_percent: 2 },
    { key: "hidden", label: "Geheim", icon: "ghost", accent: "#A855F7", hidden: true, groups: 13, tiers: 13, holders: 1, community_percent: 1 },
  ],
  rarity: { base: 8, groups: { matches_played: { holders: 3, top: { percent: 12.5, material_name: "Eisen" } }, lap_hunter: { holders: 1, top: { percent: 2, material_name: "Holz" } } }, tiers: { matches_played_1: 37.5, matches_played_2: 12.5, lap_hunter_1: 2 } },
  hidden: { total: 13, earned: 0 },
  week: { week_key: "2026-W40", award: { award_id: "a1", tier_code: "matches_played_2", name: "Spielmacher II", group_name: "Spielmacher", material: "iron", material_name: "Eisen", rank: 2, level: 1, percent: 25, holders: 1, earned_at: "2026-09-26T18:00:00+00:00", user: USER_BEN } },
  recent: [{ award_id: "a1", tier_code: "matches_played_2", name: "Spielmacher II", material: "iron", material_name: "Eisen", user: USER_BEN }],
};
const BOARD = [
  { user_id: "u2", username: "ben", display_name: "Ben", count: 2, points: 15, level: 4, prestige: 1, rank: 1 },
  { user_id: "u1", username: "anna", display_name: "Anna", count: 1, points: 5, level: 1, prestige: 0, rank: 2 },
  { user_id: "u3", username: "cem", display_name: "Cem", count: 1, points: 5, level: 1, prestige: 0, rank: 3 },
  { user_id: "u4", username: "dora", display_name: "Dora", count: 1, points: 2, level: 1, prestige: 0, rank: 4 },
];

function mockApi(me: unknown = null) {
  mockGet.mockReset();
  mockGet.mockImplementation(async (url: string) => {
    if (url === "/achievements/groups") return { data: GROUPS };
    if (url === "/achievements/overview") return { data: OVERVIEW };
    if (url === "/achievements/leaderboard") return { data: BOARD };
    if (url === "/achievements/me") return { data: me };
    return { data: [] };
  });
}

const navigate = jest.fn();
const navigation = { navigate } as never;
const route = { key: "showcase", name: "AchievementShowcase" } as never;

function boardCalls() {
  return mockGet.mock.calls.filter(([url]) => url === "/achievements/leaderboard").map(([, options]) => (options as { params?: Record<string, unknown> })?.params || {});
}

beforeEach(() => {
  mockAuth.user = null;
  navigate.mockReset();
  mockRootNavigate.mockReset();
});

test("als Gast: Erfolg der Woche, Zahlen, Laufband, Kategorien und der öffentliche Katalog", async () => {
  mockApi();
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<AchievementShowcaseScreen navigation={navigation} route={route} />);
  const week = await screen.findByTestId("achievement-of-week");
  expect(within(week).getByTestId("week-award-name")).toHaveTextContent("Spielmacher II");
  expect(within(week).getByTestId("week-award-rarity")).toHaveTextContent("Nur 25 % haben das · eine Person");
  expect(week).toHaveTextContent("Kalenderwoche 40 · montags 08:00 neu", { exact: false });
  await fireEvent.press(within(week).getByTestId("week-award-user"));
  expect(navigate).toHaveBeenCalledWith("PublicProfile", { username: "ben" });
  await fireEvent.press(within(week).getByTestId("week-award-card"));
  expect(openUrl).toHaveBeenCalledWith(expect.stringMatching(/\/achievements\/a\/a1$/));

  expect(screen.getByTestId("achievements-stats")).toHaveTextContent("Anmelden und mitmachen", { exact: false });
  expect(screen.queryByTestId("my-achievement-summary")).toBeNull();
  expect(screen.getByTestId("unlock-0")).toHaveTextContent("Ben hat Spielmacher II (Eisen)");
  expect(screen.getByTestId("category-tile-match")).toHaveTextContent("12,5 %", { exact: false });
  expect(screen.getByTestId("category-hidden-count")).toHaveTextContent("0 von 13 gefunden");
  expect(mockGet).not.toHaveBeenCalledWith("/achievements/me");

  // Katalog nach Kategorie, mit Seltenheit an der Gruppe und je Stufe.
  // Der Katalog baut sich schrittweise auf.
  expect(await screen.findByTestId("catalog-category-match")).toBeTruthy();
  expect(screen.getByTestId("achievement-rarity-matches_played")).toHaveTextContent("12,5 % haben Eisen · 3 mit mindestens einer Stufe");
  await fireEvent.press(screen.getByTestId("achievement-group-matches_played"));
  expect(screen.getByTestId("achievement-tier-rarity-matches_played_1")).toHaveTextContent("37,5 % haben das");
  openUrl.mockRestore();
});

test("Bestenliste: Podest und Liste, Level statt Punkte, Kategorie und Zeitraum nur für Punkte", async () => {
  mockApi();
  await render(<AchievementShowcaseScreen navigation={navigation} route={route} />);
  const first = await screen.findByTestId("podium-1");
  expect(first).toHaveTextContent("Ben", { exact: false });
  expect(first).toHaveTextContent("★", { exact: false });
  expect(screen.getByTestId("leaderboard-row-4")).toHaveTextContent("Dora", { exact: false });
  expect(screen.getByTestId("leaderboard-row-4")).toHaveTextContent("1 Erfolg", { exact: false });
  expect(screen.getByTestId("podium-1")).toHaveTextContent("2 Erfolge", { exact: false });
  await fireEvent.press(screen.getByTestId("leaderboard-row-4"));
  expect(navigate).toHaveBeenCalledWith("PublicProfile", { username: "dora" });
  expect(boardCalls()[0]).toEqual({ limit: 24, by: "points" });

  const controls = screen.getByTestId("leaderboard-controls");
  await fireEvent.press(within(controls).getByText("Fast Lap"));
  await waitFor(() => expect(boardCalls().at(-1)).toEqual({ limit: 24, by: "points", category: "fastlap" }));
  await fireEvent.press(within(controls).getByText("Dieser Monat"));
  await waitFor(() => expect(boardCalls().at(-1)).toEqual({ limit: 24, by: "points", category: "fastlap", period: "month" }));
  await fireEvent.press(within(controls).getByText("Level"));
  await waitFor(() => expect(boardCalls().at(-1)).toEqual({ limit: 24, by: "level" }));
  expect(within(screen.getByTestId("leaderboard-controls")).queryByText("Dieser Monat")).toBeNull();
  expect(await screen.findByTestId("podium-1")).toHaveTextContent("Level 4", { exact: false });
});

test("Katalog: die seltensten zuerst und über die Kategorie-Kachel gefiltert", async () => {
  mockApi();
  await render(<AchievementShowcaseScreen navigation={navigation} route={route} />);
  await screen.findByTestId("achievement-group-matches_played");
  await fireEvent.press(screen.getByText("Nach Seltenheit"));
  const order = screen.getAllByTestId(/^achievement-group-/).map((node) => node.props.testID);
  expect(order).toEqual(["achievement-group-lap_hunter", "achievement-group-matches_played"]);
  expect(screen.queryByTestId("catalog-category-match")).toBeNull();

  await fireEvent.press(screen.getByTestId("category-tile-fastlap"));
  expect(screen.queryByTestId("achievement-group-matches_played")).toBeNull();
  expect(screen.queryByTestId("achievement-hidden-summary")).toBeNull();
  await fireEvent.press(screen.getByTestId("catalog-filter-clear"));
  expect(screen.getByTestId("achievement-group-matches_played")).toBeTruthy();
});

test("angemeldet: der eigene Fortschritt im Katalog, die eigenen Punkte und der Weg zu den eigenen Erfolgen", async () => {
  mockAuth.user = { id: "u1", username: "anna" };
  const own = GROUPS.map((group) => (group.code === "matches_played"
    ? { ...group, tiers: group.tiers.map((t, i) => (i === 0 ? { ...t, earned: true, current: 10, percent: 100 } : t)) }
    : group));
  mockApi({ groups: own, hidden: { total: 13, earned: 2 } });
  await render(<AchievementShowcaseScreen navigation={navigation} route={route} />);
  expect(await screen.findByTestId("my-points")).toHaveTextContent("5", { exact: false });
  expect(screen.getByTestId("my-achievement-summary")).toHaveTextContent("Du hast bereits 1 Achievements freigeschaltet", { exact: false });
  expect(screen.getByTestId("category-hidden-count")).toHaveTextContent("2 von 13 gefunden");
  expect((await screen.findByTestId("achievement-badge-matches_played")).props.accessibilityLabel).toBe("Holz I");
  await fireEvent.press(screen.getByTestId("my-achievement-summary"));
  expect(mockRootNavigate).toHaveBeenCalledWith("Profile", { tab: "achievements" });
});
