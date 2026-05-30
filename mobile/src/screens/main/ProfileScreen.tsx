import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { Image, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, TextInput, View } from "react-native";
import { ActionRow, ActionTile } from "../../components/ActionRow";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage, resolveMediaUrl } from "../../lib/api";
import { API_BASE_URL } from "../../config";
import { displayName, formatDate, formatStatus } from "../../lib/format";
import { isGuestUser } from "../../live";
import { colors } from "../../theme";
import type { PersonalReferenceData, PersonalReferenceItem } from "../../types";

type TabKey = "overview" | "references" | "edit" | "achievements" | "privacy" | "notifications";
type AchievementData = { groups?: AchievementGroup[]; awards?: any[] };
type AchievementGroup = {
  code: string;
  name: string;
  category?: string;
  description?: string;
  accent_color?: string;
  tiers?: AchievementTier[];
  earned_count?: number;
  tier_count?: number;
};
type AchievementTier = {
  code: string;
  name: string;
  description?: string;
  level?: number;
  level_name?: string;
  earned?: boolean;
  points?: number;
  current?: number;
  target?: number;
  percent?: number;
  manual_only?: boolean;
  condition_status?: string;
  earned_at?: string;
};

const tabs: Array<{ key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "overview", label: "Übersicht", icon: "person-circle-outline" },
  { key: "references", label: "Referenzen", icon: "ribbon-outline" },
  { key: "edit", label: "Bearbeiten", icon: "create-outline" },
  { key: "achievements", label: "Erfolge", icon: "trophy-outline" },
  { key: "privacy", label: "Privat", icon: "shield-checkmark-outline" },
  { key: "notifications", label: "Mails", icon: "notifications-outline" },
];

const notificationLabels: Array<{ key: string; label: string; detail: string }> = [
  { key: "match_reminders", label: "Spiel-Erinnerungen", detail: "Startzeiten, Check-in und Match-Hub." },
  { key: "tournament_updates", label: "Turnier-Updates", detail: "Anmeldungen, Status und Ergebnisse." },
  { key: "prize_updates", label: "Gewinne", detail: "Gewinn bereit, Übergabe und Fristen." },
  { key: "membership_updates", label: "Mitgliedschaft", detail: "Bewerbung, Status und Vereinsvorteile." },
  { key: "birthday_greetings", label: "Geburtstag", detail: "Geburtstagsgruß vom Verein." },
  { key: "community_messages", label: "Community", detail: "Direktnachrichten und Erwähnungen." },
  { key: "news_events", label: "News & Events", detail: "Vereinsnews, Events und Ankündigungen." },
];

const dmOptions = [
  ["everyone", "Alle"],
  ["friends", "Freunde"],
  ["team_members", "Team"],
  ["club_members", "Verein"],
  ["admins_only", "Admins"],
  ["none", "Niemand"],
];

const levelColors: Record<number, string> = {
  1: "#CD7F32",
  2: "#C0C0C0",
  3: colors.gold,
  4: colors.cyan,
  5: colors.live,
};

export function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { user, logout, refreshMe } = useAuth();
  const [tab, setTab] = useState<TabKey>("overview");
  const [achievements, setAchievements] = useState<AchievementData>({ groups: [], awards: [] });
  const [references, setReferences] = useState<PersonalReferenceData>({ items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [completeness, setCompleteness] = useState<{ score?: number; missing?: string[] }>({});
  const [form, setForm] = useState<Record<string, any>>({});
  const [profileLoading, setProfileLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const guest = isGuestUser(user);

  const resetForm = useCallback(() => {
    const u = (user || {}) as Record<string, any>;
    setForm({
      display_name: u.display_name || "",
      first_name: u.first_name || "",
      last_name: u.last_name || "",
      nickname: u.nickname || "",
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
      setProfileLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [achievementResult, completenessResult, preferenceResult, referenceResult] = await Promise.all([
        api.get<AchievementData>("/achievements/me").catch(() => ({ data: { groups: [], awards: [] } })),
        api.get<{ score?: number; missing?: string[] }>("/users/me/profile-completeness").catch(() => ({ data: {} })),
        api.get<Record<string, boolean>>("/users/me/notification-preferences").catch(() => ({ data: {} })),
        api.get<PersonalReferenceData>("/mobile/profile/references").catch(() => ({ data: { items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } } })),
      ]);
      setAchievements(achievementResult.data || { groups: [], awards: [] });
      setReferences(referenceResult.data || { items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } });
      setCompleteness(completenessResult.data || {});
      setForm((current) => ({
        ...current,
        notification_preferences: {
          ...(current.notification_preferences || {}),
          ...(preferenceResult.data || {}),
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

  const save = useCallback(async () => {
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
      setMessage("Profil gespeichert.");
      await refreshMe();
      setForm((current) => ({ ...current, ...data }));
      await loadProfileData();
    } catch (err) {
      setMessage(errorMessage(err, "Profil konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }, [form, guest, loadProfileData, refreshMe]);

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
    Share.share({ message: `${API_BASE_URL}/u/${username}` }).catch(() => {});
  }, [user?.username]);

  const avatar = resolveMediaUrl(form.avatar_url || user?.avatar_url);
  const banner = resolveMediaUrl(form.banner_url || (user as any)?.banner_url);

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
              </View>
            </View>
          </View>
        </View>

        <View style={styles.quickActions}>
          <ActionTile icon="create-outline" label="Bearbeiten" onPress={() => setTab("edit")} />
          <ActionTile icon="open-outline" label="Öffentlich" onPress={guest ? undefined : openPublicProfile} />
          <ActionTile icon="share-social-outline" label="Teilen" onPress={guest ? undefined : sharePublicProfile} />
          <ActionTile icon="refresh-outline" label={refreshing ? "Lädt" : "Aktualisieren"} onPress={guest || refreshing ? undefined : refreshProfile} />
          <ActionTile icon="shield-checkmark-outline" label="Privat" onPress={() => setTab("privacy")} />
          <ActionTile icon="notifications-outline" label="Mails" onPress={() => setTab("notifications")} />
        </View>

        <View style={styles.tabs}>
          {tabs.map((item) => (
            <Pressable key={item.key} onPress={() => setTab(item.key)} style={[styles.tab, tab === item.key && styles.tabActive]}>
              <Ionicons name={item.icon} color={tab === item.key ? colors.cyan : colors.muted} size={15} />
              <Muted style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Muted>
            </Pressable>
          ))}
        </View>

        {message ? <Muted style={message.includes("konnte") ? styles.error : styles.success}>{message}</Muted> : null}
        {profileError ? <Muted style={styles.error}>{profileError}</Muted> : null}
        {profileLoading && !guest ? <SkeletonList count={3} hasImage={false} /> : null}

        {!profileLoading && tab === "overview" ? (
          <>
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
                  <Body style={styles.strong}>{insights.next.name}</Body>
                  <Muted>{insights.next.group.name}</Muted>
                  <ProgressBar value={Number(insights.next.percent || 0)} color={insights.next.group.accent_color || colors.cyan} />
                  <Muted>{insights.next.current || 0}/{insights.next.target || 0}</Muted>
                </>
              ) : (
                <EmptyState icon="checkmark-done-outline" title="Alles aktuell" detail="Keine offenen automatischen Fortschritte gefunden." />
              )}
            </Card>
          </>
        ) : null}

        {!profileLoading && tab === "references" ? (
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

        {!profileLoading && tab === "edit" ? (
          <Card style={styles.card}>
            <Heading>Profil bearbeiten</Heading>
            {guest ? <Muted>Profilbearbeitung ist nur nach Login aktiv.</Muted> : null}
            <Field label="Anzeigename" value={form.display_name} onChangeText={(v) => setField(setForm, "display_name", v)} />
            <Field label="Vorname" value={form.first_name} onChangeText={(v) => setField(setForm, "first_name", v)} />
            <Field label="Nachname" value={form.last_name} onChangeText={(v) => setField(setForm, "last_name", v)} />
            <Field label="Nickname" value={form.nickname} onChangeText={(v) => setField(setForm, "nickname", v)} />
            <Field label="Bio" value={form.bio} multiline onChangeText={(v) => setField(setForm, "bio", v)} />
            <Field label="Land" value={form.country} onChangeText={(v) => setField(setForm, "country", v)} />
            <Field label="Stadt" value={form.city} onChangeText={(v) => setField(setForm, "city", v)} />
            <Field label="Avatar URL" value={form.avatar_url} onChangeText={(v) => setField(setForm, "avatar_url", v)} />
            <Field label="Banner URL" value={form.banner_url} onChangeText={(v) => setField(setForm, "banner_url", v)} />
            <Field label="Lieblingsspiele, getrennt mit Komma" value={form.favorite_games} onChangeText={(v) => setField(setForm, "favorite_games", v)} />
            <Field label="Hauptplattform" value={form.main_platform} onChangeText={(v) => setField(setForm, "main_platform", v)} />
            <Field label="Bevorzugte Rolle" value={form.preferred_role} onChangeText={(v) => setField(setForm, "preferred_role", v)} />
            <Field label="Eingabegerät" value={form.input_device} onChangeText={(v) => setField(setForm, "input_device", v)} />
            <Heading>Socials & IDs</Heading>
            {["discord_name", "twitch_handle", "youtube_handle", "tiktok_handle", "instagram_handle", "x_handle", "steam_id", "epic_id", "psn_id", "xbox_id", "nintendo_fc", "ea_id", "riot_id", "battlenet_id", "website"].map((key) => (
              <Field key={key} label={labelFor(key)} value={form[key]} onChangeText={(v) => setField(setForm, key, v)} />
            ))}
            <Button label={saving ? "Speichert ..." : "Profil speichern"} onPress={save} disabled={guest || saving} />
          </Card>
        ) : null}

        {!profileLoading && tab === "achievements" ? (
          <>
            <Card style={styles.card}>
              <View style={styles.cardTop}>
                <Heading>Erfolge</Heading>
                <Pressable onPress={evaluateAchievements} disabled={guest} style={styles.smallAction}>
                  <Muted style={styles.smallActionText}>Prüfen</Muted>
                </Pressable>
              </View>
              <Muted>{insights.points} Punkte · {insights.earned.length} freigeschaltet · {insights.tiers.length} Gesamtstufen</Muted>
            </Card>
            {(achievements.groups || []).length ? (
              (achievements.groups || []).map((group) => (
                <AchievementGroupCard
                  key={group.code}
                  group={group}
                  open={Boolean(openGroups[group.code])}
                  onToggle={() => setOpenGroups((current) => ({ ...current, [group.code]: !current[group.code] }))}
                />
              ))
            ) : (
              <Card style={styles.card}>
                <EmptyState icon="trophy-outline" title="Noch keine Erfolge" detail="Sobald automatische oder manuelle Erfolge freigeschaltet sind, erscheinen sie hier." tone="gold" />
              </Card>
            )}
          </>
        ) : null}

        {!profileLoading && tab === "privacy" ? (
          <Card style={styles.card}>
            <Heading>Privatsphäre</Heading>
            <Toggle label="Öffentliches Profil" detail="Profil ist in der Community-Suche sichtbar." value={Boolean(form.privacy_public_profile)} onValueChange={(v) => setField(setForm, "privacy_public_profile", v)} />
            <Toggle label="Twitch im Profil anzeigen" detail="Live-Embed darf auf deinem öffentlichen Profil erscheinen." value={Boolean(form.show_twitch_embed)} onValueChange={(v) => setField(setForm, "show_twitch_embed", v)} />
            <Muted>Direktnachrichten</Muted>
            <View style={styles.optionGrid}>
              {dmOptions.map(([value, label]) => (
                <Pressable key={value} onPress={() => setField(setForm, "dm_privacy", value)} style={[styles.option, form.dm_privacy === value && styles.optionActive]}>
                  <Muted style={[styles.optionText, form.dm_privacy === value && styles.optionTextActive]}>{label}</Muted>
                </Pressable>
              ))}
            </View>
            <Button label="Privatsphäre speichern" onPress={save} disabled={guest || saving} />
          </Card>
        ) : null}

        {!profileLoading && tab === "notifications" ? (
          <Card style={styles.card}>
            <Heading>Benachrichtigungen</Heading>
            <Toggle label="Newsletter" detail="Grundsätzliche Zustimmung für News und Events." value={Boolean(form.newsletter_consent)} onValueChange={(v) => setField(setForm, "newsletter_consent", v)} />
            {notificationLabels.map((item) => (
              <Toggle
                key={item.key}
                label={item.label}
                detail={item.detail}
                value={form.notification_preferences?.[item.key] ?? true}
                onValueChange={(v) =>
                  setForm((current) => ({
                    ...current,
                    notification_preferences: { ...(current.notification_preferences || {}), [item.key]: v },
                  }))
                }
              />
            ))}
            <Button label="Benachrichtigungen speichern" onPress={save} disabled={guest || saving} />
          </Card>
        ) : null}

        {guest ? (
          <Card style={styles.card}>
            <Muted>Live-Gastmodus aktiv. Profilbearbeitung und persönliche Einstellungen sind nach Login verfügbar.</Muted>
          </Card>
        ) : (
          <ActionRow icon="log-out-outline" label="Abmelden" detail="Dieses Gerät aus deinem Konto ausloggen." tone="danger" onPress={logout} />
        )}
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

function AchievementGroupCard({ group, open, onToggle }: { group: AchievementGroup; open: boolean; onToggle: () => void }) {
  const tiers = group.tiers || [];
  const earned = tiers.filter((tier) => tier.earned);
  const highest = [...earned].sort((a, b) => Number(b.level || 0) - Number(a.level || 0))[0];
  const accent = group.accent_color || colors.cyan;
  return (
    <Card style={[styles.card, highest && Number(highest.level || 0) >= 4 && { borderColor: `${accent}88` }]}>
      <Pressable onPress={onToggle} style={styles.achievementHead}>
        <View style={[styles.achievementIcon, { borderColor: `${accent}77`, backgroundColor: `${accent}18` }]}>
          <Body style={[styles.achievementIconText, { color: accent }]}>{highest ? "✓" : "•"}</Body>
        </View>
        <View style={styles.achievementTitle}>
          <Body style={styles.strong}>{group.name}</Body>
          <Muted>{group.description || `${earned.length}/${tiers.length} Stufen`}</Muted>
          {highest ? <Muted style={{ color: levelColors[highest.level || 1] || accent }}>{highest.level_name || `Level ${highest.level}`}</Muted> : null}
        </View>
        <Muted style={styles.chevron}>{open ? "▲" : "▼"}</Muted>
      </Pressable>
      {open ? (
        <View style={styles.tiers}>
          {tiers.map((tier) => <TierRow key={tier.code} tier={tier} accent={accent} />)}
        </View>
      ) : null}
    </Card>
  );
}

function TierRow({ tier, accent }: { tier: AchievementTier; accent: string }) {
  const color = levelColors[tier.level || 1] || accent;
  return (
    <View style={[styles.tierRow, tier.earned && { borderColor: `${color}66`, backgroundColor: `${color}10` }]}>
      <View style={styles.tierText}>
        <Muted style={[styles.tierLevel, { color }]}>{tier.earned ? "Freigeschaltet" : tier.condition_status === "planned" ? "Geplant" : "Gesperrt"}</Muted>
        <Body style={styles.strong}>{tier.name}</Body>
        {tier.description ? <Muted>{tier.description}</Muted> : null}
        {!tier.earned && Number(tier.target || 0) > 0 ? <ProgressBar value={Number(tier.percent || 0)} color={accent} /> : null}
      </View>
      <Muted style={styles.points}>+{tier.points || 0}</Muted>
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
      <Body style={[styles.statValue, tone === "gold" && styles.gold]}>{value}</Body>
      <Muted>{label}</Muted>
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
    flexWrap: "wrap",
    gap: 8,
  },
  tab: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    flexBasis: "31.5%",
    flexDirection: "row",
    flexGrow: 1,
    gap: 6,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: "rgba(41, 182, 232, 0.16)",
    borderColor: "rgba(41, 182, 232, 0.42)",
  },
  tabText: {
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
  achievementHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  achievementIcon: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  achievementIconText: {
    fontSize: 18,
    fontWeight: "900",
  },
  achievementTitle: {
    flex: 1,
    gap: 2,
  },
  chevron: {
    color: colors.cyan,
    fontWeight: "900",
  },
  tiers: {
    gap: 8,
    paddingTop: 4,
  },
  tierRow: {
    alignItems: "flex-start",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  tierText: {
    flex: 1,
    gap: 4,
  },
  tierLevel: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
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
  points: {
    color: colors.gold,
    fontWeight: "900",
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
