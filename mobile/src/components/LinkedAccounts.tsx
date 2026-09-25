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
  psn: "#0070D1", nintendo: "#E60012", ea: "#FF4747", website: "#29B6E8",
  faceit: "#FF5500", startgg: "#3F80FF", roblox: "#FFFFFF", osu: "#FF66AA", lichess: "#BABABA", github: "#FFFFFF", kick: "#53FC18", reddit: "#FF4500", spotify: "#1DB954",
  threads: "#FFFFFF", facebook: "#1877F2", linkedin: "#0A66C2", snapchat: "#FFFC00", pinterest: "#E60023", telegram: "#26A5E4", wargaming: "#D4A017", bungie: "#3B82F6",
};
const PLATFORM_LABELS: Record<string, string> = {
  discord: "Discord", twitch: "Twitch", steam: "Steam", youtube: "YouTube", tiktok: "TikTok", x: "X",
  battlenet: "Battle.net", riot: "Riot Games", xbox: "Xbox", epic: "Epic Games", instagram: "Instagram",
  psn: "PlayStation", nintendo: "Nintendo", ea: "EA", website: "Website",
  faceit: "FACEIT", startgg: "start.gg", roblox: "Roblox", osu: "osu!", lichess: "Lichess", github: "GitHub", kick: "Kick", reddit: "Reddit", spotify: "Spotify",
  threads: "Threads", facebook: "Facebook", linkedin: "LinkedIn", snapchat: "Snapchat", pinterest: "Pinterest", telegram: "Telegram", wargaming: "Wargaming.net", bungie: "Bungie.net",
};
const PLATFORM_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  discord: "logo-discord", twitch: "logo-twitch", steam: "logo-steam", youtube: "logo-youtube", tiktok: "logo-tiktok",
  x: "logo-twitter", battlenet: "globe-outline", riot: "flash-outline", xbox: "logo-xbox", epic: "flag-outline", instagram: "logo-instagram",
  psn: "logo-playstation", nintendo: "game-controller-outline", ea: "game-controller-outline", website: "globe-outline",
  faceit: "flame-outline", startgg: "trophy-outline", roblox: "cube-outline", osu: "disc-outline", lichess: "grid-outline", github: "logo-github", kick: "videocam-outline", reddit: "logo-reddit", spotify: "musical-notes-outline",
  threads: "at-outline", facebook: "logo-facebook", linkedin: "logo-linkedin", snapchat: "logo-snapchat", pinterest: "logo-pinterest", telegram: "paper-plane-outline", wargaming: "shield-outline", bungie: "planet-outline",
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
  group: {
    gap: 8,
  },
  brand: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  brandText: {
    fontSize: 12,
    fontWeight: "700",
  },
  unlink: {
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  unlinkText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  groupTitle: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
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


// Konten einmal sauber (#527, wie im Web): zwei Gruppen, jedes Konto genau einmal. Ein bestätigtes Konto
// ersetzt den getippten Namen derselben Plattform; was privat ist, schickt der Server gar nicht mit.
export type AccountEntry = {
  platform: string;
  label: string;
  title: string;
  detail: string;
  value: string;
  url: string;
  verified: boolean;
};
export type AccountGroups = { socials: AccountEntry[]; games: AccountEntry[]; verifiedCount: number };
type AccountSource = {
  linked_accounts?: LinkedAccount[] | null;
  verified_platforms?: string[] | null;
  socials?: Array<{ platform?: string | null; value?: string | null; url?: string | null }> | null;
} & Record<string, unknown>;

const SOCIAL_PLATFORMS = ["discord", "twitch", "youtube", "instagram", "tiktok", "x", "github", "kick", "reddit", "spotify", "threads", "facebook", "linkedin", "snapchat", "pinterest", "telegram", "website"];
const GAME_PLATFORMS = ["steam", "epic", "psn", "xbox", "nintendo", "ea", "riot", "battlenet", "faceit", "startgg", "roblox", "osu", "lichess", "wargaming", "bungie"];
const MANUAL_FIELDS: Record<string, string> = {
  discord: "discord_name", twitch: "twitch_handle", youtube: "youtube_handle", instagram: "instagram_handle",
  tiktok: "tiktok_handle", x: "x_handle", website: "website", steam: "steam_id", epic: "epic_id", psn: "psn_id",
  xbox: "xbox_id", nintendo: "nintendo_fc", ea: "ea_id", riot: "riot_id", battlenet: "battlenet_id",
  faceit: "faceit_handle", startgg: "startgg_handle", roblox: "roblox_handle", osu: "osu_handle", lichess: "lichess_handle", github: "github_handle", kick: "kick_handle", reddit: "reddit_handle", spotify: "spotify_handle",
  threads: "threads_handle", facebook: "facebook_handle", linkedin: "linkedin_handle", snapchat: "snapchat_handle", pinterest: "pinterest_handle", telegram: "telegram_handle", wargaming: "wargaming_handle", bungie: "bungie_handle",
};

function cleanHandle(value?: unknown): string {
  return String(value || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?/i, "").replace(/^twitch\.tv\//i, "").split(/[/?#]/)[0];
}

function manualUrl(platform: string, value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (platform === "website") return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (/^https?:\/\//i.test(raw) && platform !== "xbox") return raw;
  const handle = cleanHandle(raw);
  if (platform === "twitch") return `https://www.twitch.tv/${handle}`;
  if (platform === "youtube") return `https://www.youtube.com/@${handle}`;
  if (platform === "instagram") return `https://www.instagram.com/${handle}`;
  if (platform === "tiktok") return `https://www.tiktok.com/@${handle}`;
  if (platform === "x") return `https://x.com/${handle}`;
  if (platform === "steam") return /^\d{17}$/.test(handle) ? `https://steamcommunity.com/profiles/${handle}` : `https://steamcommunity.com/id/${handle}`;
  if (platform === "xbox") return `https://www.xbox.com/play/user/${encodeURIComponent(raw)}`;
  if (platform === "faceit") return `https://www.faceit.com/en/players/${handle}`;
  if (platform === "lichess") return `https://lichess.org/@/${handle}`;
  if (platform === "github") return `https://github.com/${handle}`;
  if (platform === "kick") return `https://kick.com/${handle}`;
  if (platform === "reddit") return `https://www.reddit.com/user/${handle}`;
  if (platform === "threads") return `https://www.threads.com/@${handle}`;
  if (platform === "facebook") return `https://www.facebook.com/${handle}`;
  if (platform === "linkedin") return `https://www.linkedin.com/in/${handle}`;
  if (platform === "snapchat") return `https://www.snapchat.com/add/${handle}`;
  if (platform === "pinterest") return `https://www.pinterest.com/${handle}/`;
  if (platform === "telegram") return `https://t.me/${handle}`;
  return "";
}

function linkedEntry(account: LinkedAccount): AccountEntry {
  return {
    platform: platformKey(account.platform), label: platformLabel(account), title: accountTitle(account), detail: accountDetail(account),
    value: account.handle || account.display_name || "", url: account.url || "", verified: true,
  };
}

function manualEntry(platform: string, raw: unknown, verified: string[] | null | undefined): AccountEntry | null {
  let value = String(raw || "").trim();
  if (platform === "website") value = value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  else if (SOCIAL_PLATFORMS.includes(platform)) value = cleanHandle(raw);
  if (!value) return null;
  const label = PLATFORM_LABELS[platform] || platform;
  return { platform, label, title: value, detail: label, value, url: manualUrl(platform, String(raw || "")), verified: isVerified(verified, platform) };
}

export function accountGroups(profile: AccountSource | null | undefined): AccountGroups {
  if (!profile) return { socials: [], games: [], verifiedCount: 0 };
  const linked = new Map<string, AccountEntry>();
  for (const account of Array.isArray(profile.linked_accounts) ? profile.linked_accounts : []) {
    if (account && account.platform) linked.set(platformKey(account.platform), linkedEntry(account));
  }
  const build = (platforms: string[]) => platforms
    .map((platform) => (linked.has(platform) ? linked.get(platform) : manualEntry(platform, profile[MANUAL_FIELDS[platform]], profile.verified_platforms)))
    .filter((entry): entry is AccountEntry => Boolean(entry));
  const socials = build(SOCIAL_PLATFORMS);
  const games = build(GAME_PLATFORMS);
  const seen = new Set([...socials, ...games].map((entry) => `${entry.platform}:${(entry.url || entry.value).toLowerCase()}`));
  for (const social of profile.socials || []) {
    const platform = platformKey(social.platform);
    const value = String(social.value || social.url || "");
    if (!value || linked.has(platform)) continue;
    const url = String(social.url || manualUrl(platform, social.value ? String(social.value) : "") || (/^https?:\/\//i.test(value) ? value : ""));
    const dedupe = `${platform}:${(url || value).toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const label = PLATFORM_LABELS[platform] || String(social.platform || "Link");
    socials.push({ platform, label, title: cleanHandle(value) || value, detail: label, value, url, verified: false });
  }
  for (const [platform, entry] of linked) {
    if (!SOCIAL_PLATFORMS.includes(platform) && !GAME_PLATFORMS.includes(platform)) socials.push(entry);
  }
  return { socials, games, verifiedCount: [...socials, ...games].filter((entry) => entry.verified).length };
}

function AccountRow({ entry }: { entry: AccountEntry }) {
  const color = platformColor(entry.platform);
  const open = () => {
    if (entry.url) Linking.openURL(entry.url).catch(() => {});
  };
  return (
    <Pressable
      testID={`profile-account-${entry.platform}`}
      accessibilityRole={entry.url ? "link" : "text"}
      accessibilityLabel={`${entry.title}, ${entry.detail}${entry.verified ? ", verifiziert" : ""}`}
      onPress={open}
      disabled={!entry.url}
      style={({ pressed }) => [styles.row, { borderColor: entry.verified ? color : "rgba(255,255,255,0.12)" }, pressed && styles.pressed]}
    >
      <View style={[styles.icon, { borderColor: color }]}>
        <Ionicons name={platformIcon(entry.platform)} color={color} size={18} />
      </View>
      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <Body style={styles.strong} numberOfLines={1}>{entry.title}</Body>
          {entry.verified ? (
            <View testID={`profile-account-${entry.platform}-verified`} accessibilityLabel="verifiziert">
              <Ionicons name="checkmark-circle" color={VERIFIED_COLOR} size={16} />
            </View>
          ) : null}
        </View>
        <Muted numberOfLines={1}>{entry.detail}</Muted>
      </View>
      {entry.url ? <Ionicons name="open-outline" color={colors.muted} size={17} /> : null}
    </Pressable>
  );
}

export function AccountsCard({ groups, testID = "public-profile-accounts" }: { groups: AccountGroups; testID?: string }) {
  if (!groups.socials.length && !groups.games.length) return null;
  return (
    <View testID={testID}>
      <Card style={styles.card}>
        <View style={styles.titleRow}>
          <Ionicons name="globe-outline" color={colors.cyan} size={16} />
          <Heading>Konten</Heading>
        </View>
        <Muted>Mit Haken: per Anmeldung bei der Plattform bestätigt – der Link führt zum echten Konto.</Muted>
        {groups.socials.length ? (
          <View style={styles.group} testID="public-profile-socials">
            <Muted style={styles.groupTitle}>Socials</Muted>
            {groups.socials.map((entry) => <AccountRow key={`${entry.platform}:${entry.value}`} entry={entry} />)}
          </View>
        ) : null}
        {groups.games.length ? (
          <View style={styles.group} testID="public-profile-gaming-ids">
            <Muted style={styles.groupTitle}>Spielkonten</Muted>
            {groups.games.map((entry) => <AccountRow key={`${entry.platform}:${entry.value}`} entry={entry} />)}
          </View>
        ) : null}
      </Card>
    </View>
  );
}


// Konten verknüpfen (#521): je verknüpfbarer Plattform eine Zeile - verknüpft mit Namen, Häkchen und
// „lösen“; sonst der offizielle Knopf, der den Browser zur Website schickt (der Rückruf der Plattform
// braucht den Browser). Was die Website nicht eingerichtet hat, bleibt Tipparbeit.
export const LINKABLE_PLATFORMS = ["discord", "twitch", "steam", "battlenet", "x", "youtube", "tiktok", "riot", "xbox", "epic", "faceit", "startgg", "roblox", "osu", "lichess", "github", "kick", "reddit", "spotify", "threads", "facebook", "linkedin", "snapchat", "pinterest", "telegram", "wargaming", "bungie"];
export const BRAND_BUTTONS: Record<string, { bg: string; fg: string; border?: string }> = {
  discord: { bg: "#5865F2", fg: "#FFFFFF" }, twitch: { bg: "#9146FF", fg: "#FFFFFF" }, steam: { bg: "#171A21", fg: "#FFFFFF", border: "#66C0F4" },
  battlenet: { bg: "#148EFF", fg: "#FFFFFF" }, x: { bg: "#000000", fg: "#FFFFFF", border: "#FFFFFF" }, youtube: { bg: "#FF0000", fg: "#FFFFFF" },
  tiktok: { bg: "#000000", fg: "#FFFFFF", border: "#69C9D0" }, riot: { bg: "#D13639", fg: "#FFFFFF" }, xbox: { bg: "#107C10", fg: "#FFFFFF" },
  epic: { bg: "#2F2F2F", fg: "#FFFFFF", border: "#C8C8C8" },
  faceit: { bg: "#FF5500", fg: "#FFFFFF" },
  startgg: { bg: "#3F80FF", fg: "#FFFFFF" },
  roblox: { bg: "#000000", fg: "#FFFFFF", border: "#FFFFFF" },
  osu: { bg: "#FF66AA", fg: "#FFFFFF" },
  lichess: { bg: "#161512", fg: "#FFFFFF", border: "#BABABA" },
  github: { bg: "#24292F", fg: "#FFFFFF", border: "#57606A" },
  kick: { bg: "#53FC18", fg: "#000000" },
  reddit: { bg: "#FF4500", fg: "#FFFFFF" },
  spotify: { bg: "#1DB954", fg: "#000000" },
  threads: { bg: "#000000", fg: "#FFFFFF", border: "#FFFFFF" },
  facebook: { bg: "#1877F2", fg: "#FFFFFF" },
  linkedin: { bg: "#0A66C2", fg: "#FFFFFF" },
  snapchat: { bg: "#FFFC00", fg: "#000000" },
  pinterest: { bg: "#E60023", fg: "#FFFFFF" },
  telegram: { bg: "#26A5E4", fg: "#FFFFFF" },
  wargaming: { bg: "#2B2B2B", fg: "#FFFFFF", border: "#D4A017" },
  bungie: { bg: "#1B2A4A", fg: "#FFFFFF", border: "#3B82F6" },
};

export function linkButtonLabel(platform: string): string {
  const label = PLATFORM_LABELS[platform] || platform;
  return platform === "steam" ? `Mit ${label} anmelden` : `Mit ${label} verknüpfen`;
}

export function PlatformLinkRows({ links, available, onLink, onUnlink, disabled = [], testID = "profile-link-rows" }: {
  links: LinkedAccount[];
  available: Record<string, boolean>;
  onLink: (platform: string) => void;
  onUnlink: (platform: string) => void;
  disabled?: string[];
  testID?: string;
}) {
  const byPlatform = new Map(links.filter((row) => row && row.platform).map((row) => [platformKey(row.platform), row]));
  // Abgehakt vom Verein (#558): die Plattform erscheint nirgends.
  const off = new Set(disabled || []);
  return (
    <View testID={testID} style={styles.group}>
      {LINKABLE_PLATFORMS.filter((platform) => !off.has(platform)).map((platform) => {
        const link = byPlatform.get(platform) || null;
        const color = platformColor(platform);
        const label = PLATFORM_LABELS[platform] || platform;
        const brand = BRAND_BUTTONS[platform] || { bg: colors.cyan, fg: "#000000" };
        return (
          <View key={platform} testID={`profile-link-${platform}`} style={[styles.row, { borderColor: link ? color : "rgba(255,255,255,0.12)" }]}>
            <View style={[styles.icon, { borderColor: color }]}>
              <Ionicons name={platformIcon(platform)} color={color} size={18} />
            </View>
            <View style={styles.flex}>
              <View style={styles.nameRow}>
                <Body style={styles.strong} numberOfLines={1}>{label}</Body>
                {link ? (
                  <View testID={`profile-link-${platform}-verified`} accessibilityLabel="verifiziert">
                    <Ionicons name="checkmark-circle" color={VERIFIED_COLOR} size={16} />
                  </View>
                ) : null}
              </View>
              <Muted numberOfLines={1}>
                {link ? `verknüpft als ${accountTitle(link)}${link.linked_at ? ` · seit ${formatDate(link.linked_at)}` : ""}`
                  : available[platform] ? "nicht verknüpft – einmal im Browser anmelden" : "auf der Website noch nicht eingerichtet"}
              </Muted>
            </View>
            {link ? (
              <Pressable onPress={() => onUnlink(platform)} accessibilityRole="button" testID={`profile-link-${platform}-unlink`} style={({ pressed }) => [styles.unlink, pressed && styles.pressed]}>
                <Muted style={styles.unlinkText}>lösen</Muted>
              </Pressable>
            ) : available[platform] ? (
              <Pressable onPress={() => onLink(platform)} accessibilityRole="button" testID={`profile-link-${platform}-link`}
                style={({ pressed }) => [styles.brand, { backgroundColor: brand.bg, borderColor: brand.border || brand.bg }, pressed && styles.pressed]}>
                <Ionicons name={platformIcon(platform)} color={brand.fg} size={15} />
                <Body style={[styles.brandText, { color: brand.fg }]}>{linkButtonLabel(platform)}</Body>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
