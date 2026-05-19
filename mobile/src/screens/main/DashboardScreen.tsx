import { Ionicons } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
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

const emptyDashboard: MobileDashboardData = {
  me: { tournaments: [], events: [], matches: [], actions: [] },
  public: { tournaments: [], events: [] },
  news: [],
  stats: { my_tournaments: 0, my_events: 0, open_matches: 0, open_actions: 0, news: 0, public_tournaments: 0, public_events: 0 },
};

export function DashboardScreen({ navigation }: Props) {
  const { user, refreshMe } = useAuth();
  const [data, setData] = useState<MobileDashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const isGuest = isGuestUser(user);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.get<MobileDashboardData>("/mobile/dashboard");
      setData({
        ...emptyDashboard,
        ...response.data,
        me: { ...emptyDashboard.me, ...(response.data?.me || {}) },
        public: { ...emptyDashboard.public, ...(response.data?.public || {}) },
        stats: { ...emptyDashboard.stats, ...(response.data?.stats || {}) },
        news: Array.isArray(response.data?.news) ? response.data.news : [],
      });
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

  const openTournament = useCallback((id?: string | null) => {
    if (!id) return;
    navigation.navigate("Tournaments", { screen: "TournamentDetail", params: { id } });
  }, [navigation]);

  const openAction = useCallback((action: DashboardAction) => {
    if (action.target_type === "tournament" && action.target_id) {
      openTournament(action.target_id);
      return;
    }
    if (action.target_type === "event") {
      navigation.navigate("More", { screen: "InfoCenter", params: { section: "events" } });
    }
  }, [navigation, openTournament]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Dashboard wird geladen ..." />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
      >
        <View style={styles.header}>
          <Muted>{isGuest ? "THE LION SQUAD" : "Willkommen zurueck"}</Muted>
          <Title>{isGuest ? "Live Home" : displayName(user)}</Title>
          <Body>{isGuest ? "Aktuelle Turniere, Events und News aus der Website." : "Deine naechsten Termine, offenen Aktionen und Vereins-News."}</Body>
        </View>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        <View style={styles.grid}>
          <Stat label={isGuest ? "Turniere" : "Meine Termine"} value={String(isGuest ? data.stats.public_tournaments : data.stats.my_tournaments + data.stats.my_events)} />
          <Stat label={isGuest ? "Events" : "Aktionen"} value={String(isGuest ? data.stats.public_events : data.stats.open_actions)} tone="gold" />
          <Stat label="News" value={String(data.stats.news)} />
        </View>

        <Section title={isGuest ? "Aktuell geplant" : "Meine naechsten Termine"} actionLabel="Alle Turniere" onAction={() => navigation.navigate("Tournaments")}>
          {timeline.length ? (
            timeline.slice(0, 6).map((item) => (
              <TimelineCard key={`${item.kind}-${item.id}`} item={item} onPress={() => item.kind === "tournament" ? openTournament(item.targetId) : navigation.navigate("More", { screen: "InfoCenter", params: { section: "events" } })} />
            ))
          ) : (
            <EmptyState title={isGuest ? "Noch keine Termine" : "Keine eigenen Termine"} detail={isGuest ? "Sobald Website-Termine veroeffentlicht sind, stehen sie hier." : "Deine Turnier- und Event-Anmeldungen erscheinen hier automatisch."} />
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
                    {action.target_type === "tournament" || action.target_type === "event" ? <Ionicons name="chevron-forward" color={colors.muted} size={18} /> : null}
                  </Card>
                </Pressable>
              ))
            ) : (
              <EmptyState title="Keine offenen Aktionen" detail="Check-ins, offene Matches und wichtige Hinweise landen automatisch hier." />
            )}
          </Section>
        ) : null}

        {!isGuest && data.me.matches.length ? (
          <Section title="Naechste Matches">
            {data.me.matches.slice(0, 4).map((match) => (
              <Card key={match.id} style={styles.compactCard}>
                <Body style={styles.rowTitle}>{match.tournament_title || match.opponent_name || "Match"}</Body>
                <Muted>{formatDate(match.scheduled_at)} · {match.round_name || formatStatus(match.status)}</Muted>
              </Card>
            ))}
          </Section>
        ) : null}

        <Section title="News" actionLabel="Aktualisieren" onAction={load}>
          {data.news.length ? (
            data.news.slice(0, 4).map((post) => (
              <NewsCard
                key={post.id}
                post={post}
                onPress={() => navigation.navigate("More", { screen: "NewsDetail", params: { id: post.slug || post.id } })}
              />
            ))
          ) : (
            <EmptyState title="Keine News" detail="Aktuelle Website-News werden hier eingeblendet, sobald sie veroeffentlicht sind." />
          )}
        </Section>

        <Button label="Aktualisieren" variant="secondary" onPress={load} />
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
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.timelineCard}>
        <MediaImage
          uri={item.bannerUrl}
          style={styles.thumb}
          fallback={<Ionicons name={item.kind === "tournament" ? "trophy-outline" : "calendar-outline"} color={colors.cyan} size={22} />}
        />
        <View style={styles.flex}>
          <View style={styles.rowTop}>
            <Body style={styles.rowTitle}>{item.title}</Body>
            <Badge label={item.kind === "tournament" ? "Turnier" : "Event"} />
          </View>
          <Muted>{formatDate(item.date)} · {item.phaseLabel || formatStatus(item.status)}</Muted>
          {item.detail ? <Muted numberOfLines={1}>{item.detail}</Muted> : null}
          {item.registrationStatus ? <Muted style={styles.memberHint}>Anmeldung: {formatStatus(item.registrationStatus)}</Muted> : null}
        </View>
      </Card>
    </Pressable>
  );
}

function NewsCard({ post, onPress }: { post: NewsPost; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.newsCard}>
        <MediaImage
          uri={post.banner_url}
          style={styles.newsImage}
          fallback={<Ionicons name="newspaper-outline" color={colors.gold} size={24} />}
        />
        <View style={styles.flex}>
          <View style={styles.rowTop}>
            <Body style={styles.rowTitle}>{post.title}</Body>
            {post.pinned ? <Badge label="Top" tone="gold" /> : null}
          </View>
          <Muted>{formatDate(post.published_at || post.created_at)}{post.category ? ` · ${post.category}` : ""}</Muted>
          {post.excerpt || post.summary ? <Muted numberOfLines={2}>{post.excerpt || post.summary}</Muted> : null}
        </View>
      </Card>
    </Pressable>
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
  error: {
    color: colors.live,
  },
  grid: {
    flexDirection: "row",
    gap: 10,
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
  timelineCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
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
  newsCard: {
    flexDirection: "row",
    gap: 12,
  },
  newsImage: {
    borderRadius: 8,
    height: 82,
    width: 92,
  },
  thumb: {
    borderRadius: 8,
    height: 66,
    width: 72,
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
  memberHint: {
    color: colors.cyan,
    fontWeight: "800",
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
});
