import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { ContentCard } from "../../components/ContentCard";
import { ListItemFadeIn, useListEntrance, type ListEntrance } from "../../components/FadeIn";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { TabHeader, useTabScrollToTop } from "../../components/TabHeader";
import { seasonScrollProps } from "../../seasons/sky/scroll";
import { MonthCalendar } from "../../components/MonthCalendar";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { currentMonth, itemsByDay, parseDay, shiftMonth, type CalendarItem } from "../../lib/calendar";
import { compareByNearestDate } from "../../lib/contentSort";
import { splitOpenAndPast } from "../../lib/dashboard";
import { formatEventType, formatTournamentFormat, placeParts } from "../../lib/format";
import { applyScope, type ScopeFilter } from "../../lib/memberArea";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors, kindColors, radius } from "../../theme";
import type { ClubEvent, F1Challenge, Tournament } from "../../types";
import { dayNoon, viennaDate, viennaDay, viennaTime } from "../../lib/vienna";
import { useAuth } from "../../auth/AuthContext";
import { navigateToUrl } from "../../navigation/rootNavigation";

const TOURNAMENT_LIST_LIVE_RESOURCES = ["tournaments", "events", "f1"];

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentList">;
type Filter = "all" | "events" | "tournaments" | "fastlaps";
type ViewMode = "list" | "calendar";
// Ein Vereinstermin aus /calendar (#1190): Versammlung oder eigene Helferschicht - nur für Mitglieder, der Server entscheidet.
type ClubCalendarItem = { id: string; kind: string; club_kind?: string; title: string; start: string; end?: string | null; mine?: boolean; path?: string | null; all_day?: boolean; day?: string | null; location?: string | null };
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

export function TournamentsScreen({ navigation, route }: Props) {
  // Alte Links auf die Fast-Lap-Liste und auf /tournaments landen mit Vorauswahl hier (#1150).
  const [filter, setFilter] = useState<Filter>(route?.params?.filter || "all");
  useEffect(() => {
    if (route?.params?.filter) setFilter(route.params.filter);
  }, [route?.params?.filter]);
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [view, setView] = useState<ViewMode>("list");
  const { user } = useAuth();
  // Der Kalender öffnet im aktuellen Monat (#1271), „Heute“ springt zurück.
  const [month, setMonth] = useState<{ year: number; month: number }>(() => currentMonth());
  const [clubItems, setClubItems] = useState<CalendarItem[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [fastlaps, setFastlaps] = useState<F1Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Die Listen blenden gestaffelt ein (#1085) - jede Karte nur beim ersten Erscheinen.
  const entrance = useListEntrance();

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
      // Versammlungen und eigene Schichten (#1190): nur angemeldet; fehlen sie, bleibt der Kalender, wie er ist.
      if (user) {
        const club = await api.get<{ items?: ClubCalendarItem[] }>("/calendar").catch(() => null);
        const rows = Array.isArray(club?.data?.items) ? club.data.items : [];
        setClubItems(rows.filter((row) => row.kind === "club").map((row) => ({
          id: row.id, kind: "club", title: row.title, start: row.start, end: row.end, mine: Boolean(row.mine), path: row.path,
          allDay: Boolean(row.all_day), day: row.day, location: row.location, detail: row.club_kind === "shift" ? "Helferschicht" : "Versammlung",
        })));
      } else {
        setClubItems([]);
      }
    } catch (err) {
      setError(errorMessage(err, "Events konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

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
    .map((item): CalendarItem => ({
      id: item.id, kind: item.kind, title: item.title, start: item.date as string, end: item.endDate,
      mine: Boolean(item.kind === "event" ? item.raw.own_registration : item.kind === "tournament" ? item.raw.my_registration : false),
      detail: item.detail,
    })).concat(clubItems), [clubItems, items]);
  const shownMonth = month;
  const clubDayItems = useMemo(() => (selectedDay ? (itemsByDay(clubItems).get(selectedDay) || []) : []), [clubItems, selectedDay]);
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
        <TabHeader title="Events" testID="events-header" />
        <SkeletonList count={5} hasImage />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        ref={scrollRef}
        {...seasonScrollProps("TournamentList")}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
      >
        <TabHeader title="Events" testID="events-header">
          {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>Was ansteht: Events, Turniere und Fast Laps.</Muted>}
        </TabHeader>

        {/* Die Filterzeilen rücken mit eigenem Abstand zusammen: ein negativer Rand am Inhalt der waagrechten Liste schnitt
            die Oberkante der Knöpfe ab (Geräteprobe vor 1.4.0). */}
        <View style={styles.tabRows}>
          <SegmentedTabs items={views} value={view} onChange={setView} />
          <SegmentedTabs items={filters} value={filter} onChange={setFilter} />
          {hasInternal ? <SegmentedTabs items={scopes} value={scope} onChange={setScope} /> : null}
        </View>

        {view === "calendar" ? (
          <View style={styles.section}>
            <MonthCalendar
              year={shownMonth.year}
              month={shownMonth.month}
              items={calendarItems}
              selected={selectedDay}
              onSelect={selectDay}
              onShift={(delta) => { setMonth(shiftMonth(shownMonth.year, shownMonth.month, delta)); setSelectedDay(null); }}
              onToday={() => { setMonth(currentMonth()); setSelectedDay(viennaDay(new Date())); }}
            />
            {selectedDay ? (
              dayItems.length || clubDayItems.length ? (
                <View style={styles.section} testID="calendar-day-items">
                  <Heading>{viennaDate(dayNoon(selectedDay), { weekday: "long", day: "numeric", month: "long" })}</Heading>
                  {clubDayItems.map((item) => <ClubRow key={item.id} item={item} />)}
                  {dayItems.map((item) => <HubContentCard key={`${item.kind}-${item.id}`} item={item} onPress={() => open(item)} />)}
                </View>
              ) : (
                <Muted testID="calendar-day-empty">An diesem Tag ist nichts geplant.</Muted>
              )
            ) : (
              <Muted>Tag antippen, um die Termine zu sehen. Punkte zeigen, was an einem Tag ist, Balken, was mehrere Tage dauert; ein goldener Rahmen heißt: du bist angemeldet.</Muted>
            )}
          </View>
        ) : null}

        {view === "list" && filter === "all" && openItems.length ? (
          <View style={styles.stats}>
            <Stat label="Events" value={String(groupedItems.events.length)} color={kindColors.event} />
            <Stat label="Turniere" value={String(groupedItems.tournaments.length)} color={kindColors.tournament} />
            <Stat label="Fast Laps" value={String(groupedItems.fastlaps.length)} color={kindColors.fastlap} />
          </View>
        ) : null}

        {view === "list" ? (openItems.length && filter === "all" ? (
          <>
            <HubSection title="Events" items={groupedItems.events} onOpen={open} entrance={entrance} />
            <HubSection title="Turniere" items={groupedItems.tournaments} onOpen={open} entrance={entrance} />
            <HubSection title="Fast Laps" items={groupedItems.fastlaps} onOpen={open} entrance={entrance} />
          </>
        ) : openItems.length ? (
          openItems.map((item, index) => (
            <ListItemFadeIn key={`${item.kind}-${item.id}`} entrance={entrance} id={`${item.kind}-${item.id}`} index={index}>
              <HubContentCard item={item} onPress={() => open(item)} />
            </ListItemFadeIn>
          ))
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
              <HubSection title="Vergangen" items={pastItems} onOpen={open} entrance={entrance} />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** Eine Versammlung oder eigene Schicht (#1190) - grün; ein Tipp öffnet sie im Mitgliederbereich, Details bleiben dort. */
function ClubRow({ item }: { item: CalendarItem }) {
  const when = item.allDay ? "ganztägig" : viennaTime(item.start, { hour: "2-digit", minute: "2-digit" });
  return (
    <Pressable
      onPress={() => navigateToUrl(item.path)}
      accessibilityRole="button"
      accessibilityLabel={`${item.detail}: ${item.title}`}
      style={({ pressed }) => [styles.clubRow, pressed && styles.pressed]}
      testID={`calendar-club-${item.id}`}
    >
      <View style={styles.clubDot} />
      <View style={styles.clubText}>
        <Muted>{[item.detail, when, item.location].filter(Boolean).join(" · ")}</Muted>
        <Body style={styles.clubTitle}>{item.title}</Body>
      </View>
    </Pressable>
  );
}

function HubSection({ title, items, onOpen, entrance }: { title: string; items: HubItem[]; onOpen: (item: HubItem) => void; entrance: ListEntrance }) {
  if (!items.length) return null;
  return (
    <View style={styles.section}>
      <Heading>{title}</Heading>
      {items.map((item, index) => (
        <ListItemFadeIn key={`${item.kind}-${item.id}`} entrance={entrance} id={`${item.kind}-${item.id}`} index={index}>
          <HubContentCard item={item} onPress={() => onOpen(item)} />
        </ListItemFadeIn>
      ))}
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
      perch={`hub-${item.kind}-${item.id}`}
    />
  );
}

/** Eine Zahl je Art - in der Farbe ihrer Art (#1151): Events lila, Turniere gold, Fast Laps blau. */
function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card style={styles.stat}>
      <Body style={[styles.statValue, { color }]}>{value}</Body>
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
  clubRow: {
    alignItems: "flex-start",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderLeftColor: kindColors.club,
    borderLeftWidth: 3,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  clubDot: {
    backgroundColor: kindColors.club,
    borderRadius: 4,
    height: 8,
    marginTop: 5,
    width: 8,
  },
  clubText: {
    flex: 1,
    gap: 2,
  },
  clubTitle: {
    fontWeight: "800",
  },
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 28,
  },
  tabRows: {
    gap: 8,
  },
  stats: {
    flexDirection: "row",
    gap: 10,
  },
  pastToggle: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.lg,
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
  section: {
    gap: 10,
  },
  error: {
    color: colors.live,
  },
});
