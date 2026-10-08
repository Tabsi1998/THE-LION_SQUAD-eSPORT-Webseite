import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { UnderHeaderContext } from "../components/Screen";
import { HeaderBell } from "../components/TabHeader";
import { BootScreen } from "../screens/BootScreen";
import { LockScreen } from "../screens/LockScreen";
import { AchievementCatchUpOverlay } from "../components/AchievementCatchUpOverlay";
import { BallotPopupOverlay } from "../components/BallotPopupOverlay";
import { PasskeyInvite } from "../components/PasskeyInvite";
import { markSignInNudgeSeen, SignInNudge } from "../components/SignInNudge";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { DETAIL_SCREENS, TAB_ROOT_SCREENS } from "./screenRegistry";
import { RegisterScreen } from "../screens/auth/RegisterScreen";
import { ConsentScreen } from "../screens/auth/ConsentScreen";
import { SiteBannerTicker } from "../components/SiteBannerTicker";
import { useAuth } from "../auth/AuthContext";
import { useUnreadChats } from "../chats/ChatsContext";
import { badgeText } from "../lib/chats";
import { isGuestUser } from "../live";
import { useAppLock } from "../lock/AppLockProvider";
import { SeasonStage, useSeasonTabIcon } from "../seasons/SeasonStage";
import { colors } from "../theme";
import { flushPendingNotification, navigationRef } from "./rootNavigation";
import { flushPendingLink, listenForAppLinks } from "../lib/appLinks";
import type { AppStackParamList, DetailScreenName, MainTabName, MainTabParamList, RootStackParamList, TabRootParamList } from "./types";

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
// Ein Stapel-Bauplan für alle fünf Tabs (#1144): jeder Tab hat seinen eigenen Stapel mit denselben Detail-Screens.
const AppStack = createNativeStackNavigator<AppStackParamList>();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.black,
    card: colors.surface,
    text: colors.white,
    border: colors.border,
    primary: colors.cyan,
  },
};

/** Die fünf Tabs in ihrer Reihenfolge (#1143) - für alle gleich, damit Hilfe am Telefon funktioniert. */
export const MAIN_TABS: Array<{ name: MainTabName; title: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { name: "HomeTab", title: "Home", icon: "home-outline" },
  { name: "EventsTab", title: "Events", icon: "calendar-outline" },
  { name: "CommunityTab", title: "Community", icon: "chatbubbles-outline" },
  { name: "VereinTab", title: "Verein", icon: "shield-checkmark-outline" },
  { name: "ProfileTab", title: "Profil", icon: "person-circle-outline" },
];

export function AppNavigator() {
  const { user, loading } = useAuth();
  const { locked } = useAppLock();
  const signedIn = Boolean(user && !isGuestUser(user));
  // Wer angemeldet war, kennt den Weg: der Hinweis für Gäste (#918) kommt dann auch nach dem Abmelden nicht mehr.
  useEffect(() => {
    if (signedIn) void markSignInNudgeSeen();
  }, [signedIn]);
  // Links von außen (#921): Discord, WhatsApp, Browser - Android reicht Adressen von lionsquad.at an die App.
  useEffect(() => listenForAppLinks(), []);

  if (loading) return <BootScreen />;
  // App-Sperre (#217): erst Fingerabdruck, dann Chats und Profil. Gäste haben nichts zu schützen.
  if (signedIn && locked) return <LockScreen />;

  return (
    <NavigationContainer ref={navigationRef} theme={theme} onReady={() => { flushPendingNotification(); flushPendingLink(); }}>
      {signedIn && user?.consent_required ? <ConsentScreen /> : <RootScreens />}
      {signedIn && !user?.consent_required ? <AchievementCatchUpOverlay /> : null}
      {/* Abstimmung live (#844): offene Abstimmung mit eigenem Stimmrecht über jedem Screen. */}
      {signedIn && !user?.consent_required ? <BallotPopupOverlay /> : null}
      {/* Passkey (#919): direkt nach einer Anmeldung mit Passwort einmal die Einladung zum Fingerabdruck. */}
      {signedIn && !user?.consent_required ? <PasskeyInvite /> : null}
      {/* Gast zuerst (#918): beim ersten Start nach ein paar Sekunden einmal „Konto erstellen oder anmelden“. */}
      {!signedIn ? <SignInNudge /> : null}
    </NavigationContainer>
  );
}

// Gast zuerst (#918): Die App startet ohne Konto. Anmelden und Registrieren liegen über den Tabs - nach der Anmeldung geht
// es zurück, woher man kam (Turnier, Adventkalender, Profil ...).
function RootScreens() {
  return (
    <RootStack.Navigator screenOptions={stackOptions} screenLayout={stackScreenLayout}>
      <RootStack.Screen name="Main" component={MainScreen} options={{ headerShown: false }} />
      <RootStack.Screen name="Login" component={LoginScreen} options={{ title: "Anmelden" }} />
      <RootStack.Screen name="Register" component={RegisterScreen} options={{ title: "Registrieren" }} />
    </RootStack.Navigator>
  );
}

function MainScreen() {
  return (
    <View style={styles.mainWithBanner}>
      {/* Laufbanner (#245): über allen Tabs, dieselben Banner wie die Website mit Kanal „app“. */}
      <SiteBannerTicker />
      <View style={styles.mainWithBanner}><MainTabs /></View>
      {/* Jahreszeiten (#636): Deko-Ebenen über den Tabs, nie klickbar. */}
      <SeasonStage />
    </View>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 8);
  // Jahreszeiten (#636, #1143): der Tab „Verein“ trägt zur Saison ihr Symbol (Halloween: Kürbis).
  const SeasonIcon = useSeasonTabIcon();
  // Die Zahl am Tab „Community“ (#1148) zählt ungelesene Chats.
  const unreadChats = useUnreadChats();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.cyan,
        tabBarInactiveTintColor: colors.muted,
        tabBarBackground: () => <View style={styles.tabBarGlass} />,
        tabBarStyle: {
          backgroundColor: "transparent",
          borderTopWidth: 0,
          elevation: 0,
          height: 62 + bottomInset,
          paddingTop: 8,
          paddingBottom: bottomInset,
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.32,
          shadowRadius: 16,
        },
        tabBarItemStyle: {
          borderRadius: 8,
          minHeight: 50,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "900",
          textTransform: "uppercase",
        },
        tabBarBadgeStyle: styles.tabBadge,
        tabBarIcon: ({ color, focused, size }) => (
          <View style={styles.tabIconWrap}>
            <View style={[styles.tabActiveLine, focused && styles.tabActiveLineVisible]} />
            {route.name === "VereinTab" && SeasonIcon ? <SeasonIcon size={focused ? size + 1 : size} /> : <Ionicons name={iconFor(route.name)} color={color} size={focused ? size + 1 : size} />}
          </View>
        ),
      })}
    >
      <Tabs.Screen name="HomeTab" component={HomeStackScreen} options={{ title: "Home", tabBarButtonTestID: "tab-home" }} />
      <Tabs.Screen name="EventsTab" component={EventsStackScreen} options={{ title: "Events", tabBarButtonTestID: "tab-events" }} />
      <Tabs.Screen
        name="CommunityTab"
        component={CommunityStackScreen}
        options={{
          title: "Community",
          tabBarButtonTestID: "tab-community",
          tabBarBadge: unreadChats > 0 ? badgeText(unreadChats) : undefined,
          tabBarAccessibilityLabel: unreadChats > 0 ? `Community, ${unreadChats} ungelesene Chats` : "Community",
        }}
      />
      <Tabs.Screen name="VereinTab" component={VereinStackScreen} options={{ title: "Verein", tabBarButtonTestID: "tab-verein" }} />
      <Tabs.Screen name="ProfileTab" component={ProfileStackScreen} options={{ title: "Profil", tabBarButtonTestID: "tab-profile" }} />
    </Tabs.Navigator>
  );
}

// Unterseiten mit Kopfzeile: der Screen darunter hält keinen zweiten Abstand zur Statusleiste (sonst leere Fläche).
function stackScreenLayout({ options, children }: { options: { headerShown?: boolean }; children: React.ReactElement }) {
  return <UnderHeaderContext.Provider value={options.headerShown !== false}>{children}</UnderHeaderContext.Provider>;
}

const stackOptions = {
  headerStyle: { backgroundColor: colors.black },
  headerTintColor: colors.cyan,
  headerTitleStyle: { color: colors.white, fontWeight: "900" as const },
  contentStyle: { backgroundColor: colors.black },
};

// Detail-Screens (#1145): Zurück-Pfeil links, rechts die Glocke - an derselben Stelle wie in den Übersichten.
const detailOptions: NativeStackNavigationOptions = {
  ...stackOptions,
  headerRight: () => <HeaderBell />,
};

const gold = { headerTintColor: colors.gold };

/** Titel und Kopfzeile der Detail-Screens - in jedem Tab-Stapel dieselben (#1144). */
export const DETAIL_OPTIONS: Record<DetailScreenName, NativeStackNavigationOptions | ((props: { route: { params?: { title?: string } } }) => NativeStackNavigationOptions)> = {
  TournamentDetail: { title: "Turnier" },
  EventDetail: { title: "Event" },
  FastLapDetail: { title: "Fast Lap" },
  MatchDetail: { title: "Match" },
  TournamentChat: ({ route }) => ({ title: route.params?.title || "Turnier-Chat" }),
  TeamDetail: { title: "Team" },
  TeamChat: ({ route }) => ({ title: route.params?.title || "Team-Chat" }),
  PublicProfile: { title: "Profil" },
  DirectThread: ({ route }) => ({ title: route.params?.title || "Chat" }),
  NewsList: { title: "News" },
  NewsDetail: { title: "News" },
  Gallery: { title: "Galerie" },
  GalleryAlbum: { title: "Album" },
  GalleryViewer: { title: "Galerie", headerTintColor: colors.white },
  // Die Liste der Glocke: rechts keine zweite Glocke.
  Notifications: { title: "Benachrichtigungen", headerRight: () => null },
  // Die Suche zeigt ihre eigene Zeile mit Eingabefeld und „Abbrechen“.
  Search: { headerShown: false },
  SeasonPass: { title: "Jahreswertung" },
  AchievementShowcase: { title: "Erfolge" },
  AdventCalendar: { title: "Adventkalender", headerTintColor: "#e9c46a" },
  EasterHunt: { title: "Ostereiersuche", headerTintColor: "#e9c46a" },
  MyInvoices: { title: "Meine Rechnungen", ...gold },
  MyPrizes: { title: "Meine Gewinne", ...gold },
  MyMembership: { title: "Meine Mitgliedschaft", ...gold },
  MemberDocuments: { title: "Dokumente", ...gold },
  MemberMeetings: { title: "Versammlungen", ...gold },
  MemberHelperShifts: { title: "Helferdienste", ...gold },
  MemberCard: { title: "Mitgliedskarte", ...gold },
  Admission: { title: "Einlass" },
  InfoCenter: { title: "Verein" },
  ClubAbout: { title: "Über uns" },
  YearReview: { title: "Dein Jahr", ...gold },
  Settings: { title: "Einstellungen" },
  ProfileEdit: { title: "Profil bearbeiten" },
};

/** Alle Detail-Screens - in jedem Tab-Stapel dieselben (#1144). */
function detailScreens() {
  return (
    <AppStack.Group screenOptions={detailOptions}>
      {(Object.keys(DETAIL_SCREENS) as DetailScreenName[]).map((name) => (
        <AppStack.Screen key={name} name={name} component={DETAIL_SCREENS[name]} options={DETAIL_OPTIONS[name] as never} />
      ))}
    </AppStack.Group>
  );
}

/** Ein Tab-Stapel: seine Übersicht ohne Stapel-Kopf (die Übersicht zeigt ihre eigene Kopfzeile), darüber die Details. */
function tabStack<R extends keyof TabRootParamList>(root: R) {
  function TabStack() {
    return (
      <AppStack.Navigator screenOptions={stackOptions} screenLayout={stackScreenLayout} initialRouteName={root}>
        <AppStack.Screen name={root} component={TAB_ROOT_SCREENS[root]} options={{ headerShown: false }} />
        {detailScreens()}
      </AppStack.Navigator>
    );
  }
  TabStack.displayName = `${root}Stack`;
  return TabStack;
}

const HomeStackScreen = tabStack("Dashboard");
const EventsStackScreen = tabStack("TournamentList");
const CommunityStackScreen = tabStack("CommunityHub");
const VereinStackScreen = tabStack("VereinHub");
const ProfileStackScreen = tabStack("Profile");

function iconFor(route: MainTabName) {
  return MAIN_TABS.find((tab) => tab.name === route)?.icon || "ellipse-outline";
}

const styles = StyleSheet.create({
  mainWithBanner: {
    flex: 1,
  },
  tabIconWrap: {
    alignItems: "center",
    height: 28,
    justifyContent: "flex-end",
    minWidth: 38,
  },
  tabBarGlass: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    backgroundColor: "rgba(10,10,10,0.96)",
    borderTopColor: "rgba(255,255,255,0.1)",
    borderTopWidth: 1,
  },
  tabActiveLine: {
    backgroundColor: "transparent",
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    height: 2,
    position: "absolute",
    top: -6,
    width: 32,
  },
  tabActiveLineVisible: {
    backgroundColor: colors.cyan,
  },
  tabBadge: {
    backgroundColor: colors.live,
    color: colors.white,
    fontSize: 10,
    fontWeight: "900",
  },
});
