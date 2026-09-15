import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import { isGuestUser } from "../../live";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// "Mehr" ist das Verzeichnis: eine Zeile je Ziel, keine Beschreibungstexte.
// Vorher war jedes Ziel eine große Karte mit Badge und zwei Zeilen Text, und
// der Discord-Link stand fest im Code - und war falsch (#214). Die
// Vereinskanäle kommen jetzt aus den Einstellungen, wie im Web-Footer.

type Props = NativeStackScreenProps<MoreStackParamList, "MoreHub">;

type Entry = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  section?: NonNullable<NonNullable<MoreStackParamList["InfoCenter"]>["section"]>;
  screen?: "NewsList" | "FastLapList" | "DirectMessages" | "Notifications" | "SeasonPass";
  ownPublicProfile?: boolean;
  membersOnly?: boolean;
};

type SocialLink = { platform?: string; label?: string; url?: string; enabled?: boolean };

const GROUPS: Array<{ title: string; entries: Entry[] }> = [
  {
    title: "Konto",
    entries: [
      { title: "Nachrichten", icon: "chatbubbles-outline", screen: "DirectMessages" },
      { title: "Benachrichtigungen", icon: "notifications-outline", screen: "Notifications" },
      { title: "Öffentliches Profil", icon: "open-outline", ownPublicProfile: true },
    ],
  },
  {
    title: "Gaming",
    entries: [
      { title: "Fast Laps", icon: "flash-outline", screen: "FastLapList" },
      { title: "Jahreswertung", icon: "trophy-outline", screen: "SeasonPass" },
      { title: "Spielerprofile", icon: "people-outline", section: "profiles" },
    ],
  },
  {
    title: "Verein",
    entries: [
      { title: "News", icon: "newspaper-outline", screen: "NewsList" },
      { title: "Mitgliedervorteile", icon: "star-outline", section: "benefits", membersOnly: true },
      { title: "Referenzen", icon: "medal-outline", section: "references" },
      { title: "Sponsoren", icon: "ribbon-outline", section: "sponsors" },
      { title: "Partner", icon: "link-outline", section: "partners" },
    ],
  },
];

const SOCIAL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  discord: "logo-discord",
  whatsapp: "logo-whatsapp",
  facebook: "logo-facebook",
  instagram: "logo-instagram",
  tiktok: "logo-tiktok",
  youtube: "logo-youtube",
  twitch: "logo-twitch",
  twitter: "logo-twitter",
  x: "logo-twitter",
  website: "globe-outline",
};

export function socialIcon(platform?: string | null): keyof typeof Ionicons.glyphMap {
  return SOCIAL_ICONS[String(platform || "").toLowerCase()] || "link-outline";
}

export function MoreScreen({ navigation }: Props) {
  const { user } = useAuth();
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
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Muted style={styles.eyebrow}>THE LION SQUAD</Muted>
          <Title>Mehr</Title>
        </View>

        {GROUPS.map((group) => {
          const entries = group.entries.filter((entry) => !entry.membersOnly || user?.is_club_member);
          if (!entries.length) return null;
          return (
            <View key={group.title} style={styles.group}>
              <Heading>{group.title}</Heading>
              <Card style={styles.list}>
                {entries.map((entry, index) => (
                  <Pressable
                    key={entry.title}
                    onPress={() => open(entry)}
                    accessibilityRole="button"
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

        <Muted style={styles.version}>LionsAPP v{appVersion}{build ? ` · Build ${build}` : ""}</Muted>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 32,
  },
  header: {
    gap: 2,
  },
  eyebrow: {
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  group: {
    gap: 10,
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
