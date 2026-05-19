import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";
import { BootScreen } from "../screens/BootScreen";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { RegisterScreen } from "../screens/auth/RegisterScreen";
import { DashboardScreen } from "../screens/main/DashboardScreen";
import { DirectMessagesScreen } from "../screens/main/DirectMessagesScreen";
import { DirectThreadScreen } from "../screens/main/DirectThreadScreen";
import { FastLapDetailScreen } from "../screens/main/FastLapDetailScreen";
import { FastLapScreen } from "../screens/main/FastLapScreen";
import { MoreScreen } from "../screens/main/MoreScreen";
import { NewsDetailScreen } from "../screens/main/NewsDetailScreen";
import { NewsScreen } from "../screens/main/NewsScreen";
import { NotificationsScreen } from "../screens/main/NotificationsScreen";
import { ProfileScreen } from "../screens/main/ProfileScreen";
import { InfoCenterScreen } from "../screens/main/InfoCenterScreen";
import { TeamChatScreen } from "../screens/main/TeamChatScreen";
import { TeamDetailScreen } from "../screens/main/TeamDetailScreen";
import { TeamsScreen } from "../screens/main/TeamsScreen";
import { TournamentChatScreen } from "../screens/main/TournamentChatScreen";
import { TournamentDetailScreen } from "../screens/main/TournamentDetailScreen";
import { TournamentsScreen } from "../screens/main/TournamentsScreen";
import { useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import type {
  AuthStackParamList,
  MainTabParamList,
  MoreStackParamList,
  TeamStackParamList,
  TournamentStackParamList,
} from "./types";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const TournamentStack = createNativeStackNavigator<TournamentStackParamList>();
const TeamStack = createNativeStackNavigator<TeamStackParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();

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

export function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) return <BootScreen />;

  return (
    <NavigationContainer theme={theme}>
      {user ? <MainTabs /> : <AuthScreens />}
    </NavigationContainer>
  );
}

function AuthScreens() {
  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#101113" },
      }}
    >
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 8);
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.cyan,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 56 + bottomInset,
          paddingTop: 7,
          paddingBottom: bottomInset,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700",
        },
        tabBarIcon: ({ color, size }) => <Ionicons name={iconFor(route.name)} color={color} size={size} />,
      })}
    >
      <Tabs.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Home" }} />
      <Tabs.Screen name="Tournaments" component={TournamentStackScreen} options={{ title: "Turniere" }} />
      <Tabs.Screen name="Teams" component={TeamStackScreen} options={{ title: "Teams" }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: "Profil" }} />
      <Tabs.Screen name="More" component={MoreStackScreen} options={{ title: "Mehr" }} />
    </Tabs.Navigator>
  );
}

const stackOptions = {
  headerStyle: { backgroundColor: colors.black },
  headerTintColor: colors.cyan,
  headerTitleStyle: { color: colors.white, fontWeight: "900" as const },
  contentStyle: { backgroundColor: colors.black },
};

function TournamentStackScreen() {
  return (
    <TournamentStack.Navigator screenOptions={stackOptions}>
      <TournamentStack.Screen name="TournamentList" component={TournamentsScreen} options={{ headerShown: false }} />
      <TournamentStack.Screen name="TournamentDetail" component={TournamentDetailScreen} options={{ title: "Turnier" }} />
      <TournamentStack.Screen name="TournamentChat" component={TournamentChatScreen} options={({ route }) => ({ title: route.params.title || "Turnier-Chat" })} />
    </TournamentStack.Navigator>
  );
}

function TeamStackScreen() {
  return (
    <TeamStack.Navigator screenOptions={stackOptions}>
      <TeamStack.Screen name="TeamList" component={TeamsScreen} options={{ headerShown: false }} />
      <TeamStack.Screen name="TeamDetail" component={TeamDetailScreen} options={{ title: "Team" }} />
      <TeamStack.Screen name="TeamChat" component={TeamChatScreen} options={({ route }) => ({ title: route.params.title || "Team-Chat" })} />
    </TeamStack.Navigator>
  );
}

function MoreStackScreen() {
  return (
    <MoreStack.Navigator screenOptions={stackOptions}>
      <MoreStack.Screen name="MoreHub" component={MoreScreen} options={{ headerShown: false }} />
      <MoreStack.Screen name="InfoCenter" component={InfoCenterScreen} options={{ title: "Info Center" }} />
      <MoreStack.Screen name="NewsList" component={NewsScreen} options={{ title: "News" }} />
      <MoreStack.Screen name="NewsDetail" component={NewsDetailScreen} options={{ title: "News" }} />
      <MoreStack.Screen name="FastLapList" component={FastLapScreen} options={{ title: "Fast Laps" }} />
      <MoreStack.Screen name="FastLapDetail" component={FastLapDetailScreen} options={{ title: "Fast Lap" }} />
      <MoreStack.Screen name="DirectMessages" component={DirectMessagesScreen} options={{ title: "Nachrichten" }} />
      <MoreStack.Screen name="DirectThread" component={DirectThreadScreen} options={({ route }) => ({ title: route.params.title || "Chat" })} />
      <MoreStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Benachrichtigungen" }} />
    </MoreStack.Navigator>
  );
}

function iconFor(route: keyof MainTabParamList) {
  switch (route) {
    case "Dashboard":
      return "home-outline";
    case "Tournaments":
      return "trophy-outline";
    case "Teams":
      return "people-outline";
    case "Profile":
      return "person-circle-outline";
    case "More":
      return "grid-outline";
  }
}
