import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { ContentCard } from "../../components/ContentCard";
import { EmptyState, OfflineNotice, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { MonthCalendar } from "../../components/MonthCalendar";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage, responseFromCache } from "../../lib/api";
import { initialMonth, itemsByDay, parseDay, shiftMonth, type CalendarItem } from "../../lib/calendar";
import { compareByNearestDate } from "../../lib/contentSort";
import { splitOpenAndPast } from "../../lib/dashboard";
import { formatEventType, formatTournamentFormat, placeParts } from "../../lib/format";
import { applyScope, type ScopeFilter } from "../../lib/memberArea";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { ClubEvent, F1Challenge, Tournament } from "../../types";

const TOURNAMENT_LIST_LIVE_RESOURCES = ["tournaments", "events", "f1"];

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentList">;
type Filter = "all" | "events" | "tournaments" | "fastlaps";
type ViewMode = "list" | "calendar";
type HubBase = { id: string; title: string; date?: string | null; endDate?: string | null; status?: string; phase?: string; image?: string | null; detail?: string; visibility?: string | null };
type HubItem =
  | (HubBase & { kind: "event"; raw: ClubEvent })
  | (HubBase & { kind: "tournament"; raw: Tournament })
  | (HubBase & { kind: "fastlap"; raw: F1Challenge });

// Liste oder Kalender (#216): dieselben Termine, zweite Sicht - Vergangenes ist im Kalender
// einfach der Vormonat.
const views: Array<{ key: ViewMode; label: string }> = [
  { key: "list", label: "Liste" },
  { key: "calendar", label: "Kalender" },
];

const filters: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "events", label: "Events" },
  { key: "tournaments", label: "Turniere" },
  { key: "fastlaps", label: "Fast Laps" },
];

// „Verein“ zeigt nur Interne (#342) - der Schalter erscheint erst, wenn es solche gibt.
const scopes: Array<{ key: ScopeFilter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "club", label: "Verein" },
];

export function TournamentsScreen({ navigation }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [view, setView] = useState<ViewMode>("list");
  const [month, setMonth] = useState<{ year: number; month: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [fastlaps, setFastlaps] = useState<F1Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);

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
      setOffline([eventResult, tournamentResult, fastLapResult].some(responseFromCache));
    } catch (err) {
      setError(errorMessage(err, "Events konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, TOURNAMENT_LIST_LIVE_RESOURCES, { fallbackMs: 30000 });

  const items = useMemo(() => {
    const mapped: HubItem[] = [
      ...events.map((event) => ({
        kind: "event" as const,
        id: event.slug || event.id,
        title: event.title || event.name || "Event",
        date: event.start_date || event.date,
        endDate: event.end_date,
        status: event.status,
        phase: event.public_phase?.label,
        image: event.banner_url,
        detail: [formatEventType(event.event_type || event.type), ...placeParts(event.location, event.city)].filter(Boolean).join(" · "),
        visibility: event.visibility,
        raw: event,
      })),
      ...tournaments.map((tournament) => ({
        kind: "tournament" as const,
        id: tournament.slug || tournament.id,
        title: tournament.title,
        date: tournament.start_date,
        endDate: tournament.end_date,
        status: tournament.status,
        phase: tournament.public_phase?.label,
        image: tournament.banner_url || tournament.game?.cover_url || tournament.game?.logo_url,
        detail: [tournament.game?.display_name || tournament.game?.name || tournament.game_name, tournament.format_label || formatTournamentFormat(tournament.format)].filter(Boolean).join(" · "),
        raw: tournament,
      })),
      ...fastlaps.map((challenge) => ({
        kind: "fastlap" as const,
        id: challenge.slug || challenge.id,
        title: challenge.title,
        date: challenge.start_date,
        endDate: challenge.end_date,
        status: challenge.status,
        phase: challenge.public_phase?.label,
        image: challenge.banner_url,
        detail: [`${challenge.track_count || 0} Strecken`, `${challenge.participant_count || 0} Fahrer`, challenge.vehicle].filter(Boolean).join(" · "),
        raw: challenge,
      })),
    ];
    const visible = applyScope(mapped.filter((item) => matchesFilter(item, filter)), scope);
    return visible.sort((a, b) => compareByNearestDate(a.date, b.date, a.status, b.status, a.phase, b.phase));
  }, [events, fastlaps, filter, scope, tournaments]);
  const hasInternal = useMemo(() => applyScope(events, "club").length > 0, [events]);
  // Ohne Tipp nur, was ansteht; Beendetes und Abgesagtes hinter "Vergangene
  // anzeigen" (#241). Die Zähler oben zählen dieselbe Menge wie die Liste.
  const { open: openItems, past: pastItems } = useMemo(() => splitOpenAndPast(items), [items]);
  const groupedItems = useMemo(() => ({
    events: openItems.filter((item) => item.kind === "event"),
    tournaments: openItems.filter((item) => item.kind === "tournament"),
    fastlaps: openItems.filter((item) => item.kind === "fastlap"),
  }), [openItems]);

  // Kalender (#216): jeder Termin an seinen Tagen; eigene Anmeldungen bekommen den Ring.
  const calendarItems = useMemo<CalendarItem[]>(() => items
    .filter((item) => item.date)
    .map((item) => ({
      id: item.id, kind: item.kind, title: item.title, start: item.date as string, end: item.endDate,
      mine: Boolean(item.kind === "event" ? item.raw.own_registration : item.kind === "tournament" ? item.raw.my_registration : false),
      detail: item.detail,
    })), [items]);
  const shownMonth = month || initialMonth(calendarItems);
  const dayItems = useMemo(() => {
    if (!selectedDay) return [];
    const ids = new Set((itemsByDay(calendarItems).get(selectedDay) || []).map((entry) => `${entry.kind}-${entry.id}`));
    return items.filter((item) => ids.has(`${item.kind}-${item.id}`));
  }, [calendarItems, items, selectedDay]);
  const selectDay = useCallback((key: string) => {
    setSelectedDay((current) => (current === key ? null : key));
    const date = parseDay(key);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
  }, []);

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
          {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>Was ansteht: Events, Turniere und Fast Laps.</Muted>}
        </View>
        {offline && !error ? <OfflineNotice detail="Events, Turniere und Fast-Laps werden aus gespeicherten Daten angezeigt." /> : null}

        <SegmentedTabs items={views} value={view} onChange={setView} />
        <SegmentedTabs items={filters} value={filter} onChange={setFilter} style={styles.scopeTabs} />
        {hasInternal ? <SegmentedTabs items={scopes} value={scope} onChange={setScope} style={styles.scopeTabs} /> : null}

        {view === "calendar" ? (
          <View style={styles.section}>
            <MonthCalendar
              year={shownMonth.year}
              month={shownMonth.month}
              items={calendarItems}
              selected={selectedDay}
              onSelect={selectDay}
              onShift={(delta) => { setMonth(shiftMonth(shownMonth.year, shownMonth.month, delta)); setSelectedDay(null); }}
            />
            {selectedDay ? (
              dayItems.length ? (
                <View style={styles.section} testID="calendar-day-items">
                  <Heading>{parseDay(selectedDay).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" })}</Heading>
                  {dayItems.map((item) => <HubContentCard key={`${item.kind}-${item.id}`} item={item} onPress={() => open(item)} />)}
                </View>
              ) : (
                <Muted testID="calendar-day-empty">An diesem Tag ist nichts geplant.</Muted>
              )
            ) : (
              <Muted>Tag antippen, um die Termine zu sehen. Punkte zeigen, was an einem Tag ist; ein goldener Rahmen heißt: du bist angemeldet.</Muted>
            )}
          </View>
        ) : null}

        {view === "list" && filter === "all" && openItems.length ? (
          <View style={styles.stats}>
            <Stat label="Events" value={String(groupedItems.events.length)} />
            <Stat label="Turniere" value={String(groupedItems.tournaments.length)} tone="gold" />
            <Stat label="Fast Laps" value={String(groupedItems.fastlaps.length)} />
          </View>
        ) : null}

        {view === "list" ? (openItems.length && filter === "all" ? (
          <>
            <HubSection title="Events" items={groupedItems.events} onOpen={open} />
            <HubSection title="Turniere" items={groupedItems.tournaments} onOpen={open} />
            <HubSection title="Fast Laps" items={groupedItems.fastlaps} onOpen={open} />
          </>
        ) : openItems.length ? (
          openItems.map((item) => <HubContentCard key={`${item.kind}-${item.id}`} item={item} onPress={() => open(item)} />)
        ) : (
          <EmptyState icon="calendar-clear-outline" title="Nichts Offenes" detail={pastItems.length ? "Alles, was hier war, ist vorbei – unten lässt sich Vergangenes einblenden." : "Sobald etwas geplant ist, steht es hier."} />
        )) : null}

        {view === "list" && pastItems.length ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setShowPast((value) => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showPast }}
              style={({ pressed }) => [styles.pastToggle, pressed && styles.pressed]}
              testID="events-past-toggle"
            >
              <Body style={styles.pastToggleText}>{showPast ? "Vergangene ausblenden" : `Vergangene anzeigen (${pastItems.length})`}</Body>
            </Pressable>
            {showPast ? (
              <HubSection title="Vergangen" items={pastItems} onOpen={open} />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function HubSection({ title, items, onOpen }: { title: string; items: HubItem[]; onOpen: (item: HubItem) => void }) {
  if (!items.length) return null;
  return (
    <View style={styles.section}>
      <Heading>{title}</Heading>
      {items.map((item) => <HubContentCard key={`${item.kind}-${item.id}`} item={item} onPress={() => onOpen(item)} />)}
    </View>
  );
}

function HubContentCard({ item, onPress }: { item: HubItem; onPress: () => void }) {
  return (
    <ContentCard
      kind={item.kind}
      title={item.title}
      image={item.image}
      date={item.date}
      label={item.phase}
      status={item.status}
      detail={item.detail}
      visibility={item.visibility}
      onPress={onPress}
    />
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

function matchesFilter(item: HubItem, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "events") return item.kind === "event";
  if (filter === "tournaments") return item.kind === "tournament";
  return item.kind === "fastlap";
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
  scopeTabs: {
    marginTop: -6,
  },
  stats: {
    flexDirection: "row",
    gap: 10,
  },
  pastToggle: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    justifyContent: "center",
  },
  pastToggleText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
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
  section: {
    gap: 10,
  },
  error: {
    color: colors.live,
  },
});
