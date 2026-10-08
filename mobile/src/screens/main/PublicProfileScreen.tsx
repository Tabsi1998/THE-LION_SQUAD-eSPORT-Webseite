import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from "react-native";
import { AwardCard } from "../../components/AwardCard";
import { Card } from "../../components/Card";
import { HonourList, type Honour } from "../../components/Honours";
import { FriendButton } from "../../components/FriendButton";
import type { Relationship } from "../../lib/friends";
import { EmptyState, ErrorState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { AccountsCard, accountGroups, type LinkedAccount } from "../../components/LinkedAccounts";
import { ReportSheet, type ReportDraft } from "../../components/ReportSheet";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { PublicSeasonFindsCard } from "../../seasons/SeasonFinds";
import { PinnedAwardsCard, type PublicAchievementData, PublicAchievementsTab } from "../../achievements/profile/PublicAchievements";
import { prestigeStars } from "../../achievements/showcase/model";
import { api, errorMessage } from "../../lib/api";
import { sortAwards, type Award } from "../../lib/awards";
import { formatDate, formatStatus } from "../../lib/format";
import { blockUser, listBlocked, unblockUser } from "../../lib/moderation";
import type { AppStackParamList, ProfileTabKey } from "../../navigation/types";
import { seasonScrollProps } from "../../seasons/sky/scroll";
import { colors } from "../../theme";
import type { LiveStream, PersonalReferenceItem } from "../../types";
import { RecordCard, ReferenceWithPath } from "./profile/TournamentPath";

type Props = NativeStackScreenProps<AppStackParamList, "PublicProfile">;

export type PublicProfilePayload = {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  // Auszeichnungen (#230): nur aus öffentlichen Turnieren; das gewählte Banner steht im Kopf.
  awards?: Award[];
  // Ehrungen (#848): aus der Mitgliederakte - nur mit Freigabe des Vereins und dem Schalter der Person.
  honours?: Honour[];
  featured_award?: Award | null;
  bio?: string | null;
  role?: string | null;
  created_at?: string | null;
  birth_date?: string | null;
  country?: string | null;
  city?: string | null;
  discord_name?: string | null;
  twitch_handle?: string | null;
  show_twitch_embed?: boolean;
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
  faceit_handle?: string | null;
  startgg_handle?: string | null;
  roblox_handle?: string | null;
  osu_handle?: string | null;
  lichess_handle?: string | null;
  github_handle?: string | null;
  kick_handle?: string | null;
  reddit_handle?: string | null;
  spotify_handle?: string | null;
  threads_handle?: string | null;
  facebook_handle?: string | null;
  linkedin_handle?: string | null;
  snapchat_handle?: string | null;
  pinterest_handle?: string | null;
  telegram_handle?: string | null;
  wargaming_handle?: string | null;
  bungie_handle?: string | null;
  mastodon_handle?: string | null;
  bluesky_handle?: string | null;
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
  // Verknüpfte Konten (#459): das Häkchen kommt vom Server, nie aus dem Text.
  verified_platforms?: string[];
  linked_accounts?: LinkedAccount[];
  can_message?: boolean;
  relationship?: Relationship | null;
  stats?: Record<string, number | string | undefined>;
  achievement_level?: { level?: number; title?: string; points?: number; progress?: number; prestige?: number };
  badges?: any[];
  tournaments?: any[];
  f1_bests?: any[];
  teams?: any[];
  // Referenzen (#1149): dieselbe Liste wie im eigenen Profil - Turniere, Fast Laps, Jahreswertung.
  references?: { items?: PersonalReferenceItem[]; stats?: Record<string, number> } | null;
  privacy_public_profile?: boolean;
};

// Erfolge II (#619): Vergaben, Gruppen, die Angehefteten, die gefundenen Geheimen - oder „privat“.
type AchievementPayload = PublicAchievementData;

/** Die Reiter (#1149): eigenes und fremdes Profil haben dieselben, in derselben Reihenfolge - Mitglieder zusätzlich
 * „Ehrungen“. Referenzen (Turniere, Fast Laps, Jahreswertung) und Auszeichnungen (Banner, Trophäen) bleiben getrennt. */
export function profileTabs(member: boolean): Array<{ key: ProfileTabKey; label: string }> {
  return [
    { key: "overview", label: "Übersicht" },
    { key: "achievements", label: "Erfolge" },
    { key: "awards", label: "Auszeichnungen" },
    { key: "references", label: "Referenzen" },
    { key: "teams", label: "Teams" },
    ...(member ? [{ key: "honours" as const, label: "Ehrungen" }] : []),
  ];
}

/** Was nur das eigene Profil zeigt (#1149) - ohne „So sehen dich andere“. */
export type OwnProfileParts = {
  /** Kasten „Nur für dich“ oben in der Übersicht. */
  privateBox: React.ReactNode;
  achievements: React.ReactNode;
  awards: React.ReactNode;
  references: React.ReactNode;
  teams: React.ReactNode;
  honours: React.ReactNode;
  /** Ohne öffentliches Profil (privat): Kopf aus dem eigenen Konto. */
  fallback: PublicProfilePayload;
  refresh: () => Promise<void> | void;
  initialTab?: ProfileTabKey;
};

type Nav = { navigate: (screen: never, params?: never) => void };

export function PublicProfileScreen({ navigation, route }: Props) {
  return <ProfileView username={route.params.username} navigation={navigation as unknown as Nav} />;
}

/**
 * Ein Aufbau für jedes Profil (#1149): Kopf mit Bild, Level und Zahlenleiste, darunter die Reiter. Mit `own` ist es das
 * eigene Profil: Schalter „So sehen dich andere“, Kasten „Nur für dich“, eigene Erfolge, Auszeichnungen (als Banner
 * wählbar), Referenzen und Teams. Mit dem Schalter zeigt es genau, was die Privatsphäre allen zeigt.
 */
export function ProfileView({ username, navigation, own, header, scrollRef }: { username: string; navigation: Nav; own?: OwnProfileParts; header?: React.ReactNode; scrollRef?: React.RefObject<ScrollView | null> }) {
  const { user: me } = useAuth();
  const [profile, setProfile] = useState<PublicProfilePayload | null>(null);
  // Melden und Blockieren (#414): der Blockier-Stand kommt aus der eigenen Liste, nicht aus dem Profil.
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [report, setReport] = useState<(Omit<ReportDraft, "category" | "details"> & { targetName?: string }) | null>(null);
  const [achievements, setAchievements] = useState<AchievementPayload>({ awards: [], groups: [] });
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [tab, setTab] = useState<ProfileTabKey>(own?.initialTab || "overview");
  const [asOthers, setAsOthers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const ownMode = Boolean(own) && !asOthers;

  useEffect(() => {
    if (own?.initialTab) setTab(own.initialTab);
  }, [own?.initialTab]);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<PublicProfilePayload>(`/users/public/${username}`, asOthers ? { params: { view_as: "public" } } : undefined);
      setProfile(data || null);
      if (data?.id && me?.id && data.id !== me.id) {
        listBlocked().then((entries) => setBlockedByMe(entries.some((entry) => (entry.blocked_id || entry.user?.id) === data.id))).catch(() => setBlockedByMe(false));
      }
      api.get<LiveStream[]>("/streams/live").then(({ data: streams }) => setLiveStreams(Array.isArray(streams) ? streams : [])).catch(() => setLiveStreams([]));
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
  }, [asOthers, me?.id, username]);

  // Melden und Blockieren (#414) über „Mehr“ neben Nachricht und Freund.
  const toggleBlock = useCallback(() => {
    if (!profile?.id) return;
    const run = async () => {
      try {
        if (blockedByMe) await unblockUser(profile.id);
        else await blockUser(profile.id);
        setBlockedByMe(!blockedByMe);
        await load();
      } catch (err) {
        Alert.alert("Das hat nicht geklappt", errorMessage(err, "Blockierung konnte nicht geändert werden."));
      }
    };
    if (blockedByMe) {
      void run();
      return;
    }
    Alert.alert("Benutzer blockieren?", "Direktnachrichten und Freundschaftsanfragen werden in beide Richtungen unterbunden. Du kannst das unter Einstellungen → Privatsphäre wieder aufheben.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Blockieren", style: "destructive", onPress: () => { void run(); } },
    ]);
  }, [blockedByMe, load, profile?.id]);

  const openMoreMenu = useCallback(() => {
    if (!profile?.id) return;
    const name = profile.display_name || profile.username;
    Alert.alert(name, undefined, [
      { text: "Benutzer melden", onPress: () => setReport({ targetUserId: profile.id, targetName: name, direct: true }) },
      { text: blockedByMe ? "Blockierung aufheben" : "Blockieren", style: blockedByMe ? "default" : "destructive", onPress: toggleBlock },
      { text: "Abbrechen", style: "cancel" },
    ]);
  }, [blockedByMe, profile?.display_name, profile?.id, profile?.username, toggleBlock]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Ohne öffentliches Profil (privat) zeigt das eigene Profil den Kopf aus dem Konto - die Inhalte kommen ohnehin von dort.
  const shown = profile || (ownMode ? own?.fallback || null : null);
  // Konten einmal sauber (#527): ein Kasten mit Socials und Spielkonten, jedes Konto genau einmal.
  const accounts = useMemo(() => accountGroups(shown), [shown]);
  const liveStream = useMemo(() => {
    const twitch = cleanHandle(shown?.twitch_handle).toLowerCase();
    if (!shown || !twitch) return null;
    return liveStreams.find((stream) => (
      cleanHandle(stream.twitch_login).toLowerCase() === twitch ||
      stream.user_id === shown.id ||
      stream.username === shown.username
    )) || null;
  }, [liveStreams, shown]);
  const stats = shown?.stats || {};
  const display = shown?.display_name || shown?.username || "Spieler";
  const member = Boolean(shown?.is_club_member);
  const tabs = profileTabs(member);
  const activeTab = tabs.some((item) => item.key === tab) ? tab : "overview";
  const refresh = () => {
    setRefreshing(true);
    void load();
    if (own) void own.refresh();
  };

  // Auszeichnung antippen (#230): zum Turnier - über dem Tab, in dem man ist (#1144).
  const openAward = (award: Award) => {
    const target = award.tournament?.slug || award.tournament?.id;
    if (target) navigation.navigate("TournamentDetail" as never, { id: target } as never);
  };
  const openReference = (item: PersonalReferenceItem) => {
    if (!item.target_id) return;
    if (item.kind === "fastlap") navigation.navigate("FastLapDetail" as never, { id: item.target_id } as never);
    else if (item.kind === "season") navigation.navigate("SeasonPass" as never);
    else navigation.navigate("TournamentDetail" as never, { id: item.target_id } as never);
  };

  const ownSwitch = own ? (
    <View style={styles.asOthers} testID="profile-as-others">
      <View style={styles.flex}>
        <Body style={styles.strong}>So sehen dich andere</Body>
        <Muted>{asOthers ? "Nur, was deine Privatsphäre allen zeigt – ohne Anmeldung." : "Aus: du siehst alles, auch „Nur für dich“."}</Muted>
      </View>
      <Switch
        value={asOthers}
        onValueChange={setAsOthers}
        accessibilityLabel="So sehen dich andere"
        trackColor={{ false: "rgba(255,255,255,0.16)", true: "rgba(41,182,232,0.45)" }}
        thumbColor={asOthers ? colors.cyan : colors.muted}
        testID="profile-as-others-switch"
      />
    </View>
  ) : null;

  if (loading && !shown) {
    return (
      <Screen>
        {header}
        <SkeletonList count={4} hasImage={false} />
      </Screen>
    );
  }

  if (!shown) {
    return (
      <Screen padded={false}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.cyan} />}>
          {header}
          {ownSwitch}
          {own ? (
            <EmptyState icon="lock-closed-outline" title="Dein Profil ist privat" detail="Andere sehen dein Profil nicht. Öffentlich stellst du es in den Einstellungen unter Privatsphäre." />
          ) : (
            <ErrorState title="Profil nicht sichtbar" detail={error || "Dieses Profil ist privat oder wurde entfernt."} />
          )}
        </ScrollView>
      </Screen>
    );
  }

  const references = Array.isArray(shown.references?.items) ? shown.references?.items || [] : [];

  return (
    <Screen padded={false}>
      <ScrollView
        ref={scrollRef}
        {...(own ? seasonScrollProps("Profile") : {})}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.cyan} />}
        testID={own ? "own-profile" : "public-profile"}
      >
        {header}
        {shown.featured_award ? (
          <View style={styles.featured} testID="profile-featured-award">
            <AwardCard award={shown.featured_award} featured onPress={() => openAward(shown.featured_award as Award)} />
          </View>
        ) : null}
        <View style={styles.hero}>
          <MediaImage
            uri={shown.banner_url}
            style={styles.banner}
            fallback={<Ionicons name="person-circle-outline" color={colors.cyan} size={52} />}
          />
          <View style={styles.heroShade} />
          <View style={styles.identityCard}>
            <View style={styles.levelRing} testID="profile-level-ring">
              <MediaImage
                uri={shown.avatar_url}
                style={styles.avatar}
                fallback={<Body style={styles.avatarText}>{display.slice(0, 1).toUpperCase()}</Body>}
              />
              <View style={styles.levelChip}><Body style={styles.levelChipText}>LVL {shown.achievement_level?.level || stats.level || 1}</Body></View>
            </View>
            <View style={styles.identityText}>
              <Muted>@{shown.username}{shown.created_at ? ` · dabei seit ${formatDate(shown.created_at)}` : ""}</Muted>
              <Title>{display}</Title>
              <View style={styles.wrap}>
                <Pill label={member ? "Vereinsmitglied" : "Community"} tone={member ? "success" : "cyan"} />
                <Pill label={`${shown.achievement_level?.title || `Level ${shown.achievement_level?.level || stats.level || 1}`}${Number(shown.achievement_level?.prestige || 0) > 0 ? ` ${prestigeStars(shown.achievement_level?.prestige)}` : ""}`} tone="gold" />
                {shown.role && shown.role !== "player" ? <Pill label={formatStatus(shown.role)} /> : null}
              </View>
              {!own && shown.can_message ? (
                <Pressable onPress={() => navigation.navigate("DirectThread" as never, { userId: shown.id, title: display } as never)} style={({ pressed }) => [styles.messageButton, pressed && styles.pressed]}>
                  <Ionicons name="chatbubble-ellipses-outline" color={colors.black} size={16} />
                  <Body style={styles.messageButtonText}>Nachricht</Body>
                </Pressable>
              ) : null}
              {/* Freund hinzufügen (#240): der Zustand kommt aus der Profil-Antwort und wird live nachgeladen. */}
              {!own && shown.relationship && shown.relationship.status !== "self" ? <FriendButton userId={shown.id} initial={shown.relationship} /> : null}
              {!own && me?.id && shown.id !== me.id ? (
                <Pressable onPress={openMoreMenu} accessibilityRole="button" accessibilityLabel="Melden oder blockieren" style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]} testID="profile-more">
                  <Ionicons name="ellipsis-horizontal" color={colors.cyan} size={16} />
                  <Muted style={styles.moreButtonText}>{blockedByMe ? "Blockiert" : "Mehr"}</Muted>
                </Pressable>
              ) : null}
              <ReportSheet draft={report} onClose={() => setReport(null)} onSent={() => Alert.alert("Danke", "Die Moderation sieht sich das an.")} />
            </View>
          </View>
        </View>

        {/* Die Zahlenleiste (#1149): dieselben Zahlen im eigenen und im fremden Profil. */}
        <View style={styles.statBar} testID="profile-stats">
          <BarStat label="Punkte" value={Number(stats.points ?? shown.achievement_level?.points ?? 0).toLocaleString("de-DE")} tone="gold" />
          <BarStat label="Siege" value={stats.wins ?? 0} />
          <BarStat label="Podium" value={stats.top3 ?? 0} />
          <BarStat label="Turniere" value={stats.tournaments ?? shown.tournaments?.length ?? 0} />
          <BarStat label="Fast Laps" value={stats.fast_laps ?? shown.f1_bests?.length ?? 0} />
        </View>

        {ownSwitch}

        <SegmentedTabs items={tabs} value={activeTab} onChange={setTab} />

        {activeTab === "overview" ? (
          <>
            {ownMode ? own?.privateBox : null}
            <Card style={styles.card}>
              <Heading>Spielerprofil</Heading>
              {shown.bio ? <Body>{shown.bio}</Body> : <Muted>Keine Bio freigegeben.</Muted>}
            </Card>

            {/* Bilanz gegen Gegner (#1193): die fünf häufigsten - für andere nur Gegner mit öffentlichem Profil. */}
            <RecordCard
              username={shown.username}
              publicView={!ownMode}
              onOpenUser={(name) => navigation.navigate("PublicProfile" as never, { username: name } as never)}
              onOpenTeam={(id) => navigation.navigate("TeamDetail" as never, { id } as never)}
            />

            {/* Angeheftete Erfolge (#619) zuerst, wie im Web - „Alle ansehen“ führt in den Reiter. */}
            {!achievements.achievements_hidden ? <PinnedAwardsCard pinned={achievements.pinned || []} onShowAll={() => setTab("achievements")} /> : null}

            {/* Saison-Fundstücke (#678): nur mit dem Schalter der Person - und nur die Summen. */}
            <PublicSeasonFindsCard userId={shown.id} own={ownMode} />

            <InfoGrid
              title="Öffentliche Infos"
              rows={[
                ["Mitglied seit", formatDate(shown.created_at)],
                ["Geburtstag", shown.birth_date ? formatDate(shown.birth_date) : ""],
                ["Ort", [shown.city, shown.country].filter(Boolean).join(", ")],
                ["Mitgliedschaft", membershipLabel(shown)],
              ]}
            />

            <InfoGrid
              title="Gaming Setup"
              rows={[
                ["Lieblingsspiele", (shown.favorite_games || []).join(", ")],
                ["Plattformen", listValue(shown.main_platforms?.length ? shown.main_platforms : shown.main_platform)],
                ["Eingabe", listValue(shown.input_devices)],
                ["Abos", listValue(shown.gaming_subscriptions)],
              ]}
            />

            {shown.show_twitch_embed && shown.twitch_handle ? (
              <ProfileStreamCard profile={shown} stream={liveStream} />
            ) : null}

            <AccountsCard groups={accounts} />
          </>
        ) : null}

        {activeTab === "achievements" ? (ownMode ? own?.achievements : <PublicAchievementsTab data={achievements} displayName={display} />) : null}

        {activeTab === "awards" ? (ownMode ? own?.awards : (
          (shown.awards || []).length ? (
            <View style={styles.list} testID="public-profile-awards">
              {sortAwards(shown.awards).map((award) => <AwardCard key={award.id} award={award} onPress={() => openAward(award)} />)}
            </View>
          ) : <EmptyState icon="medal-outline" title="Noch keine Auszeichnungen" detail="Auszeichnungen kommen aus öffentlichen Turnieren des Vereins." />
        )) : null}

        {activeTab === "references" ? (ownMode ? own?.references : (
          references.length ? (
            <View style={styles.list} testID="public-profile-references">
              {references.map((item) => <ReferenceWithPath key={item.id} item={item} username={shown.username} publicView onOpen={openReference} />)}
            </View>
          ) : (shown.tournaments || []).length || (shown.f1_bests || []).length ? (
            <>
              <TournamentTab items={shown.tournaments || []} onOpen={(item) => navigation.navigate("TournamentDetail" as never, { id: item.slug || item.id } as never)} />
              {(shown.f1_bests || []).length ? <FastLapTab items={shown.f1_bests || []} onOpen={(item) => navigation.navigate("FastLapDetail" as never, { id: item.challenge?.slug || item.challenge?.id } as never)} /> : null}
            </>
          ) : <EmptyState icon="ribbon-outline" title="Noch keine Referenzen" detail="Turniere und Fast-Lap-Zeiten erscheinen hier, sobald sie öffentlich sind." />
        )) : null}

        {activeTab === "teams" ? (ownMode ? own?.teams : <TeamTab items={shown.teams || []} onOpen={(item) => navigation.navigate("TeamDetail" as never, { id: item.id } as never)} />) : null}

        {activeTab === "honours" ? (ownMode ? own?.honours : (
          (shown.honours || []).length ? (
            <Card style={styles.card} testID="public-profile-honours">
              <HonourList honours={shown.honours || []} />
            </Card>
          ) : <EmptyState icon="ribbon-outline" title="Keine Ehrungen freigegeben" detail="Ehrungen aus der Mitgliederakte stehen hier, wenn der Verein sie freigibt und die Person sie zeigt." tone="gold" />
        )) : null}
      </ScrollView>
    </Screen>
  );
}

function ProfileStreamCard({ profile, stream }: { profile: PublicProfilePayload; stream: LiveStream | null }) {
  const channel = cleanHandle(profile.twitch_handle);
  const url = stream?.stream_url || (channel ? `https://www.twitch.tv/${channel}` : "");
  if (!channel) return null;
  return (
    <Pressable onPress={() => url ? Linking.openURL(url).catch(() => {}) : undefined} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={[styles.card, styles.streamProfileCard]}>
        <View style={styles.cardTop}>
          <View style={styles.streamIcon}>
            <Ionicons name="radio-outline" color={stream ? colors.live : colors.cyan} size={20} />
          </View>
          <View style={styles.flex}>
            <Muted style={stream ? styles.liveText : styles.textCyan}>{stream ? "JETZT LIVE" : "TWITCH"}</Muted>
            <Heading>{channel}</Heading>
            <Muted numberOfLines={2}>{stream?.title || "Stream auf Twitch öffnen"}</Muted>
            {stream?.game_name || stream?.viewer_count ? (
              <Muted>{[stream.game_name, stream.viewer_count ? `${stream.viewer_count} Zuschauer` : ""].filter(Boolean).join(" · ")}</Muted>
            ) : null}
          </View>
          <Ionicons name="open-outline" color={colors.muted} size={18} />
        </View>
      </Card>
    </Pressable>
  );
}

function TournamentTab({ items, onOpen }: { items: any[]; onOpen: (item: any) => void }) {
  if (!items.length) return <EmptyState icon="calendar-outline" title="Keine Turniere" detail="Keine öffentliche Turnierhistorie sichtbar." />;
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
  if (!items.length) return <EmptyState icon="speedometer-outline" title="Keine Fast-Lap-Zeiten" detail="Keine öffentlichen Fast-Lap-Bestzeiten sichtbar." tone="gold" />;
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
  if (!items.length) return <EmptyState icon="people-outline" title="Keine Teams" detail="Keine öffentlichen Teamdaten sichtbar." />;
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

/** Eine Zahl der Zahlenleiste im Profilkopf (#1149). */
function BarStat({ label, value, tone }: { label: string; value: unknown; tone?: "gold" }) {
  return (
    <View style={styles.barStat}>
      <Body style={[styles.barValue, tone === "gold" && styles.gold]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{String(value ?? 0)}</Body>
      <Muted style={styles.barLabel} numberOfLines={1}>{label}</Muted>
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

const styles = StyleSheet.create({
  asOthers: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  levelRing: {
    alignItems: "center",
    borderColor: colors.gold,
    borderRadius: 44,
    borderWidth: 3,
    height: 82,
    justifyContent: "center",
    width: 82,
  },
  levelChip: {
    backgroundColor: colors.gold,
    borderRadius: 4,
    bottom: -9,
    paddingHorizontal: 6,
    position: "absolute",
  },
  levelChipText: {
    color: colors.black,
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 15,
  },
  statBar: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
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
  featured: {
    marginBottom: 4,
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
    borderRadius: 35,
    height: 70,
    overflow: "hidden",
    width: 70,
  },
  barStat: {
    alignItems: "center",
    flex: 1,
    gap: 1,
  },
  barValue: {
    color: colors.white,
    fontSize: 17,
    fontWeight: "900",
  },
  barLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
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
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
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
  moreButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "rgba(41,182,232,0.4)",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  moreButtonText: {
    color: colors.cyan,
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
  strong: {
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
  streamProfileCard: {
    borderColor: "rgba(145,70,255,0.35)",
  },
  streamIcon: {
    alignItems: "center",
    backgroundColor: "rgba(145,70,255,0.14)",
    borderColor: "rgba(145,70,255,0.38)",
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  liveText: {
    color: colors.live,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
});
