import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import Constants from "expo-constants";

type Props = NativeStackScreenProps<MoreStackParamList, "MoreHub">;

type ModuleItem = {
  title: string;
  detail: string;
  badge: string;
  icon: string;
  badgeTone?: "cyan" | "gold" | "green" | "red";
  section?: NonNullable<NonNullable<MoreStackParamList["InfoCenter"]>["section"]>;
  screen?: "NewsList" | "FastLapList" | "DirectMessages" | "Notifications" | "SeasonPass";
  externalUrl?: string;
};

const modules: ModuleItem[] = [
  {
    title: "Season-Pass",
    detail: "Sammle das ganze Jahr Punkte durch Turniere, Events & Achievements. Der Beste gewinnt!",
    screen: "SeasonPass",
    badge: "🏆 Neu",
    icon: "trophy-outline",
    badgeTone: "gold",
  },
  {
    title: "Benachrichtigungen",
    detail: "Erinnerungen, Mentions, Nachrichten und Match-Updates aus der Plattform.",
    screen: "Notifications",
    badge: "Push",
    icon: "notifications-outline",
  },
  {
    title: "Nachrichten",
    detail: "Direktnachrichten mit Spielern und Community-Kontakten.",
    screen: "DirectMessages",
    badge: "Chat",
    icon: "chatbubble-outline",
  },
  {
    title: "News",
    detail: "Aktuelle Ankündigungen, Updates, Events und verknüpfte Turniere.",
    screen: "NewsList",
    badge: "Live",
    icon: "newspaper-outline",
  },
  {
    title: "Fast Laps",
    detail: "Challenges, Strecken und Bestzeiten direkt in LionsAPP ansehen.",
    screen: "FastLapList",
    badge: "Racing",
    icon: "flash-outline",
  },
  {
    title: "Sponsoren",
    detail: "Hinterlegte Unterstützer mit Kurzinfo und Link-Logik.",
    section: "sponsors",
    badge: "Club",
    icon: "ribbon-outline",
  },
  {
    title: "Partner",
    detail: "Kooperationen, Ligen, Community-Partner und Event-Bezug.",
    section: "partners",
    badge: "Netzwerk",
    icon: "link-outline",
  },
  {
    title: "Events",
    detail: "Community-Abende, LAN, Festival-Auftritte und Anmeldestatus.",
    section: "events",
    badge: "Kalender",
    icon: "calendar-outline",
  },
  {
    title: "Mitgliedervorteile",
    detail: "Dynamische Vorteile für aktive Vereinsmitglieder.",
    section: "benefits",
    badge: "Member",
    icon: "star-outline",
  },
  {
    title: "Spielerprofile",
    detail: "Profile finden, Rollen sehen und Achievements vergleichen.",
    section: "profiles",
    badge: "Social",
    icon: "people-outline",
  },
];

const externalLinks: ModuleItem[] = [
  {
    title: "Discord beitreten",
    detail: "Tritt dem THE LION SQUAD Discord-Server bei und bleib mit der Community in Kontakt.",
    externalUrl: "https://discord.gg/thelionsquad",
    badge: "Discord",
    icon: "logo-discord",
    badgeTone: "cyan",
  },
];

export function MoreScreen({ navigation }: Props) {
  const appVersion = Constants.expoConfig?.version ?? "1.0.0";

  const handlePress = (item: ModuleItem) => {
    if (item.externalUrl) {
      Linking.openURL(item.externalUrl).catch(() => {});
      return;
    }
    if (item.screen) {
      navigation.navigate(item.screen as any);
      return;
    }
    if (item.section) {
      navigation.navigate("InfoCenter", { section: item.section });
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Heading>Weitere Nutzerbereiche</Heading>
          <Muted>Info, Verein, Community und Profil-Funktionen sind hier als native App-Bereiche gebündelt.</Muted>
        </View>

        {modules.map((item) => (
          <ModuleCard key={item.title} item={item} onPress={() => handlePress(item)} />
        ))}

        {/* Externe Links */}
        <View style={styles.sectionHeader}>
          <Muted style={styles.sectionLabel}>COMMUNITY</Muted>
        </View>
        {externalLinks.map((item) => (
          <ModuleCard key={item.title} item={item} onPress={() => handlePress(item)} external />
        ))}

        {/* App-Info */}
        <View style={styles.appInfo}>
          <Ionicons name="paw-outline" color={colors.gold} size={20} />
          <Muted style={styles.appName}>THE LION SQUAD</Muted>
          <Muted style={styles.appVersion}>LionsAPP v{appVersion}</Muted>
        </View>
      </ScrollView>
    </Screen>
  );
}

function ModuleCard({ item, onPress, external = false }: { item: ModuleItem; onPress: () => void; external?: boolean }) {
  const badgeStyle = item.badgeTone === "gold"
    ? styles.badgeGold
    : item.badgeTone === "green"
    ? styles.badgeGreen
    : styles.badge;
  const badgeTextStyle = item.badgeTone === "gold"
    ? styles.badgeGoldText
    : item.badgeTone === "green"
    ? styles.badgeGreenText
    : styles.badgeText;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.iconWrap}>
            <Ionicons name={item.icon as any} color={item.badgeTone === "gold" ? colors.gold : colors.cyan} size={18} />
          </View>
          <Body style={styles.title}>{item.title}</Body>
          <Muted style={[styles.badge, badgeStyle, badgeTextStyle]}>{item.badge}</Muted>
        </View>
        <Muted>{item.detail}</Muted>
        <Muted style={styles.openHint}>
          {external ? "Extern öffnen →" : "Bereich öffnen →"}
        </Muted>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    gap: 12,
    paddingBottom: 32,
  },
  header: {
    gap: 6,
    marginBottom: 4,
  },
  sectionHeader: {
    marginTop: 4,
    marginBottom: -4,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  card: {
    gap: 6,
  },
  cardTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 24,
  },
  title: {
    flex: 1,
    fontWeight: "900",
  },
  badge: {
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.32)",
    borderRadius: 6,
    borderWidth: 1,
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 3,
    textTransform: "uppercase",
  },
  badgeText: {
    color: colors.cyan,
  },
  badgeGold: {
    backgroundColor: "rgba(240, 180, 41, 0.12)",
    borderColor: "rgba(240, 180, 41, 0.32)",
  },
  badgeGoldText: {
    color: colors.gold,
  },
  badgeGreen: {
    backgroundColor: "rgba(34, 197, 94, 0.12)",
    borderColor: "rgba(34, 197, 94, 0.32)",
  },
  badgeGreenText: {
    color: "#22c55e",
  },
  openHint: {
    color: colors.cyan,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.72,
  },
  appInfo: {
    alignItems: "center",
    gap: 4,
    marginTop: 12,
    paddingTop: 16,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  appName: {
    color: colors.gold,
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 1,
  },
  appVersion: {
    fontSize: 11,
  },
});
