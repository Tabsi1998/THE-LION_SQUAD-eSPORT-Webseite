import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Card } from "./Card";
import { Body, Heading, Muted } from "./Text";
import { formatDate } from "../lib/format";
import { colors } from "../theme";

// Verknüpfte Konten (#459, wie im Web #260): jedes per Anmeldung bestätigte Konto mit Rahmen in
// Plattformfarbe, Anzeigename, Kennung, „seit …“ und der offiziellen Adresse - man sieht, dass es
// echt ist und wohin es geht. Verknüpfen selbst bleibt im Web (Rückruf der Plattform im Browser).

export type LinkedAccount = {
  platform: string;
  label?: string | null;
  handle?: string | null;
  display_name?: string | null;
  linked_at?: string | null;
  url?: string | null;
};

export const PLATFORM_COLORS: Record<string, string> = {
  discord: "#5865F2", twitch: "#9146FF", steam: "#66C0F4", youtube: "#FF0000", tiktok: "#69C9D0", x: "#FFFFFF",
  battlenet: "#148EFF", riot: "#D13639", xbox: "#107C10", epic: "#C8C8C8", instagram: "#E4405F",
};
const PLATFORM_LABELS: Record<string, string> = {
  discord: "Discord", twitch: "Twitch", steam: "Steam", youtube: "YouTube", tiktok: "TikTok", x: "X",
  battlenet: "Battle.net", riot: "Riot Games", xbox: "Xbox", epic: "Epic Games", instagram: "Instagram",
};
const PLATFORM_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  discord: "logo-discord", twitch: "logo-twitch", steam: "logo-steam", youtube: "logo-youtube", tiktok: "logo-tiktok",
  x: "logo-twitter", battlenet: "globe-outline", riot: "flash-outline", xbox: "logo-xbox", epic: "flag-outline", instagram: "logo-instagram",
};
const VERIFIED_COLOR = "#00FF88";

export function platformKey(platform?: string | null): string {
  return String(platform || "").trim().toLowerCase();
}

export function platformColor(platform?: string | null): string {
  return PLATFORM_COLORS[platformKey(platform)] || colors.cyan;
}

export function platformIcon(platform?: string | null): keyof typeof Ionicons.glyphMap {
  return PLATFORM_ICONS[platformKey(platform)] || "link-outline";
}

export function platformLabel(account: Pick<LinkedAccount, "platform" | "label">): string {
  return account.label || PLATFORM_LABELS[platformKey(account.platform)] || account.platform;
}

// Ohne Steam-API-Schlüssel ist der Anzeigename die 17-stellige ID - dann steht „Steam-Profil“ groß und die ID klein.
export function accountTitle(account: LinkedAccount): string {
  const numericName = /^\d{17}$/.test(String(account.display_name || ""));
  if (numericName) return `${platformLabel(account)}-Profil`;
  return account.display_name || account.handle || platformLabel(account);
}

export function accountDetail(account: LinkedAccount): string {
  const numericName = /^\d{17}$/.test(String(account.display_name || ""));
  const showHandle = Boolean(account.handle) && (numericName || account.handle !== account.display_name);
  const since = account.linked_at ? formatDate(account.linked_at) : "";
  return [platformLabel(account), showHandle ? account.handle : null, since ? `seit ${since}` : null].filter(Boolean).join(" · ");
}

export function isVerified(verified: string[] | null | undefined, platform?: string | null): boolean {
  return Array.isArray(verified) && verified.includes(platformKey(platform));
}

export function LinkedAccountsCard({ accounts, testID = "linked-accounts", title = "Verknüpfte Konten" }: { accounts?: LinkedAccount[] | null; testID?: string; title?: string }) {
  const items = Array.isArray(accounts) ? accounts.filter((account) => account && account.platform) : [];
  if (!items.length) return null;
  return (
    <View testID={testID}>
      <Card style={styles.card}>
        <View style={styles.titleRow}>
          <Ionicons name="shield-checkmark" color={VERIFIED_COLOR} size={16} />
          <Heading>{title}</Heading>
        </View>
        <Muted>Per Anmeldung bei der Plattform bestätigt – der Link führt zum echten Konto.</Muted>
        {items.map((account) => {
          const color = platformColor(account.platform);
          const open = () => {
            if (account.url) Linking.openURL(account.url).catch(() => {});
          };
          return (
            <Pressable
              key={account.platform}
              testID={`linked-account-${platformKey(account.platform)}`}
              accessibilityRole={account.url ? "link" : "text"}
              accessibilityLabel={`${accountTitle(account)}, ${accountDetail(account)}, verifiziert`}
              onPress={open}
              disabled={!account.url}
              style={({ pressed }) => [styles.row, { borderColor: color }, pressed && styles.pressed]}
            >
              <View style={[styles.icon, { borderColor: color }]}>
                <Ionicons name={platformIcon(account.platform)} color={color} size={18} />
              </View>
              <View style={styles.flex}>
                <View style={styles.nameRow}>
                  <Body style={styles.strong} numberOfLines={1}>{accountTitle(account)}</Body>
                  <Ionicons name="checkmark-circle" color={VERIFIED_COLOR} size={16} />
                </View>
                <Muted numberOfLines={1}>{accountDetail(account)}</Muted>
              </View>
              {account.url ? <Ionicons name="open-outline" color={colors.muted} size={17} /> : null}
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  row: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  pressed: {
    opacity: 0.7,
  },
  icon: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 6,
    borderWidth: 2,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  strong: {
    color: colors.white,
    fontWeight: "700",
    flexShrink: 1,
  },
});
