import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import { seasonScrollProps } from "../../seasons/sky/scroll";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { useBranding } from "../../branding/BrandingProvider";
import { API_BASE_URL } from "../../config";
import { api } from "../../lib/api";
import { isGuestUser } from "../../live";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import { useAppUpdate } from "../../update/AppUpdateProvider";
import { DecoSetting } from "../../seasons/DecoSetting";
import { SeasonShelfSlot } from "../../seasons/SeasonStage";
import { useAdventEntry } from "../../advent/entry";

// "Mehr" ist das Verzeichnis: eine Zeile je Ziel, keine Beschreibungstexte.
// Vorher war jedes Ziel eine große Karte mit Badge und zwei Zeilen Text, und
// der Discord-Link stand fest im Code - und war falsch (#214). Die
// Vereinskanäle kommen jetzt aus den Einstellungen, wie im Web-Footer.

type Props = NativeStackScreenProps<MoreStackParamList, "MoreHub">;

type Entry = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  section?: NonNullable<NonNullable<MoreStackParamList["InfoCenter"]>["section"]>;
  screen?: "NewsList" | "Gallery" | "DirectMessages" | "Notifications" | "SeasonPass" | "AchievementShowcase" | "MyInvoices" | "MyMembership" | "AdventCalendar";
  ownPublicProfile?: boolean;
};

type SocialLink = { platform?: string; label?: string; url?: string; enabled?: boolean };

// Wer noch nicht Mitglied ist, landet auf der Beitrittsseite der Website (#340).
export const JOIN_URL = `${API_BASE_URL}/membership/join`;

// Konto in derselben Reihenfolge wie das Benutzermenü im Web (#516): Nachrichten, Benachrichtigungen,
// Meine Mitgliedschaft (Mitglieder), Rechnungen, öffentliches Profil. „Mitglied werden“ ist die Karte oben.
export function kontoEntries(isClubMember: boolean): Entry[] {
  return [
    { title: "Nachrichten", icon: "chatbubbles-outline", screen: "DirectMessages" },
    { title: "Benachrichtigungen", icon: "notifications-outline", screen: "Notifications" },
    ...(isClubMember ? [{ title: "Meine Mitgliedschaft", icon: "ribbon-outline" as const, screen: "MyMembership" as const }] : []),
    // Meine Rechnungen (#320): für alle Konten - Event- und Turnierrechnungen auch ohne Mitgliedschaft.
    { title: "Meine Rechnungen", icon: "receipt-outline", screen: "MyInvoices" },
    { title: "Öffentliches Profil", icon: "open-outline", ownPublicProfile: true },
  ];
}

const GROUPS: Array<{ title: string; entries: Entry[] }> = [
  {
    // Nur Ziele ohne eigenen Tab: Fast Laps und Turniere haben den Events-Tab (#242).
    title: "Gaming",
    entries: [
      { title: "Jahreswertung", icon: "trophy-outline", screen: "SeasonPass" },
      // Wie „Achievements“ im Menü der Website (#619): Erfolg der Woche, Bestenliste, alle Erfolge mit Seltenheit.
      { title: "Achievements", icon: "sparkles-outline", screen: "AchievementShowcase" },
      { title: "Spielerprofile", icon: "people-outline", section: "profiles" },
    ],
  },
  {
    // Mitgliedervorteile liegen jetzt im Mitgliederbereich (#340).
    title: "Verein",
    entries: [
      { title: "News", icon: "newspaper-outline", screen: "NewsList" },
      { title: "Galerie", icon: "images-outline", screen: "Gallery" },
      { title: "Referenzen", icon: "medal-outline", section: "references" },
      { title: "Sponsoren", icon: "ribbon-outline", section: "sponsors" },
      { title: "Partner", icon: "link-outline", section: "partners" },
    ],
  },
];

// Der Adventkalender (#641) steht nur im Verzeichnis, solange er läuft und Türchen angelegt sind.
const ADVENT_ENTRY: Entry = { title: "Adventkalender", icon: "calendar-outline", screen: "AdventCalendar" };

export function moreGroups(advent: boolean): Array<{ title: string; entries: Entry[] }> {
  if (!advent) return GROUPS;
  return GROUPS.map((group) => (group.title === "Verein" ? { ...group, entries: [ADVENT_ENTRY, ...group.entries] } : group));
}

// Dieselben Plattform-Schlüssel wie im Web (frontend/src/lib/socialIcons.js).
const SOCIAL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  discord: "logo-discord",
  whatsapp: "logo-whatsapp",
  telegram: "paper-plane-outline",
  facebook: "logo-facebook",
  instagram: "logo-instagram",
  threads: "at-outline",
  tiktok: "logo-tiktok",
  youtube: "logo-youtube",
  twitch: "logo-twitch",
  kick: "videocam-outline",
  twitter: "logo-twitter",
  x: "logo-twitter",
  bluesky: "cloud-outline",
  mastodon: "logo-mastodon",
  linkedin: "logo-linkedin",
  reddit: "logo-reddit",
  steam: "logo-steam",
  github: "logo-github",
  snapchat: "logo-snapchat",
  pinterest: "logo-pinterest",
  vimeo: "logo-vimeo",
  spotify: "musical-notes-outline",
  email: "mail-outline",
  website: "globe-outline",
};

export function socialIcon(platform?: string | null): keyof typeof Ionicons.glyphMap {
  return SOCIAL_ICONS[String(platform || "").toLowerCase()] || "link-outline";
}

export function MoreScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { clubName } = useBranding();
  const { openWhatsNew } = useAppUpdate();
  const advent = Boolean(useAdventEntry());
  const [socials, setSocials] = useState<SocialLink[]>([]);
  const appVersion = Constants.expoConfig?.version ?? "?";
  const build = Constants.expoConfig?.android?.versionCode;

  useEffect(() => {
    let cancelled = false;
    api.get<{ social_links?: SocialLink[] }>("/settings/public")
      .then(({ data }) => {
        if (cancelled) return;
        const links = Array.isArray(data?.social_links) ? data.social_links : [];
        setSocials(links.filter((link) => link?.enabled !== false && link?.url));
      })
      .catch(() => {
        if (!cancelled) setSocials([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = (entry: Entry) => {
    if (entry.ownPublicProfile) {
      if (!user?.username || isGuestUser(user)) return;
      navigation.navigate("PublicProfile", { username: user.username });
      return;
    }
    if (entry.screen) {
      navigation.navigate(entry.screen as any);
      return;
    }
    if (entry.section) navigation.navigate("InfoCenter", { section: entry.section });
  };

  return (
    <Screen padded={false}>
      <ScrollView {...seasonScrollProps("MoreHub")} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Muted style={styles.eyebrow}>{clubName}</Muted>
          <Title>Mehr</Title>
          {/* Nikolaus (#736): der Stiefel steht rechts auf der Kante der ersten Karte. */}
          <SeasonShelfSlot />
        </View>

        {user && !isGuestUser(user) ? (
          user.is_club_member ? (
            <Pressable
              onPress={() => navigation.navigate("MemberArea")}
              accessibilityRole="button"
              testID="more-member-area"
              style={({ pressed }) => [styles.memberCard, pressed && styles.pressed]}
            >
              <View style={styles.memberIcon}><Ionicons name="ribbon-outline" color={colors.gold} size={22} /></View>
              <View style={styles.memberText}>
                <Body style={styles.memberTitle}>Mitgliederbereich</Body>
                <Muted>Mitgliedschaft, Karte, Dokumente, interne Events und News</Muted>
              </View>
              <Ionicons name="chevron-forward" color={colors.gold} size={16} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => { Linking.openURL(JOIN_URL).catch(() => {}); }}
              accessibilityRole="link"
              testID="more-join"
              style={({ pressed }) => [styles.joinCard, pressed && styles.pressed]}
            >
              <Ionicons name="ribbon-outline" color={colors.muted} size={22} />
              <View style={styles.memberText}>
                <Body style={styles.memberTitle}>Mitglied werden</Body>
                <Muted>Vereinsmitglieder sehen hier ihren Mitgliederbereich.</Muted>
              </View>
              <Ionicons name="open-outline" color={colors.muted} size={16} />
            </Pressable>
          )
        ) : null}

        {[{ title: "Konto", entries: kontoEntries(Boolean(user && !isGuestUser(user) && user.is_club_member)) }, ...moreGroups(advent)].map((group) => {
          return (
            <View key={group.title} style={styles.group}>
              <Heading>{group.title}</Heading>
              <Card style={styles.list} perch={`more-${group.title}`}>
                {group.entries.map((entry, index) => (
                  <Pressable
                    key={entry.title}
                    onPress={() => open(entry)}
                    accessibilityRole="button"
                    testID={entry.screen === "AdventCalendar" ? "more-advent" : undefined}
                    style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, pressed && styles.pressed]}
                  >
                    <Ionicons name={entry.icon} color={colors.cyan} size={20} />
                    <Body style={styles.rowTitle}>{entry.title}</Body>
                    <Ionicons name="chevron-forward" color={colors.muted} size={16} />
                  </Pressable>
                ))}
              </Card>
            </View>
          );
        })}

        {/* Saisonale Deko (#636): an, dezent, aus - für mich. */}
        <DecoSetting />
        {socials.length ? (
          <View style={styles.group}>
            <Heading>Folge uns</Heading>
            <View style={styles.socialRow}>
              {socials.map((link) => (
                <Pressable
                  key={`${link.platform}-${link.url}`}
                  accessibilityRole="link"
                  accessibilityLabel={link.label || link.platform || "Link"}
                  onPress={() => { Linking.openURL(String(link.url)).catch(() => {}); }}
                  style={({ pressed }) => [styles.social, pressed && styles.pressed]}
                  testID={`social-${String(link.platform || "link").toLowerCase()}`}
                >
                  <Ionicons name={socialIcon(link.platform)} color={colors.white} size={22} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.versionRow}>
          <Muted style={styles.version}>LionsAPP v{appVersion}{build ? ` · Build ${build}` : ""}</Muted>
          <Pressable onPress={openWhatsNew} accessibilityRole="button" testID="more-whats-new" style={({ pressed }) => [pressed && styles.pressed]}>
            <Muted style={styles.whatsNew}>Was ist neu</Muted>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  versionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  whatsNew: {
    color: colors.cyan,
    fontWeight: "700",
  },
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 32,
  },
  header: {
    gap: 2,
    // Über den Karten darunter: die Karte unter dem Nikolausstiefel liegt sonst unter ihnen.
    zIndex: 2,
  },
  eyebrow: {
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  group: {
    gap: 10,
  },
  memberCard: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.07)",
    borderColor: "rgba(255, 215, 0, 0.45)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  joinCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  memberIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.14)",
    borderRadius: 8,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  memberText: {
    flex: 1,
    gap: 2,
  },
  memberTitle: {
    fontWeight: "900",
  },
  list: {
    gap: 0,
    padding: 0,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  rowTitle: {
    flex: 1,
    fontWeight: "900",
  },
  socialRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  social: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  version: {
    textAlign: "center",
  },
  pressed: {
    opacity: 0.72,
  },
});
