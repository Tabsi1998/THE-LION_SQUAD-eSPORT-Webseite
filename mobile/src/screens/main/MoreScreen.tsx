import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

type Props = NativeStackScreenProps<MoreStackParamList, "MoreHub">;

type ModuleItem = {
  title: string;
  detail: string;
  badge: string;
  icon: keyof typeof Ionicons.glyphMap;
  badgeTone?: "cyan" | "gold" | "green";
  section?: NonNullable<NonNullable<MoreStackParamList["InfoCenter"]>["section"]>;
  screen?: "NewsList" | "FastLapList" | "DirectMessages" | "Notifications" | "SeasonPass";
  externalUrl?: string;
};

const featuredModules: ModuleItem[] = [
  {
    title: "Jahreswertung",
    detail: "Punkte, Rangliste und Jahres-Champion der laufenden Saison.",
    screen: "SeasonPass",
    badge: "Neu",
    icon: "trophy-outline",
    badgeTone: "gold",
  },
  {
    title: "Alerts",
    detail: "Push, Mentions, Erinnerungen und Match-Updates.",
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
    detail: "Updates, Events und verknüpfte Turniere.",
    screen: "NewsList",
    badge: "Live",
    icon: "newspaper-outline",
  },
];

const clubModules: ModuleItem[] = [
  {
    title: "Fast Laps",
    detail: "Challenges, Strecken und Bestzeiten direkt in LionsAPP ansehen.",
    screen: "FastLapList",
    badge: "Racing",
    icon: "flash-outline",
  },
  {
    title: "Events",
    detail: "Community-Abende, LANs, Festival-Auftritte und Anmeldestatus.",
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
    badgeTone: "gold",
  },
  {
    title: "Spielerprofile",
    detail: "Profile finden, Rollen sehen und Achievements vergleichen.",
    section: "profiles",
    badge: "Social",
    icon: "people-outline",
  },
  {
    title: "Referenzen",
    detail: "Erfolge, Highlights und Vereinsmomente gesammelt ansehen.",
    section: "references",
    badge: "Archiv",
    icon: "medal-outline",
    badgeTone: "gold",
  },
];

const partnerModules: ModuleItem[] = [
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
    title: "Discord beitreten",
    detail: "Dem Server beitreten und mit der Community in Kontakt bleiben.",
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
        <Card style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="shield-checkmark-outline" color={colors.black} size={22} />
          </View>
          <View style={styles.heroText}>
            <Muted style={styles.heroEyebrow}>THE LION SQUAD</Muted>
            <Title>Mehr</Title>
            <Muted>Verein, Community, News und App-Funktionen an einem Ort.</Muted>
          </View>
          <View style={styles.versionPill}>
            <Muted style={styles.versionText}>v{appVersion}</Muted>
          </View>
        </Card>

        <Section title="Schnellzugriff">
          <View style={styles.grid}>
            {featuredModules.map((item) => (
              <ModuleCard key={item.title} item={item} onPress={() => handlePress(item)} compact />
            ))}
          </View>
        </Section>

        <Section title="Verein und Gaming">
          {clubModules.map((item) => (
            <ModuleCard key={item.title} item={item} onPress={() => handlePress(item)} />
          ))}
        </Section>

        <Section title="Netzwerk">
          {partnerModules.map((item) => (
            <ModuleCard key={item.title} item={item} onPress={() => handlePress(item)} external={Boolean(item.externalUrl)} />
          ))}
        </Section>
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Heading>{title}</Heading>
      {children}
    </View>
  );
}

function ModuleCard({
  item,
  onPress,
  compact = false,
  external = false,
}: {
  item: ModuleItem;
  onPress: () => void;
  compact?: boolean;
  external?: boolean;
}) {
  const accent = item.badgeTone === "gold" ? colors.gold : item.badgeTone === "green" ? colors.success : colors.cyan;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [compact && styles.gridItem, pressed && styles.pressed]}>
      <Card style={[styles.card, compact && styles.compactCard]}>
        <View style={styles.cardTop}>
          <View style={[styles.iconWrap, { borderColor: `${accent}55`, backgroundColor: `${accent}18` }]}>
            <Ionicons name={item.icon} color={accent} size={compact ? 19 : 18} />
          </View>
          <View style={styles.cardTitleWrap}>
            <Body style={styles.title}>{item.title}</Body>
            <Badge label={item.badge} accent={accent} />
          </View>
        </View>
        <Muted numberOfLines={compact ? 3 : 2}>{item.detail}</Muted>
        <View style={styles.openRow}>
          <Muted style={styles.openHint}>{external ? "Extern öffnen" : "Bereich öffnen"}</Muted>
          <Ionicons name={external ? "open-outline" : "chevron-forward"} color={colors.cyan} size={15} />
        </View>
      </Card>
    </Pressable>
  );
}

function Badge({ label, accent }: { label: string; accent: string }) {
  return (
    <View style={[styles.badge, { borderColor: `${accent}55`, backgroundColor: `${accent}18` }]}>
      <Muted style={[styles.badgeText, { color: accent }]}>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 32,
  },
  hero: {
    alignItems: "center",
    borderColor: "rgba(41,182,232,0.32)",
    flexDirection: "row",
    gap: 12,
  },
  heroIcon: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 10,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  heroText: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  heroEyebrow: {
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  versionPill: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  versionText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: "900",
  },
  section: {
    gap: 10,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  gridItem: {
    flexBasis: "47%",
    flexGrow: 1,
  },
  card: {
    gap: 8,
  },
  compactCard: {
    minHeight: 148,
  },
  cardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  cardTitleWrap: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  iconWrap: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  title: {
    fontWeight: "900",
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  openRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    marginTop: "auto",
  },
  openHint: {
    color: colors.cyan,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
});
