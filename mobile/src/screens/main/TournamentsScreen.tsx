import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ContentCard } from "../../components/ContentCard";
import { ListItemFadeIn, useListEntrance, type ListEntrance } from "../../components/FadeIn";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { HeaderButton, TabHeader, useTabScrollToTop } from "../../components/TabHeader";
import { seasonScrollProps } from "../../seasons/sky/scroll";
import { MonthCalendar } from "../../components/MonthCalendar";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { currentMonth, itemsByDay, parseDay, shiftMonth, subscribeUrls, type CalendarItem } from "../../lib/calendar";
import { splitOpenAndPast } from "../../lib/dashboard";
import {
  LIST_MODE_KEY, buildCards, childSummary, listMode, mineState, ownLabel, playLabel,
  type GroupCard, type GroupFilter, type GroupKind, type GroupRow, type ListMode, type MineMap,
} from "../../lib/eventGroups";
import { formatEventType, formatTournamentFormat, placeParts } from "../../lib/format";
import { isInternal } from "../../lib/memberArea";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors, kindColors, radius } from "../../theme";
import type { ClubEvent, F1Challenge, Tournament } from "../../types";
import { dayNoon, viennaDate, viennaDateTime, viennaDay, viennaTime } from "../../lib/vienna";
import { useAuth } from "../../auth/AuthContext";
import { isGuestUser } from "../../live";
import { navigateToUrl } from "../../navigation/rootNavigation";

const TOURNAMENT_LIST_LIVE_RESOURCES = ["tournaments", "events", "f1"];

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentList">;
type Filter = GroupFilter;
type ViewMode = "list" | "calendar";
type Scope = "all" | "club";
// Ein Vereinstermin aus /calendar (#1190): Versammlung oder eigene Helferschicht - nur für Mitglieder, der Server entscheidet.
type ClubCalendarItem = { id: string; kind: string; club_kind?: string; title: string; start: string; end?: string | null; mine?: boolean; path?: string | null; all_day?: boolean; day?: string | null; location?: string | null };
type HubBase = { id: string; title: string; date?: string | null; endDate?: string | null; status?: string; phase?: string; image?: string | null; detail?: string; visibility?: string | null; own?: string | null };
type HubItem =
  | (HubBase & { kind: "event"; raw: ClubEvent })
  | (HubBase & { kind: "tournament"; raw: Tournament })
  | (HubBase & { kind: "fastlap"; raw: F1Challenge });
type AnyDoc = ClubEvent | Tournament | F1Challenge;
// Eine Karte der Liste: das Event (mit seinen Turnieren) oder ein Turnier/eine Fast Lap für sich (#1182).
type Entry = HubItem & { card: GroupCard<AnyDoc>; children: HubItem[] };

const filters: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "events", label: "Events" },
  { key: "tournaments", label: "Turniere" },
  { key: "fastlaps", label: "Fast Laps" },
];

// „Verein“ zeigt nur Interne (#342) - der Schalter erscheint erst, wenn es solche gibt.
const scopes: Array<{ key: Scope; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "club", label: "Verein" },
];

function toHub(kind: GroupKind, raw: AnyDoc, own: string | null = null): HubItem {
  if (kind === "event") {
    const event = raw as ClubEvent;
    return {
      kind: "event", id: event.slug || event.id, title: event.title || event.name || "Event", date: event.start_date || event.date, endDate: event.end_date,
      status: event.status, phase: event.public_phase?.label, image: event.banner_url, visibility: event.visibility, own, raw: event,
      detail: [formatEventType(event.event_type || event.type), ...placeParts(event.location, event.city)].filter(Boolean).join(" · "),
    };
  }
  if (kind === "tournament") {
    const tournament = raw as Tournament;
    return {
      kind: "tournament", id: tournament.slug || tournament.id, title: tournament.title, date: tournament.start_date, endDate: tournament.end_date,
      status: tournament.status, phase: tournament.public_phase?.label, image: tournament.banner_url || tournament.game?.cover_url || tournament.game?.logo_url, own, raw: tournament,
      detail: [tournament.game?.display_name || tournament.game?.name || tournament.game_name, tournament.format_label || formatTournamentFormat(tournament.format)].filter(Boolean).join(" · "),
    };
  }
  const challenge = raw as F1Challenge;
  return {
    kind: "fastlap", id: challenge.slug || challenge.id, title: challenge.title, date: challenge.start_date, endDate: challenge.end_date,
    status: challenge.status, phase: challenge.public_phase?.label, image: challenge.banner_url, own, raw: challenge,
    detail: [`${challenge.track_count || 0} Strecken`, `${challenge.participant_count || 0} Fahrer`, challenge.vehicle].filter(Boolean).join(" · "),
  };
}

async function storedMode(): Promise<ListMode> {
  try {
    return listMode(await SecureStore.getItemAsync(LIST_MODE_KEY));
  } catch {
    return "nested";
  }
}

export function TournamentsScreen({ navigation, route }: Props) {
  // Alte Links auf die Fast-Lap-Liste und auf /tournaments landen mit Vorauswahl hier (#1150).
  const [filter, setFilter] = useState<Filter>(route?.params?.filter || "all");
  useEffect(() => {
    if (route?.params?.filter) setFilter(route.params.filter);
  }, [route?.params?.filter]);
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);
  const [scope, setScope] = useState<Scope>("all");
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
  // „Nur meine“ (#1189): wofür die Person selbst oder ihr Team dabei ist - der Server sagt es.
  const [mine, setMine] = useState<MineMap>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  // Turniere im Event (Standard) oder zusätzlich einzeln (#1182) - die letzte Wahl bleibt am Gerät.
  const [mode, setMode] = useState<ListMode>("nested");
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Die Listen blenden gestaffelt ein (#1085) - jede Karte nur beim ersten Erscheinen.
  const entrance = useListEntrance();

  useEffect(() => {
    let alive = true;
    void storedMode().then((value) => {
      if (alive) setMode(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next: ListMode = current === "nested" ? "separate" : "nested";
      SecureStore.setItemAsync(LIST_MODE_KEY, next).catch(() => undefined);
      return next;
    });
  }, []);

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
      // Versammlungen und eigene Schichten (#1190) und der eigene Stand (#1189): nur angemeldet; fehlen sie, bleibt der
      // Rest, wie er ist.
      if (user && !isGuestUser(user)) {
        const [club, own] = await Promise.all([
          api.get<{ items?: ClubCalendarItem[] }>("/calendar").catch(() => null),
          api.get<MineMap>("/calendar/mine").catch(() => null),
        ]);
        const rows = Array.isArray(club?.data?.items) ? club.data.items : [];
        setClubItems(rows.filter((row) => row.kind === "club").map((row) => ({
          id: row.id, kind: "club", title: row.title, start: row.start, end: row.end, mine: Boolean(row.mine), path: row.path,
          allDay: Boolean(row.all_day), day: row.day, location: row.location, detail: row.club_kind === "shift" ? "Helferschicht" : "Versammlung",
        })));
        setMine(own?.data && typeof own.data === "object" ? own.data : null);
      } else {
        setClubItems([]);
        setMine(null);
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

  const signedIn = Boolean(user && !isGuestUser(user));
  const mineOnly = signedIn && onlyMine;

  // Die Liste (#1182): Events mit ihren Turnieren und Fast Laps als eine Karte, der Rest für sich.
  const entries = useMemo<Entry[]>(() => {
    const cards: GroupCard<AnyDoc>[] = buildCards<ClubEvent, Tournament, F1Challenge>({ events, tournaments, fastlaps }, { mode, filter, onlyMine: mineOnly, mine });
    return cards
      .filter((card) => scope !== "club" || isInternal(card.item as { visibility?: string | null }))
      .map((card) => ({
        ...toHub(card.kind, card.item, ownLabel(card.mine)),
        card,
        children: card.children.map((row: GroupRow<AnyDoc>) => toHub(row.kind, row.item, ownLabel(row.mine))),
      }));
  }, [events, fastlaps, filter, mine, mineOnly, mode, scope, tournaments]);
  const hasInternal = useMemo(() => events.some((event) => isInternal(event)), [events]);
  // Ohne Tipp nur, was ansteht; Beendetes und Abgesagtes hinter "Vergangene anzeigen" (#241). Ein Event bleibt mit allen
  // seinen Turnieren zusammen. Die Zähler oben zählen dieselbe Menge wie die Liste - Turniere im Event mit.
  const { open: openEntries, past: pastEntries } = useMemo(() => splitOpenAndPast(entries), [entries]);
  const counts = useMemo(() => {
    const seen = new Map<string, GroupKind>();
    for (const entry of openEntries) {
      seen.set(entry.card.key, entry.card.kind);
      for (const row of entry.card.children) seen.set(row.key, row.kind);
    }
    const values = [...seen.values()];
    return { events: values.filter((kind) => kind === "event").length, tournaments: values.filter((kind) => kind === "tournament").length, fastlaps: values.filter((kind) => kind === "fastlap").length };
  }, [openEntries]);

  // Kalender (#216): jeder Termin an seinen Tagen; eigene Anmeldungen (auch mit dem Team, #1189) bekommen den Ring.
  // Mehrtägige Events (#884, Codex-Prüfung #1460): je Tag aus dem Tagesplan ein Eintrag mit derselben Kennung - der Balken
  // belegt nur die echten Tage, ein Tag in einer Lücke bleibt frei.
  const hubItems = useMemo<HubItem[]>(() => {
    const all: HubItem[] = [
      ...events.map((event) => toHub("event", event)),
      ...tournaments.map((tournament) => toHub("tournament", tournament)),
      ...fastlaps.map((challenge) => toHub("fastlap", challenge)),
    ];
    const kinds: Record<Filter, GroupKind | null> = { all: null, events: "event", tournaments: "tournament", fastlaps: "fastlap" };
    return all.filter((item) => (!kinds[filter] || item.kind === kinds[filter]) && (scope !== "club" || isInternal({ visibility: item.visibility })));
  }, [events, fastlaps, filter, scope, tournaments]);
  const calendarItems = useMemo<CalendarItem[]>(() => hubItems
    .filter((item) => item.date)
    .flatMap((item): CalendarItem[] => {
      const base: CalendarItem = {
        id: item.id, kind: item.kind, title: item.title, start: item.date as string, end: item.endDate,
        mine: Boolean(mineState(mine, item.kind, item.raw.id)),
        detail: item.detail,
      };
      const days = item.kind === "event" && item.raw.schedule?.multi_day ? item.raw.schedule.days || [] : [];
      return days.length ? days.map((day) => ({ ...base, start: day.start_at, end: day.end_at })) : [base];
    })
    .concat(clubItems)
    .filter((item) => !mineOnly || item.mine), [clubItems, hubItems, mine, mineOnly]);
  const shownMonth = month;
  const clubDayItems = useMemo(() => (selectedDay ? (itemsByDay(clubItems.filter((item) => !mineOnly || item.mine)).get(selectedDay) || []) : []), [clubItems, mineOnly, selectedDay]);
  const dayItems = useMemo(() => {
    if (!selectedDay) return [];
    const ids = new Set((itemsByDay(calendarItems).get(selectedDay) || []).map((entry) => `${entry.kind}-${entry.id}`));
    return hubItems.filter((item) => ids.has(`${item.kind}-${item.id}`));
  }, [calendarItems, hubItems, selectedDay]);
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
  const toggleOpened = useCallback((key: string) => {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const feed = subscribeUrls(WEB_BASE_URL);
  const viewToggle = (
    <HeaderButton
      icon={view === "calendar" ? "list-outline" : "calendar-outline"}
      label={view === "calendar" ? "Liste" : "Kalender"}
      onPress={() => setView((current) => (current === "calendar" ? "list" : "calendar"))}
      testID="events-view-toggle"
    />
  );

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
        {/* Der Kalender ist ein Symbol in der Kopfzeile (#1145, #1182) - eine Reihe Umschalter weniger. */}
        <TabHeader title="Events" testID="events-header" extra={viewToggle}>
          {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>{view === "calendar" ? "Alle Termine im Monat." : "Was ansteht: Events, Turniere und Fast Laps."}</Muted>}
        </TabHeader>

        {/* Die Filterzeilen rücken mit eigenem Abstand zusammen: ein negativer Rand am Inhalt der waagrechten Liste schnitt
            die Oberkante der Knöpfe ab (Geräteprobe vor 1.4.0). */}
        <View style={styles.tabRows}>
          <SegmentedTabs items={filters} value={filter} onChange={setFilter} label="Was zeigen" />
          {signedIn || (view === "list" && filter === "all") || hasInternal ? (
            <View style={styles.chips}>
              {signedIn ? <Chip label="Nur meine" on={onlyMine} onPress={() => setOnlyMine((value) => !value)} testID="events-only-mine" /> : null}
              {view === "list" && filter === "all" ? (
                <Chip label="Turniere auch einzeln" on={mode === "separate"} onPress={toggleMode} testID="events-mode-separate" />
              ) : null}
              {hasInternal ? scopes.filter((item) => item.key === "club").map((item) => (
                <Chip key={item.key} label={item.label} on={scope === item.key} onPress={() => setScope((current) => (current === "club" ? "all" : "club"))} testID="events-scope-club" />
              )) : null}
            </View>
          ) : null}
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
            {/* Abonnieren (#1189): der öffentliche Vereinskalender bleibt im Handy-Kalender aktuell. */}
            <Card style={styles.subscribe} testID="calendar-subscribe">
              <Body style={styles.subscribeTitle}>Kalender abonnieren</Body>
              <Muted>Alle öffentlichen Termine in deinem Kalender – Änderungen kommen von selbst nach. Deinen persönlichen Link mit nur deinen Terminen gibt es auf der Website unter Kalender.</Muted>
              <View style={styles.subscribeButtons}>
                <Button label="Im Kalender öffnen" variant="secondary" compact onPress={() => { Linking.openURL(feed.webcal).catch(() => undefined); }} testID="calendar-subscribe-webcal" />
                <Button label="Google Kalender" variant="quiet" compact onPress={() => { Linking.openURL(feed.google).catch(() => undefined); }} testID="calendar-subscribe-google" />
              </View>
            </Card>
          </View>
        ) : null}

        {view === "list" && filter === "all" && openEntries.length ? (
          <View style={styles.stats}>
            <Stat label="Events" value={String(counts.events)} color={kindColors.event} />
            <Stat label="Turniere" value={String(counts.tournaments)} color={kindColors.tournament} />
            <Stat label="Fast Laps" value={String(counts.fastlaps)} color={kindColors.fastlap} />
          </View>
        ) : null}

        {view === "list" ? (openEntries.length ? (
          openEntries.map((entry, index) => (
            <ListItemFadeIn key={entry.card.key} entrance={entrance} id={entry.card.key} index={index}>
              <EntryCard entry={entry} onOpen={open} opened={opened.has(entry.card.key)} onToggle={() => toggleOpened(entry.card.key)} />
            </ListItemFadeIn>
          ))
        ) : (
          <EmptyState
            icon="calendar-clear-outline"
            title={mineOnly ? "Hier bist du nirgends dabei" : "Nichts Offenes"}
            detail={mineOnly ? "„Nur meine“ zeigt, wofür du selbst oder dein Team angemeldet bist." : pastEntries.length ? "Alles, was hier war, ist vorbei – unten lässt sich Vergangenes einblenden." : "Sobald etwas geplant ist, steht es hier."}
          />
        )) : null}

        {view === "list" && pastEntries.length ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setShowPast((value) => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showPast }}
              style={({ pressed }) => [styles.pastToggle, pressed && styles.pressed]}
              testID="events-past-toggle"
            >
              <Body style={styles.pastToggleText}>{showPast ? "Vergangene ausblenden" : `Vergangene anzeigen (${pastEntries.length})`}</Body>
            </Pressable>
            {showPast ? (
              <View style={styles.section}>
                <Heading>Vergangen</Heading>
                {pastEntries.map((entry, index) => (
                  <ListItemFadeIn key={entry.card.key} entrance={entrance} id={entry.card.key} index={index}>
                    <EntryCard entry={entry} onOpen={open} opened={opened.has(entry.card.key)} onToggle={() => toggleOpened(entry.card.key)} />
                  </ListItemFadeIn>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** Ein Umschalter in der Filterzeile - an ist er blau umrandet, der Vorleser hört „ausgewählt“. */
function Chip({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
      testID={testID}
    >
      <Muted style={[styles.chipText, on && styles.chipTextOn]}>{label}</Muted>
    </Pressable>
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

/** Eine Karte der Liste; ein Event mit Turnieren klappt sie darunter auf (Tag, Uhrzeit, Spielart, eigener Stand). */
function EntryCard({ entry, onOpen, opened, onToggle }: { entry: Entry; onOpen: (item: HubItem) => void; opened: boolean; onToggle: () => void }) {
  const { card } = entry;
  const ownChild = card.children.some((row) => row.mine);
  return (
    <View style={styles.entry}>
      <HubContentCard item={entry} onPress={() => onOpen(entry)} hint={card.event ? `gehört zu ${(card.event as ClubEvent).name || (card.event as ClubEvent).title || "einem Event"}` : null} />
      {entry.children.length ? (
        <View style={styles.children}>
          <Pressable
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: opened }}
            accessibilityLabel={`${childSummary(card.children)}${ownChild ? ", du bist dabei" : ""}`}
            style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
            testID={`event-toggle-${card.item.id}`}
          >
            <Body style={styles.toggleText}>{childSummary(card.children)}</Body>
            {ownChild && !opened ? <Muted style={styles.ownText}>Du bist dabei</Muted> : null}
            <Muted>{opened ? "▴" : "▾"}</Muted>
          </Pressable>
          {opened ? entry.children.map((child, index) => (
            <ChildRow key={card.children[index].key} item={child} row={card.children[index]} onPress={() => onOpen(child)} />
          )) : null}
        </View>
      ) : null}
    </View>
  );
}

function ChildRow({ item, row, onPress }: { item: HubItem; row: GroupRow<AnyDoc>; onPress: () => void }) {
  const when = item.date ? viennaDateTime(item.date, { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "Termin folgt";
  const play = playLabel(row.kind, row.item as Tournament);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[row.kind === "fastlap" ? "Fast Lap" : "Turnier", item.title, when, play, item.own].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.childRow, { borderLeftColor: kindColors[row.kind] }, pressed && styles.pressed]}
      testID={`event-child-${row.kind}-${row.item.id}`}
    >
      <Muted>{[when, play].filter(Boolean).join(" · ")}</Muted>
      <Body style={styles.childTitle}>{item.title}</Body>
      {item.own ? <Muted style={styles.ownText} testID={`event-child-own-${row.item.id}`}>{item.own}</Muted> : null}
    </Pressable>
  );
}

function HubContentCard({ item, onPress, hint = null }: { item: HubItem; onPress: () => void; hint?: string | null }) {
  return (
    <ContentCard
      kind={item.kind}
      title={item.title}
      image={item.image}
      date={item.date}
      label={item.phase}
      status={item.status}
      detail={[item.detail, hint].filter(Boolean).join(" · ")}
      secondaryLabel={item.own}
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

const styles = StyleSheet.create({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipOn: {
    backgroundColor: "rgba(255,215,0,0.12)",
    borderColor: "rgba(255,215,0,0.5)",
  },
  chipText: {
    fontWeight: "900",
  },
  chipTextOn: {
    color: colors.gold,
  },
  children: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 6,
    padding: 8,
  },
  toggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 6,
  },
  toggleText: {
    flex: 1,
    fontWeight: "900",
  },
  ownText: {
    color: colors.gold,
    fontWeight: "800",
  },
  childRow: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 2,
    padding: 10,
  },
  childTitle: {
    fontWeight: "800",
  },
  entry: {
    gap: 6,
  },
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
  subscribe: {
    gap: 8,
  },
  subscribeTitle: {
    fontWeight: "900",
  },
  subscribeButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
