import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { StatusBadge } from "../../components/StatusBadge";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { ClubEvent, F1Challenge, Tournament } from "../../types";

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentList">;
type Filter = "all" | "events" | "tournaments" | "fastlaps";
type HubItem =
  | { kind: "event"; id: string; title: string; date?: string | null; status?: string; phase?: string; image?: string | null; detail?: string; raw: ClubEvent }
  | { kind: "tournament"; id: string; title: string; date?: string | null; status?: string; phase?: string; image?: string | null; detail?: string; raw: Tournament }
  | { kind: "fastlap"; id: string; title: string; date?: string | null; status?: string; phase?: string; image?: string | null; detail?: string; raw: F1Challenge };

const filters: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "events", label: "Events" },
  { key: "tournaments", label: "Turniere" },
  { key: "fastlaps", label: "Fast Laps" },
];

export function TournamentsScreen({ navigation }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [fastlaps, setFastlaps] = useState<F1Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [eventResult, tournamentResult, fastLapResult] = await Promise.all([
        api.get<ClubEvent[]>("/events", { params: { upcoming: false } }).catch((err) => {
          throw new Error(errorMessage(err, "Events konnten nicht geladen werden."));
        }),
        api.get<Tournament[]>("/tournaments").catch((err) => {
          throw new Error(errorMessage(err, "Turniere konnten nicht geladen werden."));
        }),
        api.get<F1Challenge[]>("/f1/challenges", { params: { limit: 100 } }).catch((err) => {
          throw new Error(errorMessage(err, "Fast-Lap Challenges konnten nicht geladen werden."));
        }),
      ]);
      setEvents(Array.isArray(eventResult.data) ? eventResult.data : []);
      setTournaments(Array.isArray(tournamentResult.data) ? tournamentResult.data : []);
      setFastlaps(Array.isArray(fastLapResult.data) ? fastLapResult.data : []);
    } catch (err) {
      setError(errorMessage(err, "Events konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const items = useMemo(() => {
    const mapped: HubItem[] = [
      ...events.map((event) => ({
        kind: "event" as const,
        id: event.slug || event.id,
        title: event.title || event.name || "Event",
        date: event.start_date || event.date,
        status: event.status,
        phase: event.public_phase?.label,
        image: event.banner_url,
        detail: [event.event_type || event.type, event.location, event.city].filter(Boolean).join(" · "),
        raw: event,
      })),
      ...tournaments.map((tournament) => ({
        kind: "tournament" as const,
        id: tournament.slug || tournament.id,
        title: tournament.title,
        date: tournament.start_date,
        status: tournament.status,
        phase: tournament.public_phase?.label,
        image: tournament.banner_url || tournament.game?.cover_url || tournament.game?.logo_url,
        detail: [tournament.game?.display_name || tournament.game?.name || tournament.game_name, tournament.format_label || tournament.format].filter(Boolean).join(" · "),
        raw: tournament,
      })),
      ...fastlaps.map((challenge) => ({
        kind: "fastlap" as const,
        id: challenge.slug || challenge.id,
        title: challenge.title,
        date: challenge.start_date,
        status: challenge.status,
        phase: challenge.public_phase?.label,
        image: challenge.banner_url,
        detail: [`${challenge.track_count || 0} Strecken`, `${challenge.participant_count || 0} Fahrer`, challenge.vehicle].filter(Boolean).join(" · "),
        raw: challenge,
      })),
    ];
    const visible = mapped.filter((item) => matchesFilter(item, filter));
    return visible.sort((a, b) => dateSort(a.date) - dateSort(b.date));
  }, [events, fastlaps, filter, tournaments]);
  const groupedItems = useMemo(() => ({
    events: items.filter((item) => item.kind === "event"),
    tournaments: items.filter((item) => item.kind === "tournament"),
    fastlaps: items.filter((item) => item.kind === "fastlap"),
  }), [items]);

  const open = useCallback((item: HubItem) => {
    if (item.kind === "event") navigation.navigate("EventDetail", { id: item.id });
    if (item.kind === "tournament") navigation.navigate("TournamentDetail", { id: item.id });
    if (item.kind === "fastlap") navigation.navigate("FastLapDetail", { id: item.id });
  }, [navigation]);

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={5} hasImage />
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
          <Heading>Events</Heading>
          {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>Alle sichtbaren Events, Turniere und Fast-Lap Challenges an einem Ort.</Muted>}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {filters.map((item) => (
            <Pressable key={item.key} onPress={() => setFilter(item.key)} style={[styles.tab, filter === item.key && styles.tabActive]}>
              <Muted style={[styles.tabText, filter === item.key && styles.tabTextActive]}>{item.label}</Muted>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.stats}>
          <Stat label="Events" value={String(events.length)} />
          <Stat label="Turniere" value={String(tournaments.length)} tone="gold" />
          <Stat label="Fast Laps" value={String(fastlaps.length)} />
        </View>

        {items.length && filter === "all" ? (
          <>
            <HubSection title="Events" items={groupedItems.events} onOpen={open} />
            <HubSection title="Turniere" items={groupedItems.tournaments} onOpen={open} />
            <HubSection title="Fast Laps" items={groupedItems.fastlaps} onOpen={open} />
          </>
        ) : items.length ? (
          items.map((item) => <HubCard key={`${item.kind}-${item.id}`} item={item} onPress={() => open(item)} />)
        ) : (
          <EmptyState title="Keine Einträge" detail="Für diese Auswahl sind aktuell keine sichtbaren Inhalte vorhanden." />
        )}
      </ScrollView>
    </Screen>
  );
}

function HubSection({ title, items, onOpen }: { title: string; items: HubItem[]; onOpen: (item: HubItem) => void }) {
  if (!items.length) return null;
  return (
    <View style={styles.section}>
      <Heading>{title}</Heading>
      {items.map((item) => <HubCard key={`${item.kind}-${item.id}`} item={item} onPress={() => onOpen(item)} />)}
    </View>
  );
}

function HubCard({ item, onPress }: { item: HubItem; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.card}>
        <MediaImage
          uri={item.image}
          style={styles.image}
          fallback={<Ionicons name={iconFor(item.kind)} color={item.kind === "fastlap" ? colors.gold : colors.cyan} size={28} />}
        />
        <View style={styles.text}>
          <View style={styles.top}>
            <Body style={styles.title}>{item.title}</Body>
            <View style={styles.badgeRow}>
              <Pill label={labelFor(item.kind)} tone={item.kind === "fastlap" ? "gold" : "cyan"} />
              <StatusBadge label={item.phase} status={item.status} />
            </View>
          </View>
          <Muted>{formatDateTime(item.date)}</Muted>
          {item.detail ? <Muted numberOfLines={2}>{item.detail}</Muted> : null}
        </View>
      </Card>
    </Pressable>
  );
}

function Stat({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "gold" }) {
  return (
    <Card style={styles.stat}>
      <Body style={[styles.statValue, tone === "gold" && styles.gold]}>{value}</Body>
      <Muted>{label}</Muted>
    </Card>
  );
}

function Pill({ label, tone = "cyan" }: { label: string; tone?: "cyan" | "gold" }) {
  return (
    <View style={[styles.pill, tone === "gold" && styles.pillGold]}>
      <Muted style={[styles.pillText, tone === "gold" && styles.pillGoldText]}>{label}</Muted>
    </View>
  );
}

function dateSort(value?: string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = new Date(value).getTime();
  return Number.isNaN(date) ? Number.MAX_SAFE_INTEGER : date;
}

function matchesFilter(item: HubItem, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "events") return item.kind === "event";
  if (filter === "tournaments") return item.kind === "tournament";
  return item.kind === "fastlap";
}

function iconFor(kind: HubItem["kind"]) {
  if (kind === "event") return "calendar-outline";
  if (kind === "fastlap") return "speedometer-outline";
  return "trophy-outline";
}

function labelFor(kind: HubItem["kind"]) {
  if (kind === "event") return "Event";
  if (kind === "fastlap") return "Fast Lap";
  return "Turnier";
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 28,
  },
  header: {
    gap: 6,
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
  stats: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    flex: 1,
    minHeight: 76,
  },
  statValue: {
    color: colors.cyan,
    fontSize: 23,
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
  },
  card: {
    flexDirection: "row",
    gap: 12,
  },
  section: {
    gap: 10,
  },
  image: {
    borderRadius: 8,
    height: 82,
    width: 92,
  },
  text: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  top: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  badgeRow: {
    alignItems: "flex-end",
    gap: 6,
  },
  title: {
    flex: 1,
    fontWeight: "900",
  },
  pill: {
    backgroundColor: "rgba(41,182,232,0.12)",
    borderColor: "rgba(41,182,232,0.28)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillGold: {
    backgroundColor: "rgba(240,180,41,0.12)",
    borderColor: "rgba(240,180,41,0.32)",
  },
  pillText: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
  },
  pillGoldText: {
    color: colors.gold,
  },
  pressed: {
    opacity: 0.72,
  },
  error: {
    color: colors.live,
  },
});
