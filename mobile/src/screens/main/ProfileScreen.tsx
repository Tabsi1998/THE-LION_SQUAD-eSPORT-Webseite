import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Alert, Image, Linking, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, TextInput, View } from "react-native";
import { ActionRow, ActionTile } from "../../components/ActionRow";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { AwardCard } from "../../components/AwardCard";
import { LINKABLE_PLATFORMS, PlatformLinkRows, type LinkedAccount } from "../../components/LinkedAccounts";
import { BlockedUsersCard } from "../../components/BlockedUsersCard";
import { FriendsCard } from "../../components/FriendsCard";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { availabilityText } from "../../lib/appLock";
import { useAppLock } from "../../lock/AppLockProvider";
import { api, errorMessage, resolveMediaUrl } from "../../lib/api";
import { AchievementGroupCard } from "../../components/AchievementGroupCard";
import { FadeIn, staggerDelay } from "../../components/FadeIn";
import { type AchievementGroup, achievementIcon } from "../../lib/achievements";
import { sortAwards, type Award } from "../../lib/awards";
import { API_BASE_URL } from "../../config";

// Der eigene Stand bei der Moderation (#416): nur lesen; Einspruch und Verlauf liegen im Web.
type ModerationStanding = {
  strike_count: number;
  strike_ttl_months: number;
  active: null | { action: string; label: string; reason?: string | null; chat_blocked_until?: string | null; open_until_decision?: boolean; created_at?: string };
};
const WEB_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");
import { displayName, formatDate, formatStatus } from "../../lib/format";
import { isGuestUser } from "../../live";
import { colors } from "../../theme";
import type { PersonalReferenceData, PersonalReferenceItem, PrizePickup } from "../../types";

type TabKey = "overview" | "references" | "awards" | "prizes" | "edit" | "achievements" | "privacy" | "notifications";
type AchievementData = { groups?: AchievementGroup[]; awards?: any[] };

// Reiter nur für Inhalt. Bearbeiten erreicht man über die Aktionszeile,
// Privatsphäre und Benachrichtigungen über das Zahnrad (#213). Vorher standen
// hier sieben Reiter unter sieben Kacheln, vier davon doppelt.
const tabs: Array<{ key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "overview", label: "Übersicht", icon: "person-circle-outline" },
  { key: "references", label: "Referenzen", icon: "ribbon-outline" },
  // Auszeichnungen (#230, Nachtrag): Banner und Trophäen sind keine Referenzen - eigener Reiter.
  { key: "awards", label: "Auszeichnungen", icon: "medal-outline" },
  { key: "prizes", label: "Gewinne", icon: "gift-outline" },
  { key: "achievements", label: "Erfolge", icon: "trophy-outline" },
];
const SETTINGS_TABS: TabKey[] = ["privacy", "notifications"];

const notificationChannels: Array<{ key: string; label: string; detail: string }> = [
  { key: "email", label: "E-Mail", detail: "Nur wichtige optionale Hinweise per Mail." },
  { key: "push", label: "Push", detail: "System-Benachrichtigungen am Handy." },
  { key: "in_app", label: "In-App", detail: "Hinweise in App, Web und Notification-Center." },
];

const notificationLabels: Array<{ key: string; label: string; detail: string }> = [
  { key: "match_reminders", label: "Spiel-Erinnerungen", detail: "Startzeiten, Check-in und Match-Hub." },
  { key: "tournament_updates", label: "Turnier-Updates", detail: "Anmeldungen, Status und Ergebnisse." },
  { key: "prize_updates", label: "Gewinne", detail: "Gewinn bereit, Übergabe und Fristen." },
  { key: "membership_updates", label: "Mitgliedschaft", detail: "Bewerbung, Status und Vereinsvorteile." },
  { key: "birthday_greetings", label: "Geburtstag", detail: "Geburtstagsgruß vom Verein." },
  { key: "community_messages", label: "Community", detail: "Direktnachrichten und Erwähnungen." },
  { key: "news_events", label: "News & Events", detail: "Vereinsnews, Events und Ankündigungen." },
  { key: "club_internal", label: "Vereinsintern", detail: "Interne Events und News nur für Mitglieder." },
];
const notificationPreferenceKey = (channel: string, topic: string) => `${channel}:${topic}`;

const dmOptions = [
  ["everyone", "Alle"],
  ["friends", "Freunde"],
  ["team_members", "Team"],
  ["club_members", "Verein"],
  ["admins_only", "Admins"],
  ["none", "Niemand"],
];


export function ProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user, logout, refreshMe } = useAuth();
  // Konto löschen (#390): derselbe Weg wie auf der Website (Anonymisierung), zweimal bestätigt.
  // Google Play verlangt das in der App, weil man sich hier auch registrieren kann.
  const deleteAccount = () => {
    Alert.alert(
      "Konto löschen?",
      "Dein Konto wird dauerhaft anonymisiert: Name, E-Mail, verknüpfte Konten, Profiltexte und Bilder werden entfernt, Chatnachrichten als gelöscht markiert. Turnier-Ergebnisse bleiben ohne Namen erhalten; Rechnungen bleiben in der Vereinsbuchhaltung, weil das Gesetz es verlangt. Das lässt sich nicht rückgängig machen.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Weiter",
          style: "destructive",
          onPress: () => Alert.alert("Wirklich löschen?", "Danach kannst du dich mit diesem Konto nicht mehr anmelden.", [
            { text: "Abbrechen", style: "cancel" },
            {
              text: "Konto löschen",
              style: "destructive",
              onPress: async () => {
                try {
                  await api.post("/dsgvo/anonymize-me");
                  await logout();
                } catch (error) {
                  Alert.alert("Das hat nicht geklappt", errorMessage(error, "Bitte später noch einmal versuchen oder an dsgvo@lionsquad.at schreiben."));
                }
              },
            },
          ]),
        },
      ],
    );
  };
  const appLock = useAppLock();
  const [tab, setTab] = useState<TabKey>("overview");
  const [achievements, setAchievements] = useState<AchievementData>({ groups: [], awards: [] });
  const [references, setReferences] = useState<PersonalReferenceData>({ items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } });
  // Auszeichnungen (#230): eigene Banner und Trophäen, eine davon als Profilbanner - der Server prüft, dass sie die eigene ist.
  const [awards, setAwards] = useState<{ awards: Award[]; featured_award_id?: string | null }>({ awards: [] });
  const loadAwards = useCallback(() => {
    api.get<{ awards: Award[]; featured_award_id?: string | null }>("/me/awards").then(({ data }) => setAwards(data)).catch(() => {});
  }, []);
  useEffect(() => {
    loadAwards();
  }, [loadAwards]);
  const featureAward = async (id: string | null) => {
    try {
      if (id) await api.post(`/me/awards/${id}/feature`);
      else await api.delete("/me/awards/feature");
      loadAwards();
    } catch {
      // bleibt, wie es war
    }
  };
  const [prizes, setPrizes] = useState<PrizePickup[]>([]);
  const [standing, setStanding] = useState<ModerationStanding | null>(null);
  // Verknüpfte Konten (#459): nur lesen; verknüpfen läuft im Web (Rückruf der Plattform im Browser).
  const [links, setLinks] = useState<LinkedAccount[]>([]);
  // Welche Plattformen die Website eingerichtet hat (#521): nur dort gibt es den Knopf.
  const [linkAvailable, setLinkAvailable] = useState<Record<string, boolean>>({});
  // Abgehakt vom Verein (#558): weder Zeile noch Textfeld.
  const [linkDisabled, setLinkDisabled] = useState<string[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const linkedPlatforms = useMemo(() => new Set(links.map((row) => String(row.platform || "").toLowerCase())), [links]);
  // Getippt wird nur, was keine Anmeldung bietet oder was die Website nicht eingerichtet hat (#521).
  const manualSocialKeys = useMemo(() => {
    const fieldOf: Record<string, string> = { discord: "discord_name", twitch: "twitch_handle", youtube: "youtube_handle", tiktok: "tiktok_handle", x: "x_handle", steam: "steam_id", epic: "epic_id", xbox: "xbox_id", riot: "riot_id", battlenet: "battlenet_id", faceit: "faceit_handle", startgg: "startgg_handle", roblox: "roblox_handle", osu: "osu_handle", lichess: "lichess_handle", github: "github_handle", kick: "kick_handle", reddit: "reddit_handle", spotify: "spotify_handle", threads: "threads_handle", facebook: "facebook_handle", linkedin: "linkedin_handle", snapchat: "snapchat_handle", pinterest: "pinterest_handle", telegram: "telegram_handle", wargaming: "wargaming_handle", bungie: "bungie_handle", mastodon: "mastodon_handle", bluesky: "bluesky_handle" };
    const off = new Set(linkDisabled);
    const manualOf: Record<string, string> = { instagram_handle: "instagram", psn_id: "psn", nintendo_fc: "nintendo", ea_id: "ea" };
    const notReady = LINKABLE_PLATFORMS.filter((platform) => !off.has(platform) && !linkedPlatforms.has(platform) && !linkAvailable[platform]).map((platform) => fieldOf[platform]);
    const manual = ["instagram_handle", "psn_id", "nintendo_fc", "ea_id"].filter((key) => !off.has(manualOf[key]));
    return [...notReady, ...manual, "website"];
  }, [linkAvailable, linkDisabled, linkedPlatforms]);
  const startPlatformLink = useCallback((platform: string) => {
    Linking.openURL(`${WEB_BASE_URL}/profile?tab=socials&link=${encodeURIComponent(platform)}`).catch(() => {});
  }, []);
  const unlinkPlatform = useCallback((platform: string) => {
    Alert.alert("Verknüpfung lösen?", "Der Name bleibt im Profil, das Häkchen „verifiziert“ ist weg.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Lösen", style: "destructive", onPress: () => {
        api.delete(`/me/platform-links/${platform}`)
          .then(() => setLinks((rows) => rows.filter((row) => String(row.platform || "").toLowerCase() !== platform)))
          .catch((err) => Alert.alert("Das hat nicht geklappt", errorMessage(err)));
      } },
    ]);
  }, []);
  const [completeness, setCompleteness] = useState<{ score?: number; missing?: string[] }>({});
  const [form, setForm] = useState<Record<string, any>>({});
  const [profileLoading, setProfileLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"profile" | "settings">("profile");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<(successText?: string) => Promise<void>>(async () => {});

  const guest = isGuestUser(user);
  const activeTab = view === "settings" ? null : tab;

  const resetForm = useCallback(() => {
    const u = (user || {}) as Record<string, any>;
    setForm({
      display_name: u.display_name || "",
      first_name: u.first_name || "",
      last_name: u.last_name || "",
      bio: u.bio || "",
      birth_date: String(u.birth_date || "").slice(0, 10),
      gender: u.gender || "",
      country: u.country || "",
      city: u.city || "",
      avatar_url: u.avatar_url || "",
      banner_url: u.banner_url || "",
      favorite_games: Array.isArray(u.favorite_games) ? u.favorite_games.join(", ") : "",
      main_platform: u.main_platform || "",
      preferred_role: u.preferred_role || "",
      input_device: u.input_device || "",
      discord_name: u.discord_name || "",
      twitch_handle: u.twitch_handle || "",
      youtube_handle: u.youtube_handle || "",
      tiktok_handle: u.tiktok_handle || "",
      instagram_handle: u.instagram_handle || "",
      x_handle: u.x_handle || "",
      steam_id: u.steam_id || "",
      epic_id: u.epic_id || "",
      psn_id: u.psn_id || "",
      xbox_id: u.xbox_id || "",
      nintendo_fc: u.nintendo_fc || u.switch_code || "",
      ea_id: u.ea_id || "",
      riot_id: u.riot_id || "",
      battlenet_id: u.battlenet_id || "",
      faceit_handle: u.faceit_handle || "",
      startgg_handle: u.startgg_handle || "",
      roblox_handle: u.roblox_handle || "",
      osu_handle: u.osu_handle || "",
      lichess_handle: u.lichess_handle || "",
      github_handle: u.github_handle || "",
      kick_handle: u.kick_handle || "",
      reddit_handle: u.reddit_handle || "",
      spotify_handle: u.spotify_handle || "",
      threads_handle: u.threads_handle || "",
      facebook_handle: u.facebook_handle || "",
      linkedin_handle: u.linkedin_handle || "",
      snapchat_handle: u.snapchat_handle || "",
      pinterest_handle: u.pinterest_handle || "",
      telegram_handle: u.telegram_handle || "",
      wargaming_handle: u.wargaming_handle || "",
      bungie_handle: u.bungie_handle || "",
      mastodon_handle: u.mastodon_handle || "",
      bluesky_handle: u.bluesky_handle || "",
      website: u.website || "",
      privacy_public_profile: u.privacy_public_profile ?? true,
      newsletter_consent: Boolean(u.newsletter_consent),
      show_twitch_embed: Boolean(u.show_twitch_embed),
      dm_privacy: u.dm_privacy || "everyone",
      notification_preferences: { ...(u.notification_preferences || {}) },
    });
  }, [user]);

  const loadProfileData = useCallback(async () => {
    setProfileError("");
    if (guest) {
      setPrizes([]);
      setProfileLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [achievementResult, completenessResult, preferenceResult, referenceResult, prizeResult, standingResult, linksResult] = await Promise.all([
        api.get<AchievementData>("/achievements/me").catch(() => ({ data: { groups: [], awards: [] } })),
        api.get<{ score?: number; missing?: string[] }>("/users/me/profile-completeness").catch(() => ({ data: {} })),
        api.get<{ preferences?: Record<string, boolean> } | Record<string, boolean>>("/users/me/notification-preferences").catch(() => ({ data: {} })),
        api.get<PersonalReferenceData>("/mobile/profile/references").catch(() => ({ data: { items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } } })),
        api.get<PrizePickup[]>("/prizes/me").catch(() => ({ data: [] })),
        api.get<ModerationStanding>("/moderation/me/standing").catch(() => ({ data: null })),
        api.get<{ links?: LinkedAccount[]; available?: Record<string, boolean>; disabled?: string[] }>("/me/platform-links").catch(() => ({ data: { links: [], available: {}, disabled: [] } })),
      ]);
      setStanding((standingResult.data as ModerationStanding | null) || null);
      setLinks(Array.isArray(linksResult.data?.links) ? linksResult.data.links : []);
      setLinkAvailable(linksResult.data?.available || {});
      setLinkDisabled(Array.isArray(linksResult.data?.disabled) ? linksResult.data.disabled : []);
      setAchievements(achievementResult.data || { groups: [], awards: [] });
      setReferences(referenceResult.data || { items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } });
      setPrizes(Array.isArray(prizeResult.data) ? prizeResult.data : []);
      setCompleteness(completenessResult.data || {});
      setForm((current) => ({
        ...current,
        notification_preferences: {
          ...(current.notification_preferences || {}),
          ...(((preferenceResult.data as any)?.preferences || preferenceResult.data || {}) as Record<string, boolean>),
        },
      }));
    } catch (err) {
      setProfileError(errorMessage(err, "Profildaten konnten nicht geladen werden."));
    } finally {
      setProfileLoading(false);
      setRefreshing(false);
    }
  }, [guest]);

  useEffect(() => {
    resetForm();
  }, [resetForm]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  useEffect(() => {
    const requestedTab = route.params?.tab as TabKey | undefined;
    if (!requestedTab) return;
    if (SETTINGS_TABS.includes(requestedTab)) {
      setView("settings");
    } else if (requestedTab === "edit" || tabs.some((item) => item.key === requestedTab)) {
      setView("profile");
      setTab(requestedTab);
    }
  }, [route.params?.tab]);

  useEffect(() => {
    if (tab !== "achievements") setOpenGroups({});
  }, [tab]);

  const insights = useMemo(() => {
    const tiers = (achievements.groups || []).flatMap((group) => (group.tiers || []).map((tier) => ({ ...tier, group })));
    const earned = tiers.filter((tier) => tier.earned);
    const points = earned.reduce((sum, tier) => sum + Number(tier.points || 0), 0);
    const next = tiers
      .filter((tier) => !tier.earned && Number(tier.target || 0) > 0 && tier.condition_status !== "planned")
      .sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0))[0];
    return { tiers, earned, points, next };
  }, [achievements]);

  const prizeStats = useMemo(() => {
    const open = prizes.filter((item) => ["pending", "ready"].includes(String(item.status || "pending")));
    const ready = prizes.filter((item) => String(item.status || "") === "ready");
    const pickedUp = prizes.filter((item) => String(item.status || "") === "picked_up");
    return { open, ready, pickedUp };
  }, [prizes]);

  const save = useCallback(async (successText = "Profil gespeichert.") => {
    if (guest) return;
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        ...form,
        gender: form.gender || null,
        favorite_games: String(form.favorite_games || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      };
      const { data } = await api.patch("/users/me", payload);
      setMessage(successText);
      await refreshMe();
      setForm((current) => ({ ...current, ...data }));
      await loadProfileData();
    } catch (err) {
      setMessage(errorMessage(err, "Profil konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }, [form, guest, loadProfileData, refreshMe]);
  saveRef.current = save;

  // Schalter in den Einstellungen speichern von selbst, kurz nach dem letzten
  // Tipp. Vorher stand unter 24 Schaltern ein "Speichern"-Knopf, den man
  // leicht vergaß. Der Ref nimmt beim Auslösen das aktuelle Formular.
  const scheduleSave = useCallback(() => {
    if (guest) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void saveRef.current("Gespeichert.");
    }, 700);
  }, [guest]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const evaluateAchievements = useCallback(async () => {
    if (guest) return;
    setMessage("");
    try {
      const { data } = await api.post<{ newly_awarded?: number }>("/achievements/evaluate");
      await loadProfileData();
      setMessage(data.newly_awarded ? `${data.newly_awarded} neue Erfolge freigeschaltet.` : "Erfolge sind aktuell.");
    } catch (err) {
      setMessage(errorMessage(err, "Erfolge konnten nicht aktualisiert werden."));
    }
  }, [guest, loadProfileData]);

  const openReference = useCallback((item: PersonalReferenceItem) => {
    if (!item.target_id) return;
    if (item.kind === "fastlap") {
      navigation.navigate("Tournaments", { screen: "FastLapDetail", params: { id: item.target_id } });
      return;
    }
    if (item.kind === "season") {
      navigation.navigate("More", { screen: "SeasonPass" });
      return;
    }
    if (item.kind === "tournament") {
      navigation.navigate("Tournaments", { screen: "TournamentDetail", params: { id: item.target_id } });
    }
  }, [navigation]);

  const openPrize = useCallback((item: PrizePickup) => {
    const target = prizeTarget(item);
    if (!target.id) return;
    if (target.kind === "fastlap") {
      navigation.navigate("Tournaments", { screen: "FastLapDetail", params: { id: target.id } });
      return;
    }
    navigation.navigate("Tournaments", { screen: "TournamentDetail", params: { id: target.id } });
  }, [navigation]);

  const refreshProfile = useCallback(async () => {
    setRefreshing(true);
    setOpenGroups({});
    if (!guest) {
      await refreshMe().catch(() => {});
    }
    await loadProfileData();
  }, [guest, loadProfileData, refreshMe]);

  const openPublicProfile = useCallback(() => {
    const username = user?.username;
    if (!username) return;
    navigation.getParent()?.navigate("More", { screen: "PublicProfile", params: { username } });
  }, [navigation, user?.username]);

  const sharePublicProfile = useCallback(() => {
    const username = user?.username;
    if (!username) return;
    Share.share({ message: `${WEB_BASE_URL}/u/${username}` }).catch(() => {});
  }, [user?.username]);

  const avatar = resolveMediaUrl(form.avatar_url || user?.avatar_url);
  const banner = resolveMediaUrl(form.banner_url || (user as any)?.banner_url);
  const notificationEnabled = useCallback((key: string) => {
    if (key === "news_events" && !form.newsletter_consent) return false;
    const pref = form.notification_preferences || {};
    if (Object.prototype.hasOwnProperty.call(pref, key)) return Boolean(pref[key]);
    if (key === "news_events") return Boolean(form.newsletter_consent);
    return true;
  }, [form.newsletter_consent, form.notification_preferences]);
  const notificationTopicEnabled = useCallback((channel: string, topic: string) => {
    if (channel === "email" && topic === "news_events" && !form.newsletter_consent) return false;
    const pref = form.notification_preferences || {};
    const key = notificationPreferenceKey(channel, topic);
    if (Object.prototype.hasOwnProperty.call(pref, key)) return Boolean(pref[key]);
    if (Object.prototype.hasOwnProperty.call(pref, topic)) return Boolean(pref[topic]);
    if (topic === "news_events") return Boolean(form.newsletter_consent);
    return true;
  }, [form.newsletter_consent, form.notification_preferences]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshProfile} tintColor={colors.cyan} />}
      >
        <View style={styles.profileHero}>
          {banner ? <Image source={{ uri: banner }} style={styles.bannerImage} /> : <View style={styles.bannerFallback} />}
          <View style={styles.heroOverlay} />
          <View style={styles.identity}>
            <View style={styles.avatarFrame}>
              {avatar ? <Image source={{ uri: avatar }} style={styles.avatarImage} /> : <Body style={styles.avatarInitial}>{displayName(user).slice(0, 1).toUpperCase()}</Body>}
            </View>
            <View style={styles.identityText}>
              <Muted>{guest ? "Live-Gastmodus" : `@${user?.username}`}</Muted>
              <Title>{displayName(user)}</Title>
              <View style={styles.pillRow}>
                <Pill label={user?.is_club_member ? "Vereinsmitglied" : "Community"} tone={user?.is_club_member ? "success" : "cyan"} />
                <Pill label={`${completeness.score ?? 0}% Profil`} tone="gold" />
                <Pill label={`${insights.earned.length} Erfolge`} />
                {prizeStats.open.length ? <Pill label={`${prizeStats.open.length} Gewinne`} tone="cyan" /> : null}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.quickActions}>
          <ActionTile icon="create-outline" label="Bearbeiten" onPress={guest ? undefined : () => { setView("profile"); setTab("edit"); }} />
          <ActionTile icon="share-social-outline" label="Teilen" onPress={guest ? undefined : sharePublicProfile} />
          <ActionTile icon="open-outline" label="Öffentlich" onPress={guest ? undefined : openPublicProfile} />
          {/* Rechnungen gehören zum Konto (#320): Beitrag, Events, Turniere unter Mehr → Meine Rechnungen. */}
          <ActionTile icon="receipt-outline" label="Rechnungen" onPress={guest ? undefined : () => navigation.navigate("More", { screen: "MyInvoices" })} />
          <ActionTile icon="settings-outline" label="Einstellungen" onPress={() => setView("settings")} />
        </View>

        {view === "settings" ? (
          <Pressable onPress={() => setView("profile")} accessibilityRole="button" style={styles.backRow} testID="profile-back">
            <Ionicons name="arrow-back" color={colors.cyan} size={16} />
            <Muted style={styles.backText}>Zurück zum Profil</Muted>
          </Pressable>
        ) : (
          <View style={styles.tabs}>
            {tabs.map((item) => (
              <Pressable key={item.key} onPress={() => setTab(item.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }} style={[styles.tab, tab === item.key && styles.tabActive]}>
                <Ionicons name={item.icon} color={tab === item.key ? colors.cyan : colors.muted} size={15} />
                <Muted style={[styles.tabText, tab === item.key && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{item.label}</Muted>
              </Pressable>
            ))}
          </View>
        )}

        {message ? <Muted style={message.includes("konnte") ? styles.error : styles.success}>{message}</Muted> : null}
        {profileError ? <Muted style={styles.error}>{profileError}</Muted> : null}
        {profileLoading && !guest ? <SkeletonList count={3} hasImage={false} /> : null}

        {/* Reiterwechsel ohne Sprung (#218): der Inhalt blendet kurz ein; nichts wird neu aufgebaut. */}
        <FadeIn trigger={activeTab} style={styles.tabContent}>
        {!profileLoading && activeTab === "overview" ? (
          <>
            {standing && (standing.active || standing.strike_count > 0) ? (
              <Card style={styles.card}>
                <Heading>Moderation</Heading>
                {standing.active ? (
                  <Muted>
                    {standing.active.label}
                    {standing.active.chat_blocked_until ? ` · Chat gesperrt bis ${formatDate(standing.active.chat_blocked_until)}` : standing.active.open_until_decision ? " · bis zur Entscheidung der Moderation" : ""}
                  </Muted>
                ) : null}
                {standing.active?.reason ? <Muted>Grund: {standing.active.reason}</Muted> : null}
                <Muted>{standing.strike_count} Treffer in den letzten {standing.strike_ttl_months} Monaten.</Muted>
                <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${WEB_BASE_URL}/my/penalties`)} testID="profile-moderation-web">
                  <Muted style={{ color: colors.cyan }}>Details und Einspruch auf der Website</Muted>
                </Pressable>
              </Card>
            ) : null}
            <Card style={styles.card}>
              <Heading>Profilstatus</Heading>
              <ProgressBar value={completeness.score || 0} color={colors.cyan} />
              <View style={styles.statGrid}>
                <Stat label="Punkte" value={String(insights.points)} />
                <Stat label="Erfolge" value={`${insights.earned.length}/${insights.tiers.length || 0}`} tone="gold" />
                <Stat label="Rolle" value={formatStatus(user?.role || "player")} />
              </View>
              {completeness.missing?.length ? (
                <Muted>Offen: {completeness.missing.slice(0, 8).join(", ")}</Muted>
              ) : (
                <Muted>Alle wichtigen Profilfelder sind gepflegt.</Muted>
              )}
            </Card>
            {/* Freunde (#240): offene Anfragen oben, darunter die Liste - live über den Änderungsstrom. */}
            <FriendsCard onOpenProfile={(username) => navigation.getParent()?.navigate("More", { screen: "PublicProfile", params: { username } })} />
            <Card style={styles.card}>
              <Heading>Gaming</Heading>
              <Info label="Lieblingsspiele" value={form.favorite_games || "-"} />
              <Info label="Plattform" value={form.main_platform || "-"} />
              <Info label="Rolle" value={form.preferred_role || "-"} />
              <Info label="Discord" value={form.discord_name || "-"} />
            </Card>
            <Card style={styles.card}>
              <Heading>Nächster Erfolg</Heading>
              {insights.next ? (
                <>
                  <View style={styles.nextAchievement}>
                    <Ionicons name={achievementIcon(insights.next.group)} size={20} color={insights.next.group.accent_color || colors.cyan} />
                    <Body style={styles.strong}>{insights.next.name}</Body>
                  </View>
                  <Muted>{insights.next.group.name}</Muted>
                  <ProgressBar value={Number(insights.next.percent || 0)} color={insights.next.group.accent_color || colors.cyan} />
                  <Muted>{Number(insights.next.current || 0).toLocaleString("de-DE")} von {Number(insights.next.target || 0).toLocaleString("de-DE")}</Muted>
                </>
              ) : (
                <EmptyState icon="checkmark-done-outline" title="Alles aktuell" detail="Keine offenen automatischen Fortschritte gefunden." />
              )}
            </Card>
          </>
        ) : null}

        {!profileLoading && activeTab === "references" ? (
          <>
            <Card style={styles.card}>
              <Heading>Meine Referenzen</Heading>
              <Muted>Persönliche Turnier- und Fast-Lap-Historie aus deinem Konto.</Muted>
              <View style={styles.statGrid}>
                <Stat label="Gesamt" value={String(references.stats.total)} />
                <Stat label="Podien" value={String(references.stats.podiums)} tone="gold" />
                <Stat label="Siege" value={String(references.stats.wins)} />
              </View>
              <View style={styles.statGrid}>
                <Stat label="Turniere" value={String(references.stats.tournaments)} />
                <Stat label="Fast Laps" value={String(references.stats.fastlaps)} tone="gold" />
              </View>
            </Card>
            {references.items.length ? (
              references.items.map((item) => <ReferenceCard key={item.id} item={item} onOpen={openReference} />)
            ) : (
              <Card style={styles.card}>
                <EmptyState icon="ribbon-outline" title="Noch keine Referenzen" detail="Sobald du Turniere spielst oder Fast-Lap-Zeiten eingetragen werden, erscheint deine Historie hier." />
              </Card>
            )}
          </>
        ) : null}

        {!profileLoading && activeTab === "awards" ? (
          <>
            <Card style={styles.card}>
              <Heading>Meine Auszeichnungen</Heading>
              <Muted>Gewinnerbanner und Trophäen aus Turnieren des Vereins. Eine davon kannst du als Profilbanner wählen.</Muted>
            </Card>
            {awards.awards.length ? (
              <View style={styles.awardList} testID="profile-awards">
                {sortAwards(awards.awards).map((award) => (
                  <AwardCard
                    key={award.id}
                    award={award}
                    featured={awards.featured_award_id === award.id}
                    onPress={() => { const target = award.tournament?.slug || award.tournament?.id; if (target) navigation.navigate("Tournaments", { screen: "TournamentDetail", params: { id: target } }); }}
                    action={
                      <Pressable onPress={() => featureAward(awards.featured_award_id === award.id ? null : award.id)} accessibilityRole="button" testID={`award-feature-${award.id}`} style={styles.awardAction}>
                        <Muted style={styles.awardActionText}>{awards.featured_award_id === award.id ? "Profilbanner ✓" : "Als Profilbanner"}</Muted>
                      </Pressable>
                    }
                  />
                ))}
              </View>
            ) : (
              <Card style={styles.card}>
                <EmptyState icon="medal-outline" title="Noch keine Auszeichnungen" detail="Sie entstehen, wenn ein Turnier seine Ergebnisse veröffentlicht – Platz 1 bis 3 als Trophäe, alle anderen als Teilnahme-Banner." />
              </Card>
            )}
          </>
        ) : null}

        {!profileLoading && activeTab === "prizes" ? (
          <>
            <Card style={styles.card}>
              <Heading>Meine Gewinne</Heading>
              <Muted>Preise aus Turnieren und Fast-Lap-Challenges, sobald sie fuer dein Konto oder Team hinterlegt sind.</Muted>
              <View style={styles.statGrid}>
                <Stat label="Offen" value={String(prizeStats.open.length)} />
                <Stat label="Bereit" value={String(prizeStats.ready.length)} tone="gold" />
                <Stat label="Abgeholt" value={String(prizeStats.pickedUp.length)} />
              </View>
            </Card>
            {prizes.length ? (
              prizes.map((item) => <PrizeCard key={item.id} item={item} onOpen={openPrize} />)
            ) : (
              <Card style={styles.card}>
                <EmptyState icon="trophy-outline" title="Noch keine Gewinne" detail="Sobald ein Preis fuer dich oder dein Team eingetragen wird, erscheint er hier." tone="gold" />
              </Card>
            )}
          </>
        ) : null}

        {!profileLoading && activeTab === "edit" ? (
          <Card style={styles.card}>
            <View style={styles.cardTop}>
              <Heading>Profil bearbeiten</Heading>
              <Pressable onPress={() => setTab("overview")} style={styles.smallAction} accessibilityRole="button">
                <Muted style={styles.smallActionText}>Fertig</Muted>
              </Pressable>
            </View>
            {guest ? <Muted>Profilbearbeitung ist nur nach Login aktiv.</Muted> : null}
            <Field label="Anzeigename" value={form.display_name} onChangeText={(v) => setField(setForm, "display_name", v)} />
            <Muted>So heißt du überall: im Profil, in Teams, Turnieren und Ranglisten.</Muted>
            <Field label="Vorname" value={form.first_name} onChangeText={(v) => setField(setForm, "first_name", v)} />
            <Field label="Nachname" value={form.last_name} onChangeText={(v) => setField(setForm, "last_name", v)} />
            <Field label="Bio" value={form.bio} multiline onChangeText={(v) => setField(setForm, "bio", v)} />
            <Field label="Land" value={form.country} onChangeText={(v) => setField(setForm, "country", v)} />
            <Field label="Stadt" value={form.city} onChangeText={(v) => setField(setForm, "city", v)} />
            <Field label="Avatar URL" value={form.avatar_url} onChangeText={(v) => setField(setForm, "avatar_url", v)} />
            <Field label="Banner URL" value={form.banner_url} onChangeText={(v) => setField(setForm, "banner_url", v)} />
            <Field label="Lieblingsspiele, getrennt mit Komma" value={form.favorite_games} onChangeText={(v) => setField(setForm, "favorite_games", v)} />
            <Field label="Hauptplattform" value={form.main_platform} onChangeText={(v) => setField(setForm, "main_platform", v)} />
            <Field label="Bevorzugte Rolle" value={form.preferred_role} onChangeText={(v) => setField(setForm, "preferred_role", v)} />
            <Field label="Eingabegerät" value={form.input_device} onChangeText={(v) => setField(setForm, "input_device", v)} />
            <Heading>Konten</Heading>
            <Muted>Verknüpfen läuft im Browser: die Plattform bestätigt dein Konto, der Name kommt von dort. Wer welches Konto sieht, regelst du unter Privatsphäre.</Muted>
            <PlatformLinkRows links={links} available={linkAvailable} disabled={linkDisabled} onLink={startPlatformLink} onUnlink={unlinkPlatform} />
            <Muted>Von Hand – diese Plattformen bieten keine Anmeldung:</Muted>
            {manualSocialKeys.map((key) => (
              <Field key={key} label={labelFor(key)} value={form[key]} onChangeText={(v) => setField(setForm, key, v)} />
            ))}
            <Button label={saving ? "Speichert ..." : "Profil speichern"} onPress={() => save()} disabled={guest || saving} />
          </Card>
        ) : null}

        {!profileLoading && activeTab === "achievements" ? (
          <>
            <Card style={styles.card}>
              <View style={styles.cardTop}>
                <Heading>Erfolge</Heading>
                <Pressable onPress={evaluateAchievements} disabled={guest} style={styles.smallAction} accessibilityRole="button">
                  <Muted style={styles.smallActionText}>Neu berechnen</Muted>
                </Pressable>
              </View>
              <Muted>{insights.earned.length} von {insights.tiers.length} Stufen freigeschaltet · {insights.points} Punkte</Muted>
            </Card>
            {(achievements.groups || []).length ? (
              (achievements.groups || []).map((group, index) => (
                <FadeIn key={group.code} delay={staggerDelay(index)}>
                  <AchievementGroupCard
                    group={group}
                    open={Boolean(openGroups[group.code])}
                    onToggle={() => setOpenGroups((current) => ({ ...current, [group.code]: !current[group.code] }))}
                  />
                </FadeIn>
              ))
            ) : (
              <Card style={styles.card}>
                <EmptyState icon="trophy-outline" title="Noch keine Erfolge" detail="Sobald automatische oder manuelle Erfolge freigeschaltet sind, erscheinen sie hier." tone="gold" />
              </Card>
            )}
          </>
        ) : null}

        {!profileLoading && view === "settings" ? (
          <Card style={styles.card}>
            <Heading>Sicherheit</Heading>
            <Muted>Gilt nur auf diesem Gerät – nichts davon geht zum Server.</Muted>
            {/* App-Sperre (#217): Einschalten fragt einmal den Fingerabdruck ab; ohne Gerätesperre bleibt der Schalter aus. */}
            <Toggle label="App beim Öffnen sperren" detail={availabilityText(appLock.availability)} value={appLock.enabled} onValueChange={(v) => { void appLock.setEnabled(v); }} />
          </Card>
        ) : null}

        {!profileLoading && view === "settings" ? (
          <Card style={styles.card}>
            <Heading>Privatsphäre</Heading>
            <Muted>Änderungen werden von selbst gespeichert.</Muted>
            <Toggle label="Öffentliches Profil" detail="Profil ist in der Community-Suche sichtbar." value={Boolean(form.privacy_public_profile)} onValueChange={(v) => { setField(setForm, "privacy_public_profile", v); scheduleSave(); }} />
            <Toggle label="Twitch im Profil anzeigen" detail="Live-Embed darf auf deinem öffentlichen Profil erscheinen." value={Boolean(form.show_twitch_embed)} onValueChange={(v) => { setField(setForm, "show_twitch_embed", v); scheduleSave(); }} />
            <Muted>Direktnachrichten</Muted>
            <View style={styles.optionGrid}>
              {dmOptions.map(([value, label]) => (
                <Pressable key={value} onPress={() => { setField(setForm, "dm_privacy", value); scheduleSave(); }} accessibilityRole="radio" accessibilityState={{ selected: form.dm_privacy === value }} style={[styles.option, form.dm_privacy === value && styles.optionActive]}>
                  <Muted style={[styles.optionText, form.dm_privacy === value && styles.optionTextActive]}>{label}</Muted>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        {/* Blockierte Benutzer (#414): wie auf der Website unter Privatsphäre. */}
        {!profileLoading && view === "settings" ? <BlockedUsersCard style={styles.card} /> : null}

        {!profileLoading && view === "settings" ? (
          <Card style={styles.card}>
            <Heading>Benachrichtigungen</Heading>
            <Toggle label="Newsletter" detail="Grundsätzliche Zustimmung für News und Events." value={Boolean(form.newsletter_consent)} onValueChange={(v) => { setField(setForm, "newsletter_consent", v); scheduleSave(); }} />
            <Muted style={styles.sectionText}>Kanäle</Muted>
            {notificationChannels.map((item) => (
              <Toggle
                key={item.key}
                label={item.label}
                detail={item.detail}
                value={notificationEnabled(item.key)}
                onValueChange={(v) => {
                  setForm((current) => ({
                    ...current,
                    notification_preferences: { ...(current.notification_preferences || {}), [item.key]: v },
                  }));
                  scheduleSave();
                }}
              />
            ))}
            <Muted style={styles.sectionText}>Jede Benachrichtigung pro Kanal</Muted>
            {notificationLabels.map((item) => (
              <View key={item.key} style={styles.notificationTopic}>
                <Body style={styles.strong}>{item.label}</Body>
                <Muted>{item.detail}</Muted>
                {item.key === "news_events" && !form.newsletter_consent ? <Muted style={styles.warningText}>E-Mail benötigt Newsletter-Zustimmung.</Muted> : null}
                <View style={styles.notificationMatrix}>
                  {notificationChannels.map((channel) => {
                    const key = notificationPreferenceKey(channel.key, item.key);
                    const channelEnabled = notificationEnabled(channel.key);
                    const disabled = !channelEnabled || (channel.key === "email" && item.key === "news_events" && !form.newsletter_consent);
                    const enabled = channelEnabled && notificationTopicEnabled(channel.key, item.key);
                    return (
                      <MatrixToggle
                        key={key}
                        label={channel.label}
                        value={enabled}
                        disabled={disabled}
                        onValueChange={(v) => {
                          setForm((current) => ({
                            ...current,
                            notification_preferences: { ...(current.notification_preferences || {}), [key]: v },
                          }));
                          scheduleSave();
                        }}
                      />
                    );
                  })}
                </View>
              </View>
            ))}
            {saving ? <Muted>Speichert …</Muted> : null}
          </Card>
        ) : null}

        </FadeIn>

        {guest ? (
          <Card style={styles.card}>
            <Muted>Live-Gastmodus aktiv. Profilbearbeitung und persönliche Einstellungen sind nach Login verfügbar.</Muted>
          </Card>
        ) : view === "settings" ? (
          <>
            <ActionRow icon="log-out-outline" label="Abmelden" detail="Dieses Gerät aus deinem Konto ausloggen." tone="danger" onPress={logout} />
            <ActionRow icon="trash-outline" label="Konto löschen" detail="Dauerhaft anonymisieren – wie auf der Website unter Datenschutz." tone="danger" onPress={deleteAccount} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function setField(setForm: React.Dispatch<React.SetStateAction<Record<string, any>>>, key: string, value: any) {
  setForm((current) => ({ ...current, [key]: value }));
}

function labelFor(key: string) {
  return key
    .replace("_handle", "")
    .replace("_id", " ID")
    .replace("discord_name", "Discord")
    .replace("nintendo_fc", "Nintendo Friend Code")
    .replace("battlenet", "Battle.net")
    .replace("faceit", "FACEIT")
    .replace("startgg", "start.gg")
    .replace("osu", "osu!")
    .replace("github", "GitHub")
    .replace("linkedin", "LinkedIn")
    .replace("wargaming", "Wargaming.net")
    .replace("bungie", "Bungie.net")
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function Field({ label, value, onChangeText, multiline = false }: { label: string; value?: string; onChangeText: (value: string) => void; multiline?: boolean }) {
  return (
    <View style={styles.field}>
      <Muted style={styles.fieldLabel}>{label}</Muted>
      <TextInput
        value={value || ""}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && styles.inputMulti]}
        autoCapitalize="none"
      />
    </View>
  );
}

function Toggle({ label, detail, value, onValueChange }: { label: string; detail: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Body style={styles.strong}>{label}</Body>
        <Muted>{detail}</Muted>
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: "rgba(255,255,255,0.16)", true: "rgba(41,182,232,0.45)" }} thumbColor={value ? colors.cyan : colors.muted} />
    </View>
  );
}

function MatrixToggle({ label, value, disabled, onValueChange }: { label: string; value: boolean; disabled?: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <View style={[styles.matrixToggle, value && styles.matrixToggleActive, disabled && styles.matrixToggleDisabled]}>
      <Muted style={[styles.matrixLabel, value && styles.matrixLabelActive]}>{label}</Muted>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: "rgba(255,255,255,0.16)", true: "rgba(41,182,232,0.45)" }}
        thumbColor={value ? colors.cyan : colors.muted}
      />
    </View>
  );
}

function ReferenceCard({ item, onOpen }: { item: PersonalReferenceItem; onOpen?: (item: PersonalReferenceItem) => void }) {
  const isFastlap = item.kind === "fastlap";
  const isSeason = item.kind === "season";
  const content = (
    <Card style={styles.referenceCard}>
      <View style={styles.referenceTop}>
        <View style={[styles.referenceIcon, isFastlap || isSeason ? styles.referenceIconFastlap : styles.referenceIconTournament]}>
          <Body style={styles.referenceIconText}>{isFastlap ? "FL" : isSeason ? "JW" : "T"}</Body>
        </View>
        <View style={styles.referenceText}>
          <Body style={styles.strong}>{item.title}</Body>
          <Muted>{item.subtitle || (isFastlap ? "Fast Lap" : isSeason ? "Jahreswertung" : "Turnier")}</Muted>
          <Muted>{formatDate(item.date)} · {formatStatus(item.status)}</Muted>
        </View>
        <View style={styles.referenceRank}>
          <Body style={[styles.referenceRankText, Number(item.rank || 0) <= 3 && item.rank ? styles.gold : null]}>
            {item.rank ? `#${item.rank}` : "-"}
          </Body>
          <Muted>{item.participant_count ? `von ${item.participant_count}` : "Rang"}</Muted>
        </View>
      </View>
      <View style={styles.referenceMeta}>
        {item.time_str ? <Pill label={item.time_str} tone="cyan" /> : null}
        {isSeason && item.points != null ? <Pill label={`${item.points} Jahrespunkte`} tone="gold" /> : null}
        <Pill label={isFastlap ? "Fast Lap" : isSeason ? "Jahreswertung" : "Turnier"} />
      </View>
    </Card>
  );
  if (!item.target_id || !onOpen) return content;
  return (
    <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function PrizeCard({ item, onOpen }: { item: PrizePickup; onOpen?: (item: PrizePickup) => void }) {
  const target = prizeTarget(item);
  const isFastlap = target.kind === "fastlap";
  const status = String(item.status || "pending");
  const isReady = status === "ready";
  const sourceTitle = item.fastlap_challenge_title || item.tournament_title || "Gewinn";
  const prizeText = item.prize_value || item.prize_label || "Preis";
  const placeText = item.place_label || (item.place ? `Platz ${item.place}` : "Platz");
  const deadline = item.pickup_deadline ? formatDate(item.pickup_deadline) : "";
  const pickedUp = item.picked_up_at ? formatDate(item.picked_up_at) : "";
  const overdue = item.pickup_deadline ? Date.parse(item.pickup_deadline) < Date.now() && status !== "picked_up" : false;
  const content = (
    <Card style={[styles.referenceCard, isReady && { borderColor: "rgba(240, 180, 41, 0.48)" }, overdue && { borderColor: "rgba(255, 65, 84, 0.56)" }]}>
      <View style={styles.referenceTop}>
        <View style={[styles.referenceIcon, isFastlap ? styles.referenceIconFastlap : styles.referenceIconTournament]}>
          <Body style={styles.referenceIconText}>{isFastlap ? "FL" : "T"}</Body>
        </View>
        <View style={styles.referenceText}>
          <Body style={styles.strong}>{prizeText}</Body>
          <Muted>{sourceTitle}</Muted>
          <Muted>{prizeSourceLabel(item)} - {formatStatus(status)}</Muted>
        </View>
        <View style={styles.referenceRank}>
          <Body style={[styles.referenceRankText, styles.gold]}>{placeText.replace(/^Platz\s*/i, "#")}</Body>
          <Muted>{item.recipient_type === "team" ? item.recipient_label || "Team" : "Du"}</Muted>
        </View>
      </View>
      <View style={styles.referenceMeta}>
        {isReady ? <Pill label="Bereit" tone="gold" /> : null}
        {deadline ? <Pill label={`Frist ${deadline}`} tone={overdue ? "gold" : "default"} /> : null}
        {pickedUp ? <Pill label={`Abgeholt ${pickedUp}`} tone="success" /> : null}
        {item.fastlap_track_name ? <Pill label={item.fastlap_track_name} tone="cyan" /> : null}
        <Pill label={isFastlap ? "Fast Lap" : "Turnier"} />
      </View>
    </Card>
  );
  if (!target.id || !onOpen) return content;
  return (
    <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function prizeTarget(item: PrizePickup) {
  if (item.source_type === "fastlap") {
    return { kind: "fastlap", id: item.fastlap_challenge_slug || item.fastlap_challenge_id || "" };
  }
  return { kind: "tournament", id: item.tournament_slug || item.tournament_id || "" };
}

function prizeSourceLabel(item: PrizePickup) {
  if (item.fastlap_source_label) return item.fastlap_source_label;
  if (item.source_type === "fastlap") return "Fast Lap";
  return "Turnier";
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <View style={styles.progress}>
      <View style={[styles.progressFill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

function Stat({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "gold" }) {
  return (
    <View style={styles.stat}>
      {/* Ein Wert bleibt eine Zeile: "Superadmin" brach vorher als "Superad/min" (#247). */}
      <Body style={[styles.statValue, tone === "gold" && styles.gold]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Body>
      <Muted numberOfLines={1}>{label}</Muted>
    </View>
  );
}

function Pill({ label, tone = "default" }: { label: string; tone?: "default" | "cyan" | "gold" | "success" }) {
  const toneStyle = tone === "cyan" ? styles.pillCyan : tone === "gold" ? styles.pillGold : tone === "success" ? styles.pillSuccess : null;
  const textStyle = tone === "cyan" ? styles.textCyan : tone === "gold" ? styles.textGold : tone === "success" ? styles.textSuccess : null;
  return (
    <View style={[styles.pill, toneStyle]}>
      <Muted style={[styles.pillText, textStyle]}>{label}</Muted>
    </View>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.info}>
      <Muted>{label}</Muted>
      <Body style={styles.infoValue}>{value || "-"}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  awardList: {
    gap: 10,
  },
  awardAction: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  awardActionText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  content: {
    padding: 18,
    gap: 16,
    paddingBottom: 32,
  },
  profileHero: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 220,
    overflow: "hidden",
  },
  bannerImage: {
    height: 220,
    width: "100%",
  },
  bannerFallback: {
    backgroundColor: "#101113",
    height: 220,
  },
  heroOverlay: {
    backgroundColor: "rgba(0,0,0,0.42)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  identity: {
    bottom: 16,
    flexDirection: "row",
    gap: 14,
    left: 16,
    position: "absolute",
    right: 16,
  },
  avatarFrame: {
    alignItems: "center",
    backgroundColor: colors.black,
    borderColor: colors.cyan,
    borderRadius: 12,
    borderWidth: 2,
    height: 78,
    justifyContent: "center",
    overflow: "hidden",
    width: 78,
  },
  avatarImage: {
    height: "100%",
    width: "100%",
  },
  avatarInitial: {
    color: colors.cyan,
    fontSize: 30,
    fontWeight: "900",
  },
  identityText: {
    flex: 1,
    gap: 5,
    justifyContent: "flex-end",
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillCyan: {
    backgroundColor: "rgba(41, 182, 232, 0.14)",
    borderColor: "rgba(41, 182, 232, 0.35)",
  },
  pillGold: {
    backgroundColor: "rgba(255, 215, 0, 0.12)",
    borderColor: "rgba(255, 215, 0, 0.32)",
  },
  pillSuccess: {
    backgroundColor: "rgba(0, 255, 136, 0.12)",
    borderColor: "rgba(0, 255, 136, 0.32)",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "900",
  },
  textCyan: { color: colors.cyan },
  textGold: { color: colors.gold },
  textSuccess: { color: colors.success },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tabs: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 6,
  },
  backRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 38,
  },
  backText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  tab: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    // Vier gleich breite Reiter in einer Zeile; vorher rutschte "Erfolge"
    // allein in eine zweite Zeile (#247).
    flex: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: "rgba(41, 182, 232, 0.16)",
    borderColor: "rgba(41, 182, 232, 0.42)",
  },
  tabText: {
    flexShrink: 1,
    fontWeight: "900",
    textAlign: "center",
  },
  tabTextActive: {
    color: colors.cyan,
  },
  card: {
    gap: 12,
  },
  cardTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statGrid: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  statValue: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
  },
  info: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 2,
  },
  infoValue: {
    fontWeight: "800",
  },
  strong: {
    fontWeight: "900",
  },
  sectionText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  warningText: {
    color: colors.gold,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    fontWeight: "800",
  },
  input: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    color: colors.white,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputMulti: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  toggleRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 14,
    paddingTop: 12,
  },
  toggleText: {
    flex: 1,
    gap: 3,
  },
  notificationTopic: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 12,
  },
  notificationMatrix: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  matrixToggle: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexBasis: "31%",
    flexDirection: "row",
    flexGrow: 1,
    justifyContent: "space-between",
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  matrixToggleActive: {
    backgroundColor: "rgba(41,182,232,0.12)",
    borderColor: "rgba(41,182,232,0.42)",
  },
  matrixToggleDisabled: {
    opacity: 0.45,
  },
  matrixLabel: {
    fontSize: 12,
    fontWeight: "900",
  },
  matrixLabelActive: {
    color: colors.cyan,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  option: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  optionActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.42)",
  },
  optionText: {
    fontWeight: "900",
  },
  optionTextActive: {
    color: colors.cyan,
  },
  smallAction: {
    borderColor: "rgba(41,182,232,0.38)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  smallActionText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  tabContent: { gap: 16 },
  nextAchievement: { flexDirection: "row", alignItems: "center", gap: 8 },
  referenceCard: {
    gap: 10,
  },
  referenceTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  referenceIcon: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  referenceIconTournament: {
    backgroundColor: "rgba(41, 182, 232, 0.14)",
    borderColor: "rgba(41, 182, 232, 0.38)",
  },
  referenceIconFastlap: {
    backgroundColor: "rgba(240, 180, 41, 0.14)",
    borderColor: "rgba(240, 180, 41, 0.38)",
  },
  referenceIconText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  referenceText: {
    flex: 1,
    gap: 2,
  },
  referenceRank: {
    alignItems: "flex-end",
    minWidth: 58,
  },
  referenceRankText: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: "900",
  },
  referenceMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pressed: {
    opacity: 0.72,
  },
  progress: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 3,
    height: 6,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
  },
  error: {
    color: colors.live,
    fontWeight: "800",
  },
  success: {
    color: colors.success,
    fontWeight: "800",
  },
});
