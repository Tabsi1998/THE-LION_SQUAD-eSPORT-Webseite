import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatStatus } from "../../lib/format";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

type Props = NativeStackScreenProps<MoreStackParamList, "PublicProfile">;
type TabKey = "overview" | "achievements" | "tournaments" | "fastlaps" | "teams";

type PublicProfilePayload = {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  bio?: string | null;
  role?: string | null;
  created_at?: string | null;
  birth_date?: string | null;
  country?: string | null;
  city?: string | null;
  discord_name?: string | null;
  twitch_handle?: string | null;
  youtube_handle?: string | null;
  instagram_handle?: string | null;
  x_handle?: string | null;
  steam_id?: string | null;
  epic_id?: string | null;
  psn_id?: string | null;
  xbox_id?: string | null;
  nintendo_fc?: string | null;
  ea_id?: string | null;
  riot_id?: string | null;
  battlenet_id?: string | null;
  website?: string | null;
  main_platform?: string | null;
  main_platforms?: string[];
  input_devices?: string[];
  gaming_subscriptions?: string[] | string | null;
  favorite_games?: string[];
  is_club_member?: boolean;
  user_type?: string;
  membership?: Record<string, unknown> | null;
  socials?: Array<{ platform?: string; value?: string; url?: string }>;
  can_message?: boolean;
  stats?: Record<string, number | string | undefined>;
  achievement_level?: { level?: number; title?: string; points?: number; progress?: number };
  badges?: any[];
  tournaments?: any[];
  f1_bests?: any[];
  teams?: any[];
};

type AchievementPayload = { awards?: any[]; groups?: any[] };

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Übersicht" },
  { key: "achievements", label: "Erfolge" },
  { key: "tournaments", label: "Turniere" },
  { key: "fastlaps", label: "Fast Laps" },
  { key: "teams", label: "Teams" },
];

export function PublicProfileScreen({ navigation, route }: Props) {
  const [profile, setProfile] = useState<PublicProfilePayload | null>(null);
  const [achievements, setAchievements] = useState<AchievementPayload>({ awards: [], groups: [] });
  const [tab, setTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<PublicProfilePayload>(`/users/public/${route.params.username}`);
      setProfile(data || null);
      if (data?.id) {
        const achievementResult = await api.get<AchievementPayload>(`/achievements/user/${data.id}`).catch(() => ({ data: { awards: [], groups: [] } }));
        setAchievements(achievementResult.data || { awards: [], groups: [] });
      } else {
        setAchievements({ awards: [], groups: [] });
      }
    } catch (err) {
      setProfile(null);
      setError(errorMessage(err, "Profil konnte nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [route.params.username]);

  useEffect(() => {
    load();
  }, [load]);

  const socialLinks = useMemo(() => publicSocialLinks(profile), [profile]);
  const gamingIds = useMemo(() => publicGamingIds(profile), [profile]);
  const stats = profile?.stats || {};
  const display = profile?.display_name || profile?.username || "Spieler";

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={4} hasImage={false} />
      </Screen>
    );
  }

  if (!profile) {
    return (
      <Screen>
        <EmptyState title="Profil nicht sichtbar" detail={error || "Dieses Profil ist privat oder wurde entfernt."} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
      >
        <View style={styles.hero}>
          <MediaImage
            uri={profile.banner_url}
            style={styles.banner}
            fallback={<Ionicons name="person-circle-outline" color={colors.cyan} size={52} />}
          />
          <View style={styles.heroShade} />
          <View style={styles.identityCard}>
            <MediaImage
              uri={profile.avatar_url}
              style={styles.avatar}
              fallback={<Body style={styles.avatarText}>{display.slice(0, 1).toUpperCase()}</Body>}
            />
            <View style={styles.identityText}>
              <Muted>@{profile.username}</Muted>
              <Title>{display}</Title>
              <View style={styles.wrap}>
                <Pill label={profile.is_club_member ? "Vereinsmitglied" : "Community"} tone={profile.is_club_member ? "success" : "cyan"} />
                <Pill label={profile.achievement_level?.title || `Level ${profile.achievement_level?.level || stats.level || 1}`} tone="gold" />
                {profile.role && profile.role !== "player" ? <Pill label={formatStatus(profile.role)} /> : null}
              </View>
              {profile.can_message ? (
                <Pressable onPress={() => navigation.navigate("DirectThread", { userId: profile.id, title: display })} style={({ pressed }) => [styles.messageButton, pressed && styles.pressed]}>
                  <Ionicons name="chatbubble-ellipses-outline" color={colors.black} size={16} />
                  <Body style={styles.messageButtonText}>Nachricht</Body>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabs.map((item) => (
            <Pressable key={item.key} onPress={() => setTab(item.key)} style={[styles.tab, tab === item.key && styles.tabActive]}>
              <Muted style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Muted>
            </Pressable>
          ))}
        </ScrollView>

        {tab === "overview" ? (
          <>
            <Card style={styles.card}>
              <Heading>Spielerprofil</Heading>
              {profile.bio ? <Body>{profile.bio}</Body> : <Muted>Keine Bio freigegeben.</Muted>}
              <View style={styles.statGrid}>
                <Stat label="Punkte" value={stats.points ?? profile.achievement_level?.points ?? 0} tone="gold" />
                <Stat label="Erfolge" value={achievements.awards?.length ?? profile.badges?.length ?? 0} />
                <Stat label="Turniere" value={stats.tournaments ?? profile.tournaments?.length ?? 0} />
                <Stat label="Siege" value={stats.wins ?? 0} tone="gold" />
                <Stat label="Podien" value={stats.top3 ?? 0} />
                <Stat label="Fast Laps" value={stats.fast_laps ?? profile.f1_bests?.length ?? 0} />
              </View>
            </Card>

            <InfoGrid
              title="Öffentliche Infos"
              rows={[
                ["Mitglied seit", formatDate(profile.created_at)],
                ["Geburtstag", profile.birth_date ? formatDate(profile.birth_date) : ""],
                ["Ort", [profile.city, profile.country].filter(Boolean).join(", ")],
                ["Mitgliedschaft", membershipLabel(profile)],
              ]}
            />

            <InfoGrid
              title="Gaming Setup"
              rows={[
                ["Lieblingsspiele", (profile.favorite_games || []).join(", ")],
                ["Plattformen", listValue(profile.main_platforms?.length ? profile.main_platforms : profile.main_platform)],
                ["Eingabe", listValue(profile.input_devices)],
                ["Abos", listValue(profile.gaming_subscriptions)],
              ]}
            />

            {socialLinks.length || gamingIds.length ? (
              <Card style={styles.card}>
                <Heading>Socials & IDs</Heading>
                {socialLinks.map((link) => (
                  <Pressable key={`${link.label}:${link.value}`} onPress={() => link.url ? Linking.openURL(link.url).catch(() => {}) : undefined} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
                    <View style={styles.linkIcon}>
                      <Ionicons name={iconForSocial(link.label)} color={colors.cyan} size={17} />
                    </View>
                    <View style={styles.flex}>
                      <Body style={styles.strong}>{link.label}</Body>
                      <Muted>{link.value}</Muted>
                    </View>
                    {link.url ? <Ionicons name="open-outline" color={colors.muted} size={17} /> : null}
                  </Pressable>
                ))}
                {gamingIds.map((entry) => (
                  <View key={entry.label} style={styles.linkRow}>
                    <View style={styles.linkIcon}>
                      <Ionicons name="game-controller-outline" color={colors.gold} size={17} />
                    </View>
                    <View style={styles.flex}>
                      <Body style={styles.strong}>{entry.label}</Body>
                      <Muted>{entry.value}</Muted>
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        ) : null}

        {tab === "achievements" ? <AchievementsTab awards={achievements.awards || profile.badges || []} groups={achievements.groups || []} /> : null}
        {tab === "tournaments" ? <TournamentTab items={profile.tournaments || []} onOpen={(item) => navigation.getParent()?.navigate("Tournaments", { screen: "TournamentDetail", params: { id: item.slug || item.id } })} /> : null}
        {tab === "fastlaps" ? <FastLapTab items={profile.f1_bests || []} onOpen={(item) => navigation.getParent()?.navigate("Tournaments", { screen: "FastLapDetail", params: { id: item.challenge?.slug || item.challenge?.id } })} /> : null}
        {tab === "teams" ? <TeamTab items={profile.teams || []} onOpen={(item) => navigation.getParent()?.navigate("Teams", { screen: "TeamDetail", params: { id: item.id } })} /> : null}
      </ScrollView>
    </Screen>
  );
}

function AchievementsTab({ awards, groups }: { awards: any[]; groups: any[] }) {
  const flatAwards = awards.length ? awards : groups.flatMap((group) => (group.tiers || []).filter((tier: any) => tier.earned).map((tier: any) => ({ ...tier, group_name: group.name, group_accent: group.accent_color })));
  if (!flatAwards.length) {
    return <EmptyState title="Keine Erfolge" detail="Dieses Profil hat noch keine sichtbaren Achievements." />;
  }
  return (
    <View style={styles.list}>
      {flatAwards.map((award, index) => {
        const accent = award.level_color || award.group_accent || colors.gold;
        return (
          <Card key={award.code || `${award.name}-${index}`} style={[styles.card, { borderColor: `${accent}66` }]}>
            <View style={styles.cardTop}>
              <View style={[styles.awardIcon, { borderColor: `${accent}77`, backgroundColor: `${accent}18` }]}>
                <Ionicons name="medal-outline" color={accent} size={20} />
              </View>
              <View style={styles.flex}>
                <Muted style={[styles.tiny, { color: accent }]}>{award.level_name || award.group_name || "Achievement"}</Muted>
                <Body style={styles.strong}>{award.name}</Body>
                {award.description ? <Muted>{award.description}</Muted> : null}
              </View>
              <Muted style={styles.points}>+{award.points || 0}</Muted>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function TournamentTab({ items, onOpen }: { items: any[]; onOpen: (item: any) => void }) {
  if (!items.length) return <EmptyState title="Keine Turniere" detail="Keine öffentliche Turnierhistorie sichtbar." />;
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <Pressable key={item.id} onPress={() => onOpen(item)} style={({ pressed }) => [pressed && styles.pressed]}>
          <Card style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.flex}>
                <Muted>{item.game?.display_name || item.game?.name || item.game_name || "Turnier"}</Muted>
                <Heading>{item.title}</Heading>
                <Muted>{formatDate(item.start_date)} · {formatStatus(item.status || item.registration_status)}</Muted>
              </View>
              <Rank rank={item.final_position} />
            </View>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

function FastLapTab({ items, onOpen }: { items: any[]; onOpen: (item: any) => void }) {
  if (!items.length) return <EmptyState title="Keine Fast-Lap-Zeiten" detail="Keine öffentlichen Fast-Lap-Bestzeiten sichtbar." />;
  return (
    <View style={styles.list}>
      {items.map((item, index) => (
        <Pressable key={`${item.challenge?.id || "fastlap"}-${item.track?.id || index}`} onPress={() => item.challenge?.id ? onOpen(item) : undefined} style={({ pressed }) => [pressed && styles.pressed]}>
          <Card style={[styles.card, item.is_leader && styles.leaderCard]}>
            <View style={styles.cardTop}>
              <View style={styles.flex}>
                <Muted>{item.challenge?.title || "Fast Lap"}</Muted>
                <Heading>{[item.track?.name, item.track?.country].filter(Boolean).join(" · ") || "Strecke"}</Heading>
                <Muted>{item.is_leader ? "Pole Position" : "Bestzeit"}</Muted>
              </View>
              <Body style={[styles.time, item.is_leader && styles.gold]}>{item.time_str || "-"}</Body>
            </View>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

function TeamTab({ items, onOpen }: { items: any[]; onOpen: (item: any) => void }) {
  if (!items.length) return <EmptyState title="Keine Teams" detail="Keine öffentlichen Teamdaten sichtbar." />;
  return (
    <View style={styles.list}>
      {items.map((team) => (
        <Pressable key={team.id} onPress={() => onOpen(team)} style={({ pressed }) => [pressed && styles.pressed]}>
          <Card style={styles.card}>
            <View style={styles.teamRow}>
              <MediaImage
                uri={team.logo_url}
                style={styles.teamLogo}
                fallback={<Body style={styles.avatarText}>{(team.tag || team.name || "?").slice(0, 2).toUpperCase()}</Body>}
              />
              <View style={styles.flex}>
                <Muted>{team.tag ? `[${team.tag}]` : "Team"}</Muted>
                <Heading>{team.name}</Heading>
                {team.description ? <Muted numberOfLines={2}>{team.description}</Muted> : null}
              </View>
              <Ionicons name="chevron-forward" color={colors.muted} size={18} />
            </View>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

function InfoGrid({ title, rows }: { title: string; rows: Array<[string, unknown]> }) {
  const visible = rows.filter(([, value]) => String(value || "").trim());
  if (!visible.length) return null;
  return (
    <Card style={styles.card}>
      <Heading>{title}</Heading>
      <View style={styles.infoGrid}>
        {visible.map(([label, value]) => (
          <View key={label} style={styles.infoCell}>
            <Muted>{label}</Muted>
            <Body style={styles.strong}>{String(value)}</Body>
          </View>
        ))}
      </View>
    </Card>
  );
}

function Stat({ label, value, tone = "cyan" }: { label: string; value: unknown; tone?: "cyan" | "gold" }) {
  return (
    <View style={styles.stat}>
      <Body style={[styles.statValue, tone === "gold" && styles.gold]}>{String(value ?? 0)}</Body>
      <Muted>{label}</Muted>
    </View>
  );
}

function Rank({ rank }: { rank?: number | null }) {
  return (
    <View style={styles.rank}>
      <Body style={[styles.rankText, Number(rank || 0) <= 3 && rank ? styles.gold : null]}>{rank ? `#${rank}` : "-"}</Body>
      <Muted>Rang</Muted>
    </View>
  );
}

function Pill({ label, tone = "default" }: { label: string; tone?: "default" | "cyan" | "gold" | "success" }) {
  return (
    <View style={[styles.pill, tone === "cyan" && styles.pillCyan, tone === "gold" && styles.pillGold, tone === "success" && styles.pillSuccess]}>
      <Muted style={[styles.pillText, tone === "cyan" && styles.textCyan, tone === "gold" && styles.textGold, tone === "success" && styles.textSuccess]}>{label}</Muted>
    </View>
  );
}

function publicSocialLinks(profile: PublicProfilePayload | null) {
  if (!profile) return [];
  const base = [
    profile.discord_name && { label: "Discord", value: profile.discord_name, url: "" },
    profile.twitch_handle && { label: "Twitch", value: cleanHandle(profile.twitch_handle), url: `https://www.twitch.tv/${cleanHandle(profile.twitch_handle)}` },
    profile.youtube_handle && { label: "YouTube", value: cleanHandle(profile.youtube_handle), url: socialUrl("youtube", profile.youtube_handle) },
    profile.instagram_handle && { label: "Instagram", value: cleanHandle(profile.instagram_handle), url: socialUrl("instagram", profile.instagram_handle) },
    profile.x_handle && { label: "X", value: cleanHandle(profile.x_handle), url: socialUrl("x", profile.x_handle) },
    profile.website && { label: "Website", value: profile.website, url: externalUrl(profile.website) },
  ].filter(Boolean) as Array<{ label: string; value: string; url?: string }>;
  const extra = (profile.socials || []).map((social) => ({
    label: social.platform || "Link",
    value: social.value || social.url || "",
    url: social.url || socialUrl(social.platform, social.value),
  })).filter((social) => social.value);
  const seen = new Set<string>();
  return [...base, ...extra].filter((link) => {
    const key = `${link.label}:${link.value}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function publicGamingIds(profile: PublicProfilePayload | null) {
  if (!profile) return [];
  return [
    ["Steam", profile.steam_id],
    ["Epic", profile.epic_id],
    ["PSN", profile.psn_id],
    ["Xbox", profile.xbox_id],
    ["Nintendo", profile.nintendo_fc],
    ["EA", profile.ea_id],
    ["Riot", profile.riot_id],
    ["Battle.net", profile.battlenet_id],
  ].filter(([, value]) => value).map(([label, value]) => ({ label: String(label), value: String(value) }));
}

function cleanHandle(value?: string | null) {
  return String(value || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?/i, "").replace(/^twitch\.tv\//i, "").split(/[/?#]/)[0];
}

function externalUrl(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function socialUrl(platform?: string | null, value?: string | null) {
  const kind = String(platform || "").toLowerCase();
  const handle = cleanHandle(value);
  if (!handle) return "";
  if (kind.includes("youtube")) return `https://www.youtube.com/@${handle}`;
  if (kind.includes("instagram")) return `https://www.instagram.com/${handle}`;
  if (kind === "x" || kind.includes("twitter")) return `https://x.com/${handle}`;
  if (kind.includes("twitch")) return `https://www.twitch.tv/${handle}`;
  return /^https?:\/\//i.test(String(value || "")) ? externalUrl(value) : "";
}

function listValue(value?: string[] | string | null) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value || "");
}

function membershipLabel(profile: PublicProfilePayload) {
  const membershipType = String(profile.membership?.membership_type || "").replace(/_/g, " ");
  if (membershipType) return membershipType;
  return profile.is_club_member ? "Vereinsmitglied" : "";
}

function iconForSocial(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("discord")) return "chatbubble-ellipses-outline";
  if (lower.includes("twitch")) return "radio-outline";
  if (lower.includes("youtube")) return "logo-youtube";
  if (lower.includes("instagram")) return "logo-instagram";
  if (lower === "x" || lower.includes("twitter")) return "logo-twitter";
  return "link-outline";
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 34,
  },
  hero: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  banner: {
    borderWidth: 0,
    height: 172,
    width: "100%",
  },
  heroShade: {
    backgroundColor: "rgba(0,0,0,0.28)",
    height: 172,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  identityCard: {
    alignItems: "flex-end",
    backgroundColor: "rgba(10,10,10,0.92)",
    flexDirection: "row",
    gap: 12,
    marginTop: -36,
    padding: 14,
  },
  avatar: {
    borderColor: colors.cyan,
    borderRadius: 12,
    borderWidth: 2,
    height: 74,
    width: 74,
  },
  avatarText: {
    color: colors.cyan,
    fontSize: 22,
    fontWeight: "900",
  },
  identityText: {
    flex: 1,
    gap: 5,
  },
  tabs: {
    gap: 8,
    paddingRight: 18,
  },
  tab: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.42)",
  },
  tabText: {
    fontWeight: "900",
  },
  tabTextActive: {
    color: colors.cyan,
  },
  card: {
    gap: 10,
  },
  cardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  list: {
    gap: 12,
  },
  flex: {
    flex: 1,
    gap: 2,
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  stat: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: "30%",
    padding: 10,
  },
  statValue: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: "900",
  },
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  infoCell: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: "44%",
    padding: 10,
  },
  linkRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 5,
  },
  messageButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.cyan,
    borderRadius: 7,
    flexDirection: "row",
    gap: 7,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  messageButtonText: {
    color: colors.black,
    fontWeight: "900",
  },
  linkIcon: {
    alignItems: "center",
    backgroundColor: "rgba(41,182,232,0.12)",
    borderColor: "rgba(41,182,232,0.3)",
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  awardIcon: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  leaderCard: {
    borderColor: "rgba(255,215,0,0.42)",
  },
  teamRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  teamLogo: {
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  pill: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillCyan: {
    backgroundColor: "rgba(41,182,232,0.14)",
    borderColor: "rgba(41,182,232,0.35)",
  },
  pillGold: {
    backgroundColor: "rgba(255,215,0,0.12)",
    borderColor: "rgba(255,215,0,0.32)",
  },
  pillSuccess: {
    backgroundColor: "rgba(0,255,136,0.12)",
    borderColor: "rgba(0,255,136,0.32)",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "900",
  },
  rank: {
    alignItems: "flex-end",
    minWidth: 54,
  },
  rankText: {
    color: colors.cyan,
    fontSize: 22,
    fontWeight: "900",
  },
  time: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: "900",
  },
  tiny: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  strong: {
    fontWeight: "900",
  },
  points: {
    color: colors.gold,
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
  },
  textCyan: {
    color: colors.cyan,
  },
  textGold: {
    color: colors.gold,
  },
  textSuccess: {
    color: colors.success,
  },
  pressed: {
    opacity: 0.72,
  },
});
