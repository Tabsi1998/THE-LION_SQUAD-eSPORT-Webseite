import { Ionicons } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { ContentCard } from "../../components/ContentCard";
import { EmptyState, OfflineNotice, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage, responseFromCache } from "../../lib/api";
import { displayName, formatDate, formatStatus } from "../../lib/format";
import { isGuestUser } from "../../live";
import type { MainTabParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { ClubEvent, DashboardAction, MobileDashboardData, NewsPost, Tournament } from "../../types";

type Props = BottomTabScreenProps<MainTabParamList, "Dashboard">;
type TimelineItem = {
  id: string;
  kind: "tournament" | "event";
  title: string;
  date?: string | null;
  status?: string;
  phaseLabel?: string;
  detail?: string | null;
  bannerUrl?: string | null;
  targetId?: string;
  registrationStatus?: string | null;
};
type QuickActionItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

const emptyDashboard: MobileDashboardData = {
  me: { tournaments: [], events: [], matches: [], actions: [] },
  public: { tournaments: [], events: [] },
  news: [],
  stats: { my_tournaments: 0, my_events: 0, open_matches: 0, open_actions: 0, news: 0, public_tournaments: 0, public_events: 0 },
};

function normalizeDashboard(payload?: Partial<MobileDashboardData> | null): MobileDashboardData {
  return {
    me: {
      tournaments: Array.isArray(payload?.me?.tournaments) ? payload.me.tournaments : [],
      events: Array.isArray(payload?.me?.events) ? payload.me.events : [],
      matches: Array.isArray(payload?.me?.matches) ? payload.me.matches : [],
      actions: Array.isArray(payload?.me?.actions) ? payload.me.actions : [],
    },
    public: {
      tournaments: Array.isArray(payload?.public?.tournaments) ? payload.public.tournaments : [],
      events: Array.isArray(payload?.public?.events) ? payload.public.events : [],
    },
    news: Array.isArray(payload?.news) ? payload.news : [],
    stats: { ...emptyDashboard.stats, ...(payload?.stats || {}) },
  };
}

export function DashboardScreen({ navigation }: Props) {
  const { user, refreshMe } = useAuth();
  const [data, setData] = useState<MobileDashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const isGuest = isGuestUser(user);
  const quickActions = useMemo(() => {
    const actions: QuickActionItem[] = [
      { icon: "chatbubbles-outline", label: "Nachrichten", onPress: () => navigation.navigate("More", { screen: "DirectMessages" }) },
      { icon: "trophy-outline", label: "Jahreswertung", onPress: () => navigation.navigate("More", { screen: "SeasonPass" }) },
      { icon: "newspaper-outline", label: "News", onPress: () => navigation.navigate("More", { screen: "NewsList" }) },
      { icon: "calendar-outline", label: "Turniere", onPress: () => navigation.navigate("Tournaments", { screen: "TournamentList" }) },
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
      setData(normalizeDashboard(response.data));
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

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

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
    return source.sort((a, b) => dateSort(a.date) - dateSort(b.date));
  }, [data, isGuest]);
  const liveItems = useMemo(() => timeline.filter(isLiveTimelineItem).slice(0, 3), [timeline]);

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
            <Muted>THE LION SQUAD</Muted>
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
        <Card style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.heroMark}>
              <Ionicons name={isGuest ? "radio-outline" : "shield-checkmark-outline"} color={colors.black} size={22} />
            </View>
            <View style={styles.flex}>
              <Muted style={styles.heroEyebrow}>{isGuest ? "THE LION SQUAD" : "Willkommen zurück"}</Muted>
              <Title>{isGuest ? "Live Home" : displayName(user)}</Title>
            </View>
          </View>
          <Body style={styles.heroBody}>{isGuest ? "Aktuelle Turniere, Events und News aus der Website." : "Deine nächsten Termine, offenen Aktionen und Vereins-News."}</Body>
          <View style={styles.heroBadges}>
            <Badge label={isGuest ? "Gastmodus" : user?.is_club_member ? "Vereinsmitglied" : "Community"} tone={isGuest || !user?.is_club_member ? "cyan" : "gold"} />
            {!isGuest && user?.is_tournament_staff ? <Badge label="Staff" /> : null}
          </View>
        </Card>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        {offline && !error ? <OfflineNotice /> : null}

        <View style={styles.grid}>
          <Stat label={isGuest ? "Turniere" : "Meine Termine"} value={String(isGuest ? data.stats.public_tournaments : data.stats.my_tournaments + data.stats.my_events)} />
          <Stat label={isGuest ? "Events" : "Aktionen"} value={String(isGuest ? data.stats.public_events : data.stats.open_actions)} tone="gold" />
          <Stat label="News" value={String(data.stats.news)} />
        </View>

        <Section title="Schnellzugriff">
          <View style={styles.quickGrid}>
            {quickActions.map((action) => (
              <QuickAction key={action.label} icon={action.icon} label={action.label} onPress={action.onPress} />
            ))}
          </View>
        </Section>

        {liveItems.length ? (
          <Section title="Heute und Live">
            {liveItems.map((item) => (
              <TimelineCard key={`live-${item.kind}-${item.id}`} item={item} onPress={() => openTimelineItem(item)} />
            ))}
          </Section>
        ) : null}

        <Section title={isGuest ? "Aktuell geplant" : "Meine nächsten Termine"} actionLabel="Alle Turniere" onAction={() => navigation.navigate("Tournaments")}>
          {timeline.length ? (
            timeline.slice(0, 6).map((item) => (
              <TimelineCard key={`${item.kind}-${item.id}`} item={item} onPress={() => openTimelineItem(item)} />
            ))
          ) : (
            <EmptyState icon="calendar-outline" title={isGuest ? "Noch keine Termine" : "Keine eigenen Termine"} detail={isGuest ? "Sobald Website-Termine veröffentlicht sind, stehen sie hier." : "Deine Turnier- und Event-Anmeldungen erscheinen hier automatisch."} />
          )}
        </Section>

        {!isGuest ? (
          <Section title="Offene Aktionen">
            {data.me.actions.length ? (
              data.me.actions.map((action) => (
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
              ))
            ) : (
              <EmptyState icon="checkmark-circle-outline" title="Keine offenen Aktionen" detail="Check-ins, offene Matches und wichtige Hinweise landen automatisch hier." />
            )}
          </Section>
        ) : null}

        {!isGuest && data.me.matches.length ? (
          <Section title="Nächste Matches">
            {data.me.matches.slice(0, 4).map((match) => (
              <Pressable key={match.id} onPress={() => navigation.navigate("Tournaments", { screen: "MatchDetail", params: { id: match.id } })} style={({ pressed }) => [pressed && styles.pressed]}>
                <Card style={styles.compactCard}>
                  <Body style={styles.rowTitle}>{match.tournament_title || match.opponent_name || "Match"}</Body>
                  <Muted>{formatDate(match.scheduled_at)} · {match.round_name || formatStatus(match.status)}</Muted>
                </Card>
              </Pressable>
            ))}
          </Section>
        ) : null}

        <Section
          title="Jahreswertung"
          actionLabel="Rangliste"
          onAction={() => navigation.navigate("More", { screen: "SeasonPass" })}
        >
          <Pressable
            onPress={() => navigation.navigate("More", { screen: "SeasonPass" })}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Card style={styles.seasonCard}>
              <View style={styles.seasonIcon}>
                <Ionicons name="trophy-outline" color={colors.gold} size={26} />
              </View>
              <View style={styles.flex}>
                <Body style={styles.rowTitle}>Jahreswertung {new Date().getFullYear()}</Body>
                <Muted>Punkte aus Turnieren, Fast Laps, Events und gepflegten Wertungen.</Muted>
                <Muted style={styles.seasonHint}>Rangliste ansehen</Muted>
              </View>
            </Card>
          </Pressable>
        </Section>

        <Section title="News">
          {data.news.length ? (
            data.news.slice(0, 4).map((post) => (
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

function tournamentToTimeline(tournament: Tournament): TimelineItem {
  return {
    id: tournament.id,
    kind: "tournament",
    title: tournament.title,
    date: tournament.start_date,
    status: tournament.status,
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
    phaseLabel: event.public_phase?.label,
    detail: [event.location, event.city].filter(Boolean).join(" · ") || event.event_type || event.type,
    bannerUrl: event.banner_url,
    targetId: event.slug || event.id,
    registrationStatus: event.own_registration?.status,
  };
}

function dateSort(value?: string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = new Date(value).getTime();
  return Number.isNaN(date) ? Number.MAX_SAFE_INTEGER : date;
}

function isLiveTimelineItem(item: TimelineItem) {
  const status = `${item.status || ""} ${item.phaseLabel || ""}`.toLowerCase();
  if (status.includes("live") || status.includes("check") || status.includes("running") || status.includes("progress")) {
    return true;
  }
  if (status.includes("registration") || status.includes("anmeldung")) {
    return true;
  }
  return isToday(item.date);
}

function isToday(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
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
  const detail = [item.detail, item.registrationStatus ? `Anmeldung: ${formatStatus(item.registrationStatus)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <ContentCard
      kind={item.kind}
      title={item.title}
      image={item.bannerUrl}
      date={item.date}
      label={item.phaseLabel}
      status={item.status}
      detail={detail}
      onPress={onPress}
    />
  );
}

function NewsCard({ post, onPress }: { post: NewsPost; onPress: () => void }) {
  const detail = [post.category, post.excerpt || post.summary].filter(Boolean).join(" · ");

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
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}>
      <Ionicons name={icon} color={colors.cyan} size={20} />
      <Muted style={styles.quickLabel}>{label}</Muted>
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
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  error: {
    color: colors.live,
  },
  grid: {
    flexDirection: "row",
    gap: 10,
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickAction: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 6,
    justifyContent: "center",
    minHeight: 74,
    padding: 10,
  },
  quickLabel: {
    color: colors.white,
    fontWeight: "900",
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
  compactCard: {
    gap: 4,
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
});
