import React from "react";
import { Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppNavigator } from "./AppNavigator";
import { currentTab, navigateToNotification, navigateToUrl, navigationRef, openSignIn, openTab } from "./rootNavigation";
import type { LooseNavigation } from "./types";

const nav = navigationRef as unknown as LooseNavigation;

// Die Tabs (#1143) und wohin Seiten sich legen (#1144) - mit dem echten, verschachtelten Navigator der App, nur die Screens
// selbst sind Platzhalter. Fünf Tabs für alle; was man öffnet, legt sich über den Tab, in dem man ist, und „Zurück“ führt
// dorthin; Benachrichtigungen öffnen über dem offenen Tab; ein Tipp auf den aktiven Tab bringt zur Übersicht.

jest.mock("./screenRegistry", () => {
  const { Text: RNText } = jest.requireActual("react-native");
  const page = (name: string) => function Page() {
    return <RNText>{`Seite ${name}`}</RNText>;
  };
  const names = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, page(key)]));
  return {
    TAB_ROOT_SCREENS: names(["Dashboard", "TournamentList", "CommunityHub", "VereinHub", "Profile"]),
    DETAIL_SCREENS: names(["TournamentDetail", "EventDetail", "FastLapDetail", "MatchDetail", "TournamentChat", "TeamDetail", "TeamChat", "PublicProfile",
      "DirectThread", "NewsList", "NewsDetail", "Gallery", "GalleryAlbum", "GalleryViewer", "Notifications", "Search", "SeasonPass", "AchievementShowcase",
      "AdventCalendar", "EasterHunt", "MyInvoices", "MyPrizes", "MyMembership", "MemberDocuments", "MemberMeetings", "MemberHelperShifts", "MemberCard",
      "Admission", "InfoCenter", "ClubAbout", "Settings", "ProfileEdit"]),
  };
});
const mockAuth = { user: { id: "u-1", username: "neonfalke", display_name: "NeonFalke", role: "player" } as Record<string, unknown> | null, loading: false };
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../live", () => ({ isGuestUser: (user: { id?: string } | null) => !user || user.id === "guest" }));
jest.mock("../lock/AppLockProvider", () => ({ useAppLock: () => ({ locked: false }) }));
const mockUnread = { value: 3 };
jest.mock("../chats/ChatsContext", () => ({ useUnreadChats: () => mockUnread.value }));
jest.mock("../seasons/SeasonStage", () => ({ SeasonStage: () => null, useSeasonTabIcon: () => null, SeasonBackdropSlot: () => null }));
jest.mock("../components/SiteBannerTicker", () => ({ SiteBannerTicker: () => null }));
jest.mock("../components/AchievementCatchUpOverlay", () => ({ AchievementCatchUpOverlay: () => null }));
jest.mock("../components/BallotPopupOverlay", () => ({ BallotPopupOverlay: () => null }));
jest.mock("../components/PasskeyInvite", () => ({ PasskeyInvite: () => null }));
jest.mock("../components/SignInNudge", () => ({ SignInNudge: () => null, markSignInNudgeSeen: jest.fn(async () => undefined) }));
jest.mock("../components/TabHeader", () => ({ HeaderBell: () => null }));
jest.mock("../lib/appLinks", () => ({ listenForAppLinks: () => () => {}, flushPendingLink: () => false }));
jest.mock("../screens/BootScreen", () => ({ BootScreen: () => null }));
jest.mock("../screens/LockScreen", () => ({ LockScreen: () => null }));
jest.mock("../screens/auth/LoginScreen", () => ({ LoginScreen: () => null }));
jest.mock("../screens/auth/RegisterScreen", () => ({ RegisterScreen: () => null }));
jest.mock("../screens/auth/ConsentScreen", () => ({ ConsentScreen: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const current = () => navigationRef.getCurrentRoute()?.name;

async function settle() {
  // Der Stapel reagiert auf den Tipp aufs Tab erst im nächsten Bild (requestAnimationFrame).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function renderApp() {
  await render(<AppNavigator />);
  await settle();
}

beforeEach(() => {
  mockAuth.user = { id: "u-1", username: "neonfalke", display_name: "NeonFalke", role: "player" };
  mockUnread.value = 3;
});

test("fünf Tabs in dieser Reihenfolge: Home · Events · Community · Verein · Profil - die Zahl an Community zählt ungelesene Chats", async () => {
  await renderApp();
  const labels = ["Home", "Events", "Community", "Verein", "Profil"];
  for (const label of labels) expect(screen.getByText(label)).toBeTruthy();
  for (const id of ["tab-home", "tab-events", "tab-community", "tab-verein", "tab-profile"]) expect(screen.getByTestId(id)).toBeTruthy();
  expect(screen.queryByText("Mehr")).toBeNull();
  expect(screen.queryByText("Teams")).toBeNull();
  expect(screen.getByText("3")).toBeTruthy();
  expect(current()).toBe("Dashboard");
});

test("als Gast dieselben fünf Tabs - ohne Zahl", async () => {
  mockAuth.user = null;
  mockUnread.value = 0;
  await renderApp();
  for (const label of ["Home", "Events", "Community", "Verein", "Profil"]) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText("3")).toBeNull();
});

test("Home → News → Zurück: die News legt sich über Home, der Tab springt nicht", async () => {
  await renderApp();
  await act(async () => {
    nav.navigate("NewsDetail", { id: "herbst-lan" });
  });
  expect(current()).toBe("NewsDetail");
  expect(currentTab()).toBe("HomeTab");
  // Auch ein Turnier und ein Spielerprofil aus Home bleiben in Home.
  await act(async () => {
    nav.navigate("TournamentDetail", { id: "fc26" });
  });
  await act(async () => {
    nav.navigate("PublicProfile", { username: "kiwikomet" });
  });
  expect(currentTab()).toBe("HomeTab");
  await act(async () => {
    navigationRef.goBack();
    navigationRef.goBack();
    navigationRef.goBack();
  });
  expect(current()).toBe("Dashboard");
});

test("Benachrichtigung bei offenem Tab Events: öffnet über Events; zweimal auf den Tab: zur Übersicht", async () => {
  await renderApp();
  await fireEvent.press(screen.getByTestId("tab-events"));
  await settle();
  expect(current()).toBe("TournamentList");

  await act(async () => {
    navigateToNotification({ id: "n1", kind: "team_chat_message", meta: { team_id: "t-1" }, title: "Neue Teamnachricht", read: false } as never);
  });
  expect(current()).toBe("TeamChat");
  expect(currentTab()).toBe("EventsTab");
  await act(async () => {
    navigateToUrl("/news/herbst-lan");
  });
  expect(current()).toBe("NewsDetail");
  expect(currentTab()).toBe("EventsTab");

  // Erster Tipp auf den aktiven Tab: zurück zur Übersicht (der zweite rollt die Liste nach oben).
  await fireEvent.press(screen.getByTestId("tab-events"));
  await settle();
  expect(current()).toBe("TournamentList");
  expect(currentTab()).toBe("EventsTab");
});

test("#994: im Profil öffnen Erfolge-Übersicht und Freundesprofile im Profil-Tab; „Erfolg freigeschaltet“ führt zu den Erfolgen", async () => {
  await renderApp();
  await fireEvent.press(screen.getByTestId("tab-profile"));
  await settle();
  expect(current()).toBe("Profile");
  await act(async () => {
    nav.navigate("PublicProfile", { username: "kiwikomet" });
  });
  expect(current()).toBe("PublicProfile");
  expect(currentTab()).toBe("ProfileTab");
  await act(async () => {
    navigationRef.goBack();
  });
  expect(current()).toBe("Profile");

  await fireEvent.press(screen.getByTestId("tab-events"));
  await settle();
  await act(async () => {
    openTab("Profile", { tab: "achievements" });
  });
  expect(currentTab()).toBe("ProfileTab");
  expect(navigationRef.getCurrentRoute()).toMatchObject({ name: "Profile", params: { tab: "achievements" } });
});

test("alte Adressen öffnen den neuen Tab: /verein, /messages, /teams, /fastlap", async () => {
  await renderApp();
  const cases: Array<[string, string, string]> = [
    ["/verein", "VereinTab", "VereinHub"],
    ["/messages", "CommunityTab", "CommunityHub"],
    ["/teams", "CommunityTab", "CommunityHub"],
    ["/fastlap", "EventsTab", "TournamentList"],
    ["/u/me", "ProfileTab", "Profile"],
    ["/", "HomeTab", "Dashboard"],
  ];
  for (const [url, tabName, screenName] of cases) {
    await act(async () => {
      expect(navigateToUrl(url)).toBe(true);
    });
    expect([url, currentTab(), current()]).toEqual([url, tabName, screenName]);
  }
  expect(navigationRef.getCurrentRoute()?.params).toBeUndefined();
  await act(async () => {
    navigateToUrl("/teams");
  });
  expect(navigationRef.getCurrentRoute()).toMatchObject({ name: "CommunityHub", params: { section: "teams" } });
  expect(screen.getAllByText(/^Seite /).length).toBeGreaterThan(0);
  expect(Text).toBeTruthy();
});

test("über Anmelden: ein Link geht zurück in die Tabs - keine zweite Ebene darunter", async () => {
  await renderApp();
  await act(async () => {
    openSignIn();
  });
  expect(current()).toBe("Login");
  await act(async () => {
    navigateToUrl("/news/herbst-lan");
  });
  expect(current()).toBe("NewsDetail");
  expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(["Main"]);
  await act(async () => {
    openSignIn();
  });
  await act(async () => {
    navigateToUrl("/verein");
  });
  expect([currentTab(), current()]).toEqual(["VereinTab", "VereinHub"]);
  expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(["Main"]);
});
