import { Ionicons } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { ContentCard } from "../../components/ContentCard";
import { EmptyState, OfflineNotice, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { useBranding } from "../../branding/BrandingProvider";
import { api, errorMessage, responseFromCache } from "../../lib/api";
import { compareByNearestDate } from "../../lib/contentSort";
import { seasonLine, splitHomeTimeline, type HomeItem } from "../../lib/dashboard";
import { displayName, formatDate, formatEventType, formatNewsCategory, formatStatus, placeParts } from "../../lib/format";
import { isGuestUser } from "../../live";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import type { MainTabParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { ClubEvent, DashboardAction, LiveStream, Match, MobileDashboardData, NewsPost, Tournament } from "../../types";

// Was das Dashboard zeigt: eigene Matches, Turniere, Events, News, Streams und die Glocke.
const DASHBOARD_LIVE_RESOURCES = ["tournaments", "matches", "events", "news", "streams", "notifications", "teams", "f1"];

type Props = BottomTabScreenProps<MainTabParamList, "Dashboard">;
type TimelineItem = HomeItem;
type QuickActionItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

const emptyDashboard: MobileDashboardData = {
  me: { tournaments: [], events: [], matches: [], staff_matches: [], actions: [] },
  public: { tournaments: [], events: [] },
  news: [],
  streams: [],
  season: null,
  stats: { my_tournaments: 0, my_events: 0, open_matches: 0, staff_matches: 0, open_actions: 0, news: 0, public_tournaments: 0, public_events: 0, live_streams: 0 },
};
const OPEN_MATCH_STATUSES = new Set(["ready", "scheduled", "in_progress", "waiting_result"]);

function normalizeDashboard(payload?: Partial<MobileDashboardData> | null): MobileDashboardData {
  return {
    me: {
      tournaments: Array.isArray(payload?.me?.tournaments) ? payload.me.tournaments : [],
      events: Array.isArray(payload?.me?.events) ? payload.me.events : [],
      matches: Array.isArray(payload?.me?.matches) ? payload.me.matches : [],
      staff_matches: Array.isArray(payload?.me?.staff_matches) ? payload.me.staff_matches : [],
      actions: Array.isArray(payload?.me?.actions) ? payload.me.actions : [],
    },
    public: {
      tournaments: Array.isArray(payload?.public?.tournaments) ? payload.public.tournaments : [],
      events: Array.isArray(payload?.public?.events) ? payload.public.events : [],
    },
    news: Array.isArray(payload?.news) ? payload.news : [],
    streams: Array.isArray(payload?.streams) ? payload.streams : [],
    season: payload?.season ?? null,
    stats: { ...emptyDashboard.stats, ...(payload?.stats || {}) },
  };
}

export function DashboardScreen({ navigation }: Props) {
  const { user, refreshMe } = useAuth();
  const { clubName } = useBranding();
  const [data, setData] = useState<MobileDashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const isGuest = isGuestUser(user);
  // Nur Ziele, die nicht ohnehin in der Tab-Leiste stehen. Turniere sind der
  // Events-Tab, News und Jahreswertung haben unten eigene Abschnitte (#212).
  const quickActions = useMemo(() => {
    const actions: QuickActionItem[] = [
      { icon: "chatbubbles-outline", label: "Nachrichten", onPress: () => navigation.navigate("More", { screen: "DirectMessages" }) },
      { icon: "flash-outline", label: "Fast Laps", onPress: () => navigation.navigate("More", { screen: "FastLapList" }) },
    ];
    if (user?.is_club_member) {
      actions.push({ icon: "shield-checkmark-outline", label: "Verein", onPress: () => navigation.navigate("More", { screen: "InfoCenter", params: { section: "benefits" } }) });
    }
    return actions;
  }, [navigation, user?.is_club_member]);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.get<MobileDashboardData>("/mobile/dashboard");
      const nextData = normalizeDashboard(response.data);
      nextData.me.matches = nextData.me.matches.filter((match: any) => OPEN_MATCH_STATUSES.has(String(match.status || "")));
      setData(nextData);
      setOffline(responseFromCache(response));
      if (!isGuest) {
        await refreshMe().catch(() => {});
      }
    } catch (err) {
      setError(errorMessage(err, "Dashboard konnte nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isGuest, refreshMe]);

  const isFocused = useIsFocused();
  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));
  useLiveRefresh(load, DASHBOARD_LIVE_RESOURCES, { enabled: isFocused, fallbackMs: 10000 });

  const timeline = useMemo(() => {
    const source = isGuest
      ? [
          ...data.public.tournaments.map(tournamentToTimeline),
          ...data.public.events.map(eventToTimeline),
        ]
      : [
          ...data.me.tournaments.map(tournamentToTimeline),
          ...data.me.events.map(eventToTimeline),
      ];
    return source.sort((a, b) => compareByNearestDate(a.date, b.date, a.status, b.status, a.phaseLabel, b.phaseLabel));
  }, [data, isGuest]);
  // Jeder Termin steht nur einmal: entweder unter "Heute und Live" oder unter
  // "nächste Termine". Vorbei und Abgesagtes filtert schon der Server.
  const { live: liveItems, next: nextItems, moreCount } = useMemo(() => splitHomeTimeline(timeline), [timeline]);

  const openTournament = useCallback((id?: string | null) => {
    if (!id) return;
    navigation.navigate("Tournaments", { screen: "TournamentDetail", params: { id } });
  }, [navigation]);

  const openAction = useCallback((action: DashboardAction) => {
    if (action.target_type === "tournament" && action.target_id) {
      openTournament(action.target_id);
      return;
    }
    if (action.target_type === "match" && action.target_id) {
      navigation.navigate("Tournaments", { screen: "MatchDetail", params: { id: action.target_id } });
      return;
    }
    if (action.target_type === "event" && action.target_id) {
      navigation.navigate("Tournaments", { screen: "EventDetail", params: { id: action.target_id } });
    }
  }, [navigation, openTournament]);

  const openTimelineItem = useCallback((item: TimelineItem) => {
    if (item.kind === "tournament") {
      openTournament(item.targetId);
      return;
    }
    navigation.navigate("Tournaments", { screen: "EventDetail", params: { id: item.targetId || item.id } });
  }, [navigation, openTournament]);

  if (loading) {
    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Muted>{clubName}</Muted>
            <Title>LionsAPP</Title>
            <Muted>Dein Vereins- und eSports-Hub wird vorbereitet.</Muted>
          </View>
          <SkeletonList count={4} />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
      >
        {/* Eine Zeile Begrüßung mit den Pills daneben; der Erklärsatz ist weg (#248). */}
        <Card style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.heroMark}>
              <Ionicons name={isGuest ? "radio-outline" : "shield-checkmark-outline"} color={colors.black} size={22} />
            </View>
            <View style={styles.flex}>
              <Muted style={styles.heroEyebrow}>{isGuest ? clubName : "Hallo"}</Muted>
              <Title>{isGuest ? "Live Home" : displayName(user)}</Title>
            </View>
            <View style={styles.heroBadges}>
              <Badge label={isGuest ? "Gast" : user?.is_club_member ? "Vereinsmitglied" : "Community"} tone={isGuest || !user?.is_club_member ? "cyan" : "gold"} />
              {!isGuest && user?.is_tournament_staff ? <Badge label="Staff" /> : null}
            </View>
          </View>
          {isGuest ? <Body style={styles.heroBody}>Aktuelle Turniere, Events und News aus der Website.</Body> : null}
        </Card>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        {offline && !error ? <OfflineNotice /> : null}

        {/* Eine Null als Kennzahl sagt nichts: "Aktionen" nur, wenn es welche gibt (#248). */}
        <View style={styles.grid}>
          <Stat label={isGuest ? "Turniere" : "Meine Termine"} value={String(isGuest ? data.stats.public_tournaments : timeline.length)} />
          {isGuest ? <Stat label="Events" value={String(data.stats.public_events)} tone="gold" /> : null}
          {!isGuest && data.stats.open_actions > 0 ? <Stat label="Aktionen" value={String(data.stats.open_actions)} tone="gold" /> : null}
          <Stat label="News" value={String(data.stats.news)} />
        </View>

        {!isGuest && data.me.matches.length ? (
          <Section title="Meine aktiven Matches">
            {data.me.matches.slice(0, 6).map((match) => (
              <MatchOverviewCard
                key={match.id}
                match={match}
                onPress={() => navigation.navigate("Tournaments", { screen: "MatchDetail", params: { id: match.id } })}
              />
            ))}
          </Section>
        ) : null}

        {!isGuest && data.me.staff_matches.length ? (
          <Section title="Turnierleitung · Ergebnisse">
            {data.me.staff_matches.slice(0, 6).map((match) => (
              <MatchOverviewCard
                key={`staff-${match.id}`}
                match={match}
                staff
                onPress={() => navigation.navigate("Tournaments", { screen: "MatchDetail", params: { id: match.id } })}
              />
            ))}
          </Section>
        ) : null}

        <View style={styles.quickRow}>
          {quickActions.map((action) => (
            <QuickAction key={action.label} icon={action.icon} label={action.label} onPress={action.onPress} />
          ))}
        </View>

        {liveItems.length ? (
          <Section title="Heute und Live">
            {liveItems.map((item) => (
              <TimelineCard key={`live-${item.kind}-${item.id}`} item={item} onPress={() => openTimelineItem(item)} />
            ))}
          </Section>
        ) : null}

        {data.streams.length ? (
          <Section title="Vereinsmitglieder live">
            {data.streams.slice(0, 3).map((stream) => (
              <StreamCard key={`${stream.user_id || stream.username}-${stream.twitch_login}`} stream={stream} />
            ))}
          </Section>
        ) : null}

        {!isGuest && data.me.actions.length ? (
          <Section title="Offene Aktionen">
            {data.me.actions.map((action) => (
              <Pressable key={action.id} onPress={() => openAction(action)} style={({ pressed }) => [pressed && styles.pressed]}>
                <Card style={styles.actionCard}>
                  <View style={styles.actionIcon}>
                    <Ionicons name={iconForAction(action.type)} color={colors.cyan} size={18} />
                  </View>
                  <View style={styles.flex}>
                    <Body style={styles.rowTitle}>{action.label}</Body>
                    {action.detail ? <Muted>{action.detail}</Muted> : null}
                  </View>
                  {action.target_id ? <Ionicons name="chevron-forward" color={colors.muted} size={18} /> : null}
                </Card>
              </Pressable>
            ))}
          </Section>
        ) : null}

        <Section
          title={isGuest ? "Aktuell geplant" : "Meine nächsten Termine"}
          actionLabel={moreCount > 0 ? `Alle (${nextItems.length + liveItems.length + moreCount})` : "Alle Termine"}
          onAction={() => navigation.navigate("Tournaments")}
        >
          {nextItems.length ? (
            nextItems.map((item) => (
              <TimelineCard key={`${item.kind}-${item.id}`} item={item} onPress={() => openTimelineItem(item)} />
            ))
          ) : liveItems.length ? (
            <Muted>Alles Weitere steht oben unter „Heute und Live“.</Muted>
          ) : (
            <EmptyState icon="calendar-outline" title={isGuest ? "Noch keine Termine" : "Keine anstehenden Termine"} detail={isGuest ? "Sobald Website-Termine veröffentlicht sind, stehen sie hier." : "Sobald du dich für ein Turnier oder Event anmeldest, steht es hier. Vergangene Termine findest du im Profil unter Referenzen."} />
          )}
        </Section>

        {data.season ? (
          <Pressable
            onPress={() => navigation.navigate("More", { screen: "SeasonPass" })}
            style={({ pressed }) => [pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${data.season.name || "Jahreswertung"}: ${seasonLine(data.season)}`}
          >
            <Card style={styles.seasonRow}>
              <View style={styles.seasonIcon}>
                <Ionicons name="trophy-outline" color={colors.gold} size={20} />
              </View>
              <View style={styles.flex}>
                <Body style={styles.rowTitle}>{data.season.name || "Jahreswertung"}</Body>
                <Muted>{seasonLine(data.season)}</Muted>
              </View>
              <Ionicons name="chevron-forward" color={colors.muted} size={18} />
            </Card>
          </Pressable>
        ) : null}

        <Section title="News" actionLabel="Alle News" onAction={() => navigation.navigate("More", { screen: "NewsList" })}>
          {data.news.length ? (
            data.news.slice(0, 3).map((post) => (
              <NewsCard
                key={post.id}
                post={post}
                onPress={() => navigation.navigate("More", { screen: "NewsDetail", params: { id: post.slug || post.id } })}
              />
            ))
          ) : (
            <EmptyState icon="newspaper-outline" title="Keine News" detail="Aktuelle Website-News werden hier eingeblendet, sobald sie veröffentlicht sind." />
          )}
        </Section>

      </ScrollView>
    </Screen>
  );
}

function StreamCard({ stream }: { stream: LiveStream }) {
  const name = stream.member_profile?.gamertag || stream.member_profile?.display_name || stream.display_name || stream.username || stream.twitch_login || "Stream";
  const url = stream.stream_url || (stream.twitch_login ? `https://www.twitch.tv/${stream.twitch_login}` : "");
  return (
    <Pressable onPress={() => url ? Linking.openURL(url).catch(() => {}) : undefined} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.streamCard}>
        <View style={styles.streamIcon}>
          <Ionicons name="radio-outline" color={colors.live} size={20} />
        </View>
        <View style={styles.flex}>
          <Muted style={styles.liveLabel}>LIVE</Muted>
          <Body style={styles.rowTitle}>{name}</Body>
          <Muted numberOfLines={2}>{stream.title || "Live auf Twitch"}</Muted>
          <Muted>{[stream.game_name, stream.viewer_count ? `${stream.viewer_count} Zuschauer` : ""].filter(Boolean).join(" · ")}</Muted>
        </View>
        <Ionicons name="open-outline" color={colors.muted} size={18} />
      </Card>
    </Pressable>
  );
}

function tournamentToTimeline(tournament: Tournament): TimelineItem {
  return {
    id: tournament.id,
    kind: "tournament",
    title: tournament.title,
    date: tournament.start_date,
    status: tournament.status,
    phaseState: tournament.public_phase?.state,
    phaseLabel: tournament.public_phase?.label,
    detail: tournament.game?.display_name || tournament.game?.name || tournament.game_name || tournament.event?.name || tournament.format_label,
    bannerUrl: tournament.banner_url || tournament.game?.cover_url || tournament.game?.logo_url,
    targetId: tournament.slug || tournament.id,
    registrationStatus: tournament.my_registration?.status,
  };
}

function eventToTimeline(event: ClubEvent): TimelineItem {
  return {
    id: event.id,
    kind: "event",
    title: event.title || event.name || "Event",
    date: event.start_date || event.date,
    status: event.status,
    phaseState: event.public_phase?.state,
    phaseLabel: event.public_phase?.label,
    detail: placeParts(event.location, event.city).join(" · ") || formatEventType(event.event_type || event.type),
    bannerUrl: event.banner_url,
    targetId: event.slug || event.id,
    registrationStatus: event.own_registration?.status,
  };
}

function Section({ title, actionLabel, onAction, children }: { title: string; actionLabel?: string; onAction?: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Heading>{title}</Heading>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={10}>
            <Muted style={styles.sectionAction}>{actionLabel}</Muted>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function TimelineCard({ item, onPress }: { item: TimelineItem; onPress: () => void }) {
  // Die eigene Anmeldung als Pill neben dem Datum statt als Text (#248).
  return (
    <ContentCard
      kind={item.kind}
      title={item.title}
      image={item.bannerUrl}
      date={item.date}
      label={item.phaseLabel}
      status={item.status}
      secondaryLabel={item.registrationStatus ? formatStatus(item.registrationStatus) : null}
      detail={item.detail}
      onPress={onPress}
    />
  );
}

function MatchOverviewCard({ match, onPress, staff = false }: { match: Match; onPress: () => void; staff?: boolean }) {
  const detail = [
    match.opponent_name || match.participant_names?.join(" · "),
    match.round_name || (match.round ? `Runde ${match.round}` : null),
    match.station_label ? `Station ${match.station_label}` : null,
  ].filter(Boolean).join(" · ");
  const action = staff && match.can_submit_result
    ? "Ergebnis erfassen"
    : match.needs_result
      ? "Ergebnis öffnen"
      : "Match öffnen";

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={[styles.matchCard, match.needs_result && styles.matchCardUrgent]}>
        <View style={styles.matchIcon}>
          <Ionicons name={match.needs_result ? "create-outline" : "game-controller-outline"} color={match.needs_result ? colors.gold : colors.cyan} size={20} />
        </View>
        <View style={styles.flex}>
          <View style={styles.rowTop}>
            <Body style={styles.rowTitle}>{match.tournament_title || "Turniermatch"}</Body>
            <Badge label={formatStatus(match.status)} tone={match.needs_result ? "gold" : "cyan"} />
          </View>
          {detail ? <Muted numberOfLines={2}>{detail}</Muted> : null}
          <Muted>{formatDate(match.scheduled_at)}</Muted>
          <Muted style={match.needs_result ? styles.matchActionUrgent : styles.matchAction}>{action}</Muted>
        </View>
        <Ionicons name="chevron-forward" color={colors.muted} size={18} />
      </Card>
    </Pressable>
  );
}

function NewsCard({ post, onPress }: { post: NewsPost; onPress: () => void }) {
  const detail = [formatNewsCategory(post.category), post.excerpt || post.summary].filter(Boolean).join(" · ");

  return (
    <ContentCard
      kind="news"
      title={post.title}
      image={post.banner_url}
      date={post.published_at || post.created_at}
      label={post.pinned ? "Top" : null}
      detail={detail}
      onPress={onPress}
    />
  );
}

function Stat({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "gold" }) {
  return (
    <Card style={styles.stat}>
      <Body style={[styles.statValue, tone === "gold" && styles.gold]}>{value}</Body>
      <Muted numberOfLines={2}>{label}</Muted>
    </Card>
  );
}

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}>
      <Ionicons name={icon} color={colors.cyan} size={18} />
      <Muted style={styles.quickLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Muted>
    </Pressable>
  );
}

function Badge({ label, tone = "cyan" }: { label: string; tone?: "cyan" | "gold" }) {
  return (
    <View style={[styles.badge, tone === "gold" && styles.badgeGold]}>
      <Muted style={[styles.badgeText, tone === "gold" && styles.badgeGoldText]}>{label}</Muted>
    </View>
  );
}

function iconForAction(type: string) {
  if (type.includes("checkin")) return "checkbox-outline";
  if (type.includes("match")) return "game-controller-outline";
  if (type.includes("pending")) return "time-outline";
  return "alert-circle-outline";
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 28,
  },
  header: {
    gap: 7,
  },
  heroCard: {
    backgroundColor: colors.card,
    borderColor: "rgba(41, 182, 232, 0.32)",
    gap: 12,
    padding: 16,
  },
  heroTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  heroMark: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 10,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  heroEyebrow: {
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  heroBody: {
    color: "rgba(255,255,255,0.86)",
  },
  heroBadges: {
    alignItems: "flex-end",
    flexShrink: 0,
    gap: 6,
  },
  error: {
    color: colors.live,
  },
  grid: {
    flexDirection: "row",
    gap: 10,
  },
  quickRow: {
    // Drei gleich breite Pills in einer Zeile; "Verein" rutschte vorher in die zweite (#248).
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 8,
  },
  quickAction: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  quickLabel: {
    color: colors.white,
    flexShrink: 1,
    fontWeight: "900",
  },
  seasonRow: {
    alignItems: "center",
    borderColor: "rgba(255,215,0,0.28)",
    flexDirection: "row",
    gap: 12,
  },
  stat: {
    flex: 1,
    justifyContent: "center",
    minHeight: 86,
  },
  statValue: {
    color: colors.cyan,
    fontSize: 26,
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
  },
  section: {
    gap: 10,
  },
  sectionHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionAction: {
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  matchCard: {
    alignItems: "center",
    borderColor: "rgba(41,182,232,0.26)",
    flexDirection: "row",
    gap: 12,
  },
  matchCardUrgent: {
    borderColor: "rgba(240,180,41,0.48)",
  },
  matchIcon: {
    alignItems: "center",
    backgroundColor: "rgba(41,182,232,0.1)",
    borderRadius: 9,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  matchAction: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  matchActionUrgent: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  actionCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  actionIcon: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.28)",
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  flex: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  rowTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontWeight: "900",
  },
  badge: {
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.28)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeGold: {
    backgroundColor: "rgba(240, 180, 41, 0.12)",
    borderColor: "rgba(240, 180, 41, 0.32)",
  },
  badgeText: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
  },
  badgeGoldText: {
    color: colors.gold,
  },
  pressed: {
    opacity: 0.72,
  },
  seasonCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    borderColor: "rgba(240,180,41,0.3)",
  },
  seasonIcon: {
    alignItems: "center",
    backgroundColor: "rgba(240,180,41,0.12)",
    borderColor: "rgba(240,180,41,0.28)",
    borderRadius: 10,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  seasonHint: {
    color: colors.gold,
    fontWeight: "900",
  },
  streamCard: {
    alignItems: "center",
    borderColor: "rgba(255,59,48,0.34)",
    flexDirection: "row",
    gap: 12,
  },
  streamIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,59,48,0.12)",
    borderColor: "rgba(255,59,48,0.32)",
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  liveLabel: {
    color: colors.live,
    fontSize: 11,
    fontWeight: "900",
  },
});
