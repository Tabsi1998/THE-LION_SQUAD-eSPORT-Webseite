import React from "react";
import { NavigationContext } from "@react-navigation/native";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ProfileScreen } from "./ProfileScreen";
import { PublicProfileScreen, profileTabs } from "./PublicProfileScreen";

// Ein Profil, ein Aufbau (#1149): eigenes und fremdes Profil haben dieselben Reiter in derselben Reihenfolge. Was nur dich
// angeht, steht im Kasten „Nur für dich“ (Rechnungen, Gewinne, was noch fehlt); der Schalter „So sehen dich andere“
// blendet ihn aus und zeigt nur, was die Privatsphäre allen zeigt. Oben rechts das Zahnrad zu den Einstellungen (#1146).

const me = { id: "u-neon", username: "neonfalke", display_name: "NeonFalke", role: "player", is_club_member: true, created_at: "2023-03-01T10:00:00Z" };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: me, refreshMe: jest.fn(async () => undefined) }) }));
jest.mock("../../live", () => ({ isGuestUser: (user: unknown) => !user }));
const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(async () => ({ data: {} })), delete: jest.fn(async () => ({ data: {} })) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (value: string) => value,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/FriendButton", () => ({ FriendButton: () => null }));
jest.mock("../../components/ReportSheet", () => ({ ReportSheet: () => null }));
jest.mock("../../components/Honours", () => {
  const { Text } = jest.requireActual("react-native");
  return { HonoursCard: () => <Text>Meine Ehrungen mit Schalter</Text>, HonourList: () => null };
});
jest.mock("../../seasons/SeasonFinds", () => ({ PublicSeasonFindsCard: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, appNamesSeason: () => true }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
jest.mock("../../achievements/profile/AchievementsTab", () => {
  const { Text } = jest.requireActual("react-native");
  return { AchievementsTab: () => <Text>Eigene Erfolge mit Fortschritt</Text> };
});
jest.mock("../../achievements/profile/PublicAchievements", () => {
  const { Text } = jest.requireActual("react-native");
  return { PinnedAwardsCard: () => null, PublicAchievementsTab: () => <Text>Öffentliche Erfolge</Text> };
});
jest.mock("../../navigation/rootNavigation", () => ({ openTab: jest.fn(), openDetail: jest.fn(), navigateToUrl: () => false, targetFromUrl: () => null }));

const publicNeon = {
  ...me, bio: "Rocket League und FC 26.", city: "Innsbruck", privacy_public_profile: true,
  stats: { points: 3420, wins: 7, top3: 12, tournaments: 31, fast_laps: 9 },
  achievement_level: { level: 12, title: "Level 12", points: 3420 },
  teams: [{ id: "t-public", name: "Lions Public" }], references: { items: [], stats: {} }, awards: [], honours: [], relationship: { status: "self" },
};
const asOthers = { ...publicNeon, city: null, relationship: undefined };

function answer(path: string, config?: { params?: Record<string, string> }) {
  const responses: Record<string, unknown> = {
    "/achievements/me": { groups: [], awards: [] },
    "/users/me/profile-completeness": { score: 80, missing: ["banner_url", "main_platform"] },
    "/mobile/profile/references": { items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } },
    "/me/awards": { awards: [] },
    "/prizes/me": [{ id: "p1", status: "ready" }],
    "/moderation/me/standing": null,
    "/account/invoices": { summary: { open_count: 1, open_total: 12, overdue_count: 0 }, currency: "EUR" },
    "/teams/my": [{ id: "t-1", name: "Lions Rocket", tag: "LR" }],
    "/streams/live": [],
    "/achievements/user/u-neon": { awards: [], groups: [], pinned: [] },
    "/achievements/user/u-kiwi": { awards: [], groups: [], pinned: [] },
  };
  if (path === "/users/public/neonfalke") return mockPublic.private ? Promise.reject(new Error("404")) : Promise.resolve({ data: config?.params?.view_as === "public" ? asOthers : publicNeon });
  if (path === "/users/public/kiwikomet") return mockPublic.kiwiHidden ? Promise.reject(new Error("404")) : Promise.resolve({ data: { id: "u-kiwi", username: "kiwikomet", display_name: "KiwiKomet", is_club_member: false, stats: { wins: 2 }, can_message: true, relationship: { status: "none" }, teams: [], awards: [], references: { items: [] } } });
  return path in responses ? Promise.resolve({ data: responses[path] }) : Promise.reject(new Error(`unerwartet ${path}`));
}
const mockPublic = { private: false, kiwiHidden: false };

const navigate = jest.fn();
const navigation = { navigate, isFocused: () => true, addListener: () => () => {}, getParent: () => undefined, getState: () => undefined } as never;

function renderOwn() {
  return render(
    <NavigationContext.Provider value={navigation}>
      <ProfileScreen />
    </NavigationContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPublic.private = false;
  mockPublic.kiwiHidden = false;
  mockGet.mockImplementation(answer);
});

test("dieselben Reiter in derselben Reihenfolge - Mitglieder zusätzlich Ehrungen", () => {
  expect(profileTabs(false).map((tab) => tab.label)).toEqual(["Übersicht", "Erfolge", "Auszeichnungen", "Referenzen", "Teams"]);
  expect(profileTabs(true).map((tab) => tab.label)).toEqual(["Übersicht", "Erfolge", "Auszeichnungen", "Referenzen", "Teams", "Ehrungen"]);
});

test("eigenes Profil: Kopf mit Zahlen, Kasten „Nur für dich“, Zahnrad - Tipps führen zu Rechnungen, Gewinnen, Bearbeiten", async () => {
  await renderOwn();
  await waitFor(() => expect(screen.getByTestId("profile-private-box")).toBeTruthy());
  expect(screen.getByTestId("profile-header-title")).toHaveTextContent("Profil");
  expect(within(screen.getByTestId("profile-stats")).getByText("3.420")).toBeTruthy();
  expect(screen.getByText("LVL 12")).toBeTruthy();
  await waitFor(() => expect(screen.getByText(/^1 offen · € 12,00/)).toBeTruthy());
  expect(screen.getByText("1 bereit zum Abholen")).toBeTruthy();
  expect(screen.getByText("Profil zu 80 % fertig")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("profile-private-invoices"));
  expect(navigate).toHaveBeenLastCalledWith("MyInvoices", undefined);
  await fireEvent.press(screen.getByTestId("profile-private-prizes"));
  expect(navigate).toHaveBeenLastCalledWith("MyPrizes", undefined);
  await fireEvent.press(screen.getByTestId("profile-private-completeness"));
  expect(navigate).toHaveBeenLastCalledWith("ProfileEdit", undefined);
  await fireEvent.press(screen.getByTestId("profile-settings"));
  expect(navigate).toHaveBeenLastCalledWith("Settings", undefined);
});

test("eigenes Profil: eigene Teams (auch nicht öffentliche), eigene Erfolge, Ehrungen mit Schalter", async () => {
  await renderOwn();
  await waitFor(() => expect(screen.getByTestId("profile-private-box")).toBeTruthy());
  await fireEvent.press(screen.getByText("Teams"));
  await waitFor(() => expect(screen.getByText("Lions Rocket")).toBeTruthy());
  expect(screen.queryByText("Lions Public")).toBeNull();
  await fireEvent.press(screen.getByText("Erfolge"));
  expect(screen.getByText("Eigene Erfolge mit Fortschritt")).toBeTruthy();
  await fireEvent.press(screen.getByText("Ehrungen"));
  expect(screen.getByText("Meine Ehrungen mit Schalter")).toBeTruthy();
});

test("„So sehen dich andere“: Kasten weg, nur was die Privatsphäre allen zeigt", async () => {
  await renderOwn();
  await waitFor(() => expect(screen.getByTestId("profile-private-box")).toBeTruthy());
  await fireEvent(screen.getByTestId("profile-as-others-switch"), "valueChange", true);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/users/public/neonfalke", { params: { view_as: "public" } }));
  await waitFor(() => expect(screen.queryByTestId("profile-private-box")).toBeNull());
  await fireEvent.press(screen.getByText("Erfolge"));
  expect(screen.getByText("Öffentliche Erfolge")).toBeTruthy();
  await fireEvent.press(screen.getByText("Teams"));
  expect(screen.getByText("Lions Public")).toBeTruthy();
});

test("privates Profil: du siehst deins mit dem Kasten; „So sehen dich andere“ sagt, dass es privat ist", async () => {
  mockPublic.private = true;
  await renderOwn();
  await waitFor(() => expect(screen.getByTestId("profile-private-box")).toBeTruthy());
  expect(screen.getByText("NeonFalke")).toBeTruthy();
  await fireEvent(screen.getByTestId("profile-as-others-switch"), "valueChange", true);
  await waitFor(() => expect(screen.getByText("Dein Profil ist privat")).toBeTruthy());
  expect(screen.queryByTestId("profile-private-box")).toBeNull();
});

test("fremdes Profil: dieselben Reiter, kein Kasten, kein Schalter - Nachricht schreiben öffnet den Chat", async () => {
  await render(<PublicProfileScreen navigation={navigation} route={{ key: "p", name: "PublicProfile", params: { username: "kiwikomet" } } as never} />);
  await waitFor(() => expect(screen.getByText("KiwiKomet")).toBeTruthy());
  for (const label of ["Übersicht", "Erfolge", "Auszeichnungen", "Referenzen", "Teams"]) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText("Ehrungen")).toBeNull();
  expect(screen.queryByTestId("profile-private-box")).toBeNull();
  expect(screen.queryByTestId("profile-as-others")).toBeNull();
  await fireEvent.press(screen.getByText("Nachricht"));
  expect(navigate).toHaveBeenLastCalledWith("DirectThread", { userId: "u-kiwi", title: "KiwiKomet" });
});

test("fremdes privates Profil: nur der Hinweis", async () => {
  mockPublic.kiwiHidden = true;
  await render(<PublicProfileScreen navigation={navigation} route={{ key: "p", name: "PublicProfile", params: { username: "kiwikomet" } } as never} />);
  await waitFor(() => expect(screen.getByText("Profil nicht sichtbar")).toBeTruthy());
});
