import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ErrorState, PartialLoadNotice, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Muted, Title } from "../../components/Text";
import { MatchClock } from "../../components/live/MatchClock";
import type { StationHandlers } from "../../components/live/StationTile";
import { useReduceMotion } from "../../components/motion";
import { ResultEntrySheet, ResultUndoBar, useResultUndo } from "../../components/results/ResultEntrySheet";
import { DisputeCard } from "../../components/results/DisputeCard";
import { NoticeComposer } from "../../components/tournament/NoticeComposer";
import { TournamentCockpit } from "../../components/tournament/TournamentCockpit";
import { api, errorMessage } from "../../lib/api";
import { idSegment } from "../../lib/apiIds";
import { useKeyedLoad } from "../../lib/useKeyedLoad";
import { formatWhen } from "../../lib/format";
import { stationDoneText, type LiveQueue, type QueueEntry, type QueueStation } from "../../lib/liveQueue";
import type { ResultEntry } from "../../lib/resultEntry";
import { COCKPIT_POLL_MS, cockpitProblems, type CockpitAttention, type Problem } from "../../lib/tournamentCockpit";
import { defaultLeadTab, drawCountdown, drawTargetText, leadClocked, leadFilter, leadLine, leadNames, type DrawCard, type LeadFilter, type LeadTab } from "../../lib/tournamentLead";
import type { TournamentStackParamList } from "../../navigation/types";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { serverOffset } from "../../seasons/newYear/countdown";
import { colors, roles } from "../../theme";

// Turnierleitung am Handy (#1156): dieselbe Ansicht wie /tournaments/<slug>/leitung auf der Website. Erster Reiter
// „Braucht Aufmerksamkeit“ (#1160): was hängt, mit dem passenden Knopf (Eintragen, Ansehen, Umlegen) - Erledigtes
// verschwindet von selbst. Reiter „Ergebnisse“: alle offenen Spiele, zuerst was fehlt, dann nach Station; „Eintragen“
// öffnet das Ergebnis-Fenster, danach 10 Sekunden „Rückgängig“. Nur für die Turnierleitung dieses Turniers.
// „Nicht erschienen?“ (#1551, #1563): ist die Frist um, liegt ein Vorschlag am Spiel - die fehlende Seite kampflos werten
// (mit Rückfrage, weil es das Spiel entscheidet) oder die Frist um 5 Minuten verlängern. Wie im Web.
// Reiter „Cockpit“ (#1653, #2393, nur vor Ort mit Warteschlange): der Einstieg am Turniertag - die „Probleme“ (Fälle,
// Auslosungen, Verzug je Station; ein Tipp führt zum Fall bzw. zur Station) und die Stationen mit Spielzeit-Uhr,
// „Aufrufen“, „Starten“, „Freigeben“ und „Defekt“ - dieselben Wege und Rechte wie im Web. Solange er zu sehen ist und die
// App vorne, fragen Ansicht und Warteschlange zusätzlich alle 20 Sekunden nach.
// Reiter „Hinweis“ (#1166, #2393, nur wer Hinweise schreiben darf): ein Satz an alle im Turnier oder Event.

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentLead">;

type AttentionItem = CockpitAttention & {
  kind: "result_missing" | "dispute" | "report_conflict" | "station_broken" | "no_show" | string;
  title: string;
  action: "enter" | "view" | "move" | "no_show" | string;
  participants?: Array<{ registration_id: string; name?: string }>;
};

type LeadView = {
  attention?: AttentionItem[];
  draws?: DrawCard[];
  now?: string | null;
  stations?: Array<{ id: string; name: string; status?: string; busy?: boolean }>;
  tournament?: { id: string; slug?: string; title?: string; status?: string; event_id?: string | null; can_notice?: boolean };
  matches?: ResultEntry[];
  recent?: ResultEntry[];
  counts?: { open?: number; running?: number; missing?: number };
};

const LIVE = ["matches", "matches-v2", "tournaments", "stations"];
const TAB_LABELS: Record<LeadTab, string> = { cockpit: "Cockpit", attention: "Braucht Aufmerksamkeit", results: "Ergebnisse", notice: "Hinweis" };

export function TournamentLeadScreen({ route }: Props) {
  // Laden je Turnier (#1000): eine verspätete Antwort (auch vom Live-Nachladen) wird verworfen, ein gescheitertes
  // Nachladen lässt den letzten Stand gekennzeichnet stehen.
  const fetchLead = useCallback(async (id: string) => (await api.get<LeadView>(`/tournaments/${idSegment(id)}/lead`)).data || null, []);
  const { data: view, loading, error: loadError, problem, stale, reload: load } = useKeyedLoad(route.params.id, fetchLead);
  const error = loadError ? errorMessage(loadError, "Diese Ansicht ist nur für die Turnierleitung dieses Turniers.") : "";
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [openId, setOpenId] = useState(route.params?.spiel || "");
  const [notice, setNotice] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [tab, setTab] = useState<LeadTab | null>(null);
  const [movingId, setMovingId] = useState("");
  // Eigene Adresse je Fall (#1158, #1160): fall=ds-<spiel> hebt den Streitfall hervor - auch nach einem Tipp im Cockpit.
  const [fall, setFall] = useState(route.params?.fall || "");
  const reduce = useReduceMotion();

  // Die Warteschlange vor Ort (#1556) - online gibt es sie nicht (`applies: false`), dann fehlt das Cockpit. Der Abstand
  // zur Serveruhr kommt aus derselben Antwort: die Spielzeit-Uhren zählen danach (#1167).
  const [queue, setQueue] = useState<LiveQueue | null>(null);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [queueOffset, setQueueOffset] = useState<number | null>(null);
  const [busyStation, setBusyStation] = useState("");
  const queueKey = route.params.id;
  const queueFor = useRef(queueKey);
  queueFor.current = queueKey;
  const loadQueue = useCallback(async () => {
    const asked = queueKey;
    const requestedAt = Date.now();
    try {
      const { data } = await api.get<LiveQueue>(`/tournaments/${idSegment(asked)}/live-queue`);
      if (queueFor.current !== asked) return;
      const applies = Boolean(data?.applies && Array.isArray(data.stations));
      setQueue(applies ? data : null);
      setQueueOffset(applies && data?.now ? serverOffset(data.now, requestedAt, Date.now()) : null);
    } catch {
      if (queueFor.current === asked) setQueue(null);
    } finally {
      if (queueFor.current === asked) setQueueLoaded(true);
    }
  }, [queueKey]);
  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), loadQueue()]);
    setRefreshing(false);
  }, [load, loadQueue]);

  const isFocused = useIsFocused();
  // Beim Wiederkommen frisch laden; das erste Öffnen lädt schon useKeyedLoad.
  const focusedBefore = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!focusedBefore.current) {
      focusedBefore.current = true;
      return;
    }
    void load();
    void loadQueue();
  }, [load, loadQueue]));
  const undo = useResultUndo(() => { void load(); });

  const matches = useMemo(() => view?.matches || [], [view]);
  const shown = useMemo(() => matches.filter((item) => leadFilter(item, filter)), [matches, filter]);
  const opened = [...matches, ...(view?.recent || [])].find((item) => item.id === openId && item.can_enter) || null;
  const attention = useMemo(() => view?.attention || [], [view]);
  const draws = useMemo(() => view?.draws || [], [view]);
  const cases = attention.length + draws.length;
  const byId = Object.fromEntries(matches.map((item) => [item.id, item]));
  const canNotice = Boolean(view?.tournament?.can_notice);
  // Ein gewählter Reiter gilt nur, wenn es ihn gibt: das Cockpit erst mit Warteschlange, „Hinweis“ nur mit Recht.
  const chosenTab = tab === "cockpit" && !queue ? null : tab === "notice" && !canNotice ? null : tab;
  const activeTab: LeadTab | "" = chosenTab || defaultLeadTab({ fall, cases, queue: Boolean(queue), ready: Boolean(view) && queueLoaded });
  const freeStations = (view?.stations || []).filter((station) => station.status !== "broken" && !station.busy);
  const problems = useMemo(() => cockpitProblems({ attention, draws, queue }), [attention, draws, queue]);

  // Das Cockpit fragt im Takt nach, solange es zu sehen ist und die App vorne - „Ergebnis fehlt“ und Verzug entstehen
  // mit der Zeit, ohne eigenes Ereignis. Sonst wie bisher nur bei Änderungen (die Prognose einmal je Minute).
  const cockpitOpen = activeTab === "cockpit";
  useLiveRefresh(() => load(), LIVE, { enabled: isFocused, fallbackMs: 15000, pollMs: cockpitOpen ? COCKPIT_POLL_MS : 0 });
  useLiveRefresh(() => loadQueue(), LIVE, { enabled: isFocused, fallbackMs: 15000, pollMs: cockpitOpen ? COCKPIT_POLL_MS : 60000 });

  // Hinspringen (#1653): ein Fall öffnet „Braucht Aufmerksamkeit“ an seiner Karte, Verzug springt zur Station im Cockpit.
  const scrollRef = useRef<ScrollView>(null);
  const tabTop = useRef(0);
  const caseY = useRef<Record<string, number>>({});
  const stationY = useRef<Record<string, number>>({});
  const pendingCase = useRef(route.params?.fall || "");
  const [highlight, setHighlight] = useState<{ id: string; pulse: number } | null>(null);
  const scrollTo = useCallback((y: number) => {
    scrollRef.current?.scrollTo?.({ y: Math.max(0, tabTop.current + y - 16), animated: !reduce });
  }, [reduce]);
  const onCaseLayout = (id: string) => (event: LayoutChangeEvent) => {
    caseY.current[id] = event.nativeEvent.layout.y;
    if (pendingCase.current === id) {
      pendingCase.current = "";
      scrollTo(caseY.current[id]);
    }
  };
  const openProblem = (item: Problem) => {
    if (item.target === "station") {
      setHighlight((current) => ({ id: item.stationId, pulse: (current?.id === item.stationId ? current.pulse : 0) + 1 }));
      if (stationY.current[item.stationId] !== undefined) scrollTo(stationY.current[item.stationId]);
      return;
    }
    setFall(item.id);
    setTab("attention");
    // Steht die Karte schon (derselbe Fall noch einmal), gleich hin - sonst, sobald sie gezeichnet ist.
    if (activeTab === "attention" && caseY.current[item.id] !== undefined) scrollTo(caseY.current[item.id]);
    else pendingCase.current = item.id;
  };

  // Umlegen (#1160): die wartenden Spiele einer defekten Station auf eine freie Station legen.
  const moveTo = async (item: AttentionItem, stationId: string) => {
    setDeciding(true);
    try {
      for (const matchId of item.match_ids || []) await api.patch(`/matches/${matchId}`, { station_id: stationId });
      setNotice("Umgelegt.");
      setMovingId("");
      await load();
    } catch (err) {
      setNotice(errorMessage(err, "Umlegen hat nicht geklappt."));
    } finally {
      setDeciding(false);
    }
  };

  // „Nicht erschienen?“ (#1551): kampflos werten oder verlängern - derselbe Weg wie im Web.
  const decideNoShow = async (item: AttentionItem, body: { action: "confirm"; registration_id: string } | { action: "extend"; minutes: number }) => {
    setDeciding(true);
    try {
      await api.post(`/tournaments/${idSegment(view?.tournament?.slug || route.params.id)}/lead/no-show/${item.match_id}`, body);
      setNotice(body.action === "extend" ? `Frist um ${body.minutes} Minuten verlängert.` : "Kampflos gewertet – beide Seiten bekommen Bescheid.");
      await load();
    } catch (err) {
      setNotice(errorMessage(err, "Das hat nicht geklappt."));
    } finally {
      setDeciding(false);
    }
  };
  const confirmNoShow = (item: AttentionItem, side: { registration_id: string; name?: string }) => {
    const name = side.name || "Teilnehmer";
    Alert.alert(`${name} nicht erschienen?`, `${name} verliert dieses Spiel kampflos. Die Gegenseite kommt weiter.`, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Kampflos werten", style: "destructive", onPress: () => { void decideNoShow(item, { action: "confirm", registration_id: side.registration_id }); } },
    ]);
  };

  // Streitfall entscheiden (#1158): „Ergebnis bleibt“ mit einem Tipp - beide Seiten bekommen Bescheid.
  const keepResult = async (item: ResultEntry, note: string | null) => {
    setDeciding(true);
    try {
      await api.post(`/matches/${item.id}/dispute/decision`, { decision: "keep", note });
      setNotice("Entschieden – beide Seiten bekommen Bescheid.");
      await load();
    } catch (err) {
      setNotice(errorMessage(err, "Entscheidung konnte nicht gespeichert werden."));
    } finally {
      setDeciding(false);
    }
  };

  // Show-Auslosung (#1590): „Jetzt auslosen“ - derselbe Weg wie im Web.
  const drawNow = async (card: DrawCard) => {
    setDeciding(true);
    try {
      await api.post(`/tournaments/${idSegment(view?.tournament?.slug || route.params.id)}/stages/${idSegment(card.stage_id)}/draw`, { group: card.group });
      setNotice(`${card.label}: ausgelost.`);
      await load();
    } catch (err) {
      setNotice(errorMessage(err, "Auslosen hat nicht geklappt."));
    } finally {
      setDeciding(false);
    }
  };

  // Aufrufen, Starten, Freigeben, Defekt (#1556, #1162): zwei Helfer zugleich - der Server nimmt genau einen, der andere
  // bekommt die Meldung (409) im Klartext und sieht danach den neuen Stand.
  const operateStation = async (kind: "call" | "start" | "release" | "broken", station: QueueStation, body: Record<string, unknown>, said: (done: Record<string, unknown>) => string) => {
    setBusyStation(station.id);
    try {
      const { data } = await api.post<Record<string, unknown>>(`/tournaments/${idSegment(view?.tournament?.slug || route.params.id)}/live-queue/${kind}`, { station_id: station.id, ...body });
      setNotice(said(data || {}));
    } catch (err) {
      setNotice(errorMessage(err, "Das hat nicht geklappt. Bitte neu laden."));
    } finally {
      setBusyStation("");
      await Promise.all([loadQueue(), load()]);
    }
  };
  const whereOf = (station: QueueStation) => station.station_text || station.name || "Station";
  const stationHandlers: StationHandlers = {
    onCall: (station, entry: QueueEntry) => { void operateStation("call", station, { match_id: entry.match_id }, (done) => stationDoneText("call", done, whereOf(station))); },
    onStart: (station, entry: QueueEntry) => { void operateStation("start", station, { match_id: entry.match_id }, (done) => stationDoneText("start", done, whereOf(station))); },
    onRelease: (station, entry: QueueEntry) => { void operateStation("release", station, { match_id: entry.match_id }, (done) => stationDoneText("release", done, whereOf(station))); },
    onBroken: (station, value, extra) => { void operateStation("broken", station, { broken: value, ...extra }, (done) => stationDoneText(value ? "broken" : "ready", done, whereOf(station))); },
  };

  if (!view && loading) {
    return <Screen><SkeletonList count={4} hasImage={false} /></Screen>;
  }
  if (!view) {
    return <Screen><ErrorState title="Turnierleitung" detail={error || "Diese Ansicht ist nur für die Turnierleitung dieses Turniers."} problem={problem} onRetry={() => { void load(); }} /></Screen>;
  }

  const counts = view.counts || {};
  const tabs: Array<{ key: LeadTab; label: string }> = [
    ...(queue ? [{ key: "cockpit" as const, label: TAB_LABELS.cockpit }] : []),
    { key: "attention", label: `${TAB_LABELS.attention} (${cases})` },
    { key: "results", label: TAB_LABELS.results },
    ...(canNotice ? [{ key: "notice" as const, label: TAB_LABELS.notice }] : []),
  ];
  return (
    <Screen padded={false}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.cyan} />}
      >
        {/* Nachladen gescheitert (#1000): die Liste ist ausdrücklich der letzte Stand. */}
        {stale && problem ? <PartialLoadNotice problem={problem} onRetry={() => { void load(); }} testID="lead-stale" /> : null}
        <View style={styles.header}>
          <Muted style={styles.eyebrow}>Turnierleitung</Muted>
          <Title>{view.tournament?.title || "Turnier"}</Title>
        </View>
        <SegmentedTabs value={activeTab || "attention"} onChange={(next) => setTab(next)} items={tabs} label="Ansicht" />
        {notice ? <Muted style={styles.notice} testID="lead-notice">{notice}</Muted> : null}
        {activeTab === "" ? <SkeletonList count={2} hasImage={false} /> : null}
        <View onLayout={(event) => { tabTop.current = event.nativeEvent.layout.y; }}>
          {activeTab === "cockpit" && queue ? (
            <TournamentCockpit
              problems={problems}
              loaded
              queue={queue}
              offset={queueOffset}
              busyStation={busyStation}
              highlight={highlight}
              handlers={stationHandlers}
              onOpen={openProblem}
              onStationLayout={(id, y) => { stationY.current[id] = y; }}
            />
          ) : null}
          {activeTab === "attention" ? (
            <View style={styles.stack} testID="lead-attention">
              {cases === 0 ? <Card><Muted testID="lead-attention-empty">Gerade hängt nichts.</Muted></Card> : null}
              {attention.map((item) => (
                <View key={item.id} onLayout={onCaseLayout(item.id)}>
                  {item.kind === "dispute" && item.match_id && byId[item.match_id]?.dispute ? (
                    <DisputeCard item={byId[item.match_id]} busy={deciding} highlighted={fall === item.id} onKeep={(note) => { void keepResult(byId[item.match_id as string], note); }} onChange={() => setOpenId(item.match_id as string)} />
                  ) : (
                    <Card style={[styles.caseCard, fall === item.id && styles.highlighted, item.kind === "station_broken" && styles.broken]} testID={`lead-case-${item.id}`}>
                      <View style={styles.row}>
                        <View style={[styles.station, styles.stationOn]}>
                          <Muted style={[styles.stationText, styles.cyan]} numberOfLines={2}>{item.station_text ? item.station_text.split(" · ")[0] : "ohne Station"}</Muted>
                        </View>
                        <View style={styles.flex}>
                          <Body style={styles.strong}>{item.title}</Body>
                          <Muted numberOfLines={1}>{item.label} · {item.names}</Muted>
                          <Muted style={item.kind === "station_broken" ? styles.red : styles.gold}>{item.detail}</Muted>
                        </View>
                        {item.action === "move" ? (
                          <Button label="Umlegen" variant="secondary" onPress={() => setMovingId(movingId === item.id ? "" : item.id)} disabled={deciding} testID={`lead-case-move-${item.id}`} />
                        ) : item.action === "no_show" ? null : item.match_id && byId[item.match_id]?.can_enter ? (
                          <Button label="Eintragen" onPress={() => setOpenId(item.match_id as string)} disabled={deciding} testID={`lead-case-enter-${item.id}`} />
                        ) : null}
                      </View>
                      {item.action === "no_show" ? (
                        <View style={styles.stack} testID={`lead-no-show-${item.id}`}>
                          {(item.participants || []).map((side) => (
                            <Button key={side.registration_id} label={`${side.name || "Teilnehmer"} nicht erschienen`} variant="secondary" onPress={() => confirmNoShow(item, side)} disabled={deciding} testID={`lead-no-show-${side.registration_id}`} />
                          ))}
                          <Button label="+5 Min. verlängern" variant="quiet" onPress={() => { void decideNoShow(item, { action: "extend", minutes: 5 }); }} disabled={deciding} testID={`lead-no-show-extend-${item.id}`} />
                        </View>
                      ) : null}
                      {movingId === item.id ? (
                        <View style={styles.stack} testID={`lead-case-stations-${item.id}`}>
                          <Muted style={styles.hint}>Auf welche Station?</Muted>
                          {freeStations.length ? freeStations.map((station) => (
                            <Button key={station.id} label={station.name} variant="secondary" onPress={() => { void moveTo(item, station.id); }} disabled={deciding} testID={`lead-move-to-${station.id}`} />
                          )) : <Muted>Gerade ist keine Station frei.</Muted>}
                        </View>
                      ) : null}
                    </Card>
                  )}
                </View>
              ))}
              {draws.map((card) => (
                <View key={card.id} onLayout={onCaseLayout(card.id)}>
                  <DrawCaseCard card={card} serverNow={view.now} highlighted={fall === card.id} busy={deciding} onDraw={() => { void drawNow(card); }} />
                </View>
              ))}
              <Muted>Erledigtes verschwindet von selbst. Bei neuen Fällen kommt eine Benachrichtigung.</Muted>
            </View>
          ) : null}
          {activeTab === "results" ? (
            <View style={styles.stack}>
              <SegmentedTabs
                value={filter}
                onChange={setFilter}
                items={[
                  { key: "all", label: `Alle offenen (${counts.open ?? 0})` },
                  { key: "running", label: `Läuft (${counts.running ?? 0})` },
                  { key: "missing", label: `Ergebnis fehlt (${counts.missing ?? 0})` },
                ]}
              />
              <Muted style={styles.hint}>Zuerst, was fehlt · dann nach Station</Muted>
              {shown.length === 0 ? <Card><Muted testID="lead-empty">Hier ist gerade nichts offen.</Muted></Card> : null}
              {shown.map((item) => <LeadCard key={item.id} item={item} offset={queueOffset} onEnter={() => setOpenId(item.id)} />)}
              {(view.recent || []).length ? (
                <View style={styles.stack}>
                  <Muted style={styles.hint}>Zuletzt eingetragen</Muted>
                  {(view.recent || []).map((item) => (
                    <Card key={item.id} style={styles.row}>
                      <View style={styles.flex}>
                        <Muted numberOfLines={1}>{item.stage_name ? `${item.stage_name} · ` : ""}{item.label}</Muted>
                        <Body style={styles.strong} numberOfLines={2}>{item.result_summary || leadNames(item)}</Body>
                      </View>
                      {item.can_enter ? <Button label="Korrigieren" variant="secondary" onPress={() => setOpenId(item.id)} testID={`lead-correct-${item.id}`} /> : null}
                    </Card>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          {activeTab === "notice" && canNotice && view.tournament ? (
            <NoticeComposer tournament={view.tournament} stationName={(view.stations || [])[0]?.name || ""} onMessage={setNotice} />
          ) : null}
        </View>
        <Muted>Hier stehen nur Spiele, für die du eingeteilt bist. Jede Eingabe steht im Protokoll.</Muted>
      </ScrollView>
      <ResultEntrySheet entry={opened} onClose={() => setOpenId("")} onSaved={undo.start} />
      <ResultUndoBar undo={undo} onMessage={setNotice} />
    </Screen>
  );
}

// Ein laufendes Spiel trägt die Spielzeit-Uhr (#1167) - dieselbe wie an der Station, mit der Dauer, mit der der Server
// „über der Zeit“ rechnet. Sie ersetzt „läuft 12 Min.“; fehlt das Ergebnis schon, bleibt der Hinweis darunter stehen.
function LeadCard({ item, offset, onEnter }: { item: ResultEntry; offset: number | null; onEnter: () => void }) {
  const missing = Boolean(item.timing?.missing);
  const clocked = leadClocked(item);
  return (
    <Card style={[styles.row, missing && styles.missing]} testID={`lead-row-${item.id}`}>
      <View style={[styles.station, item.station_text ? styles.stationOn : null]}>
        <Muted style={[styles.stationText, item.station_text ? styles.cyan : null]} numberOfLines={2}>{item.station_text ? item.station_text.split(" · ")[0] : "ohne Station"}</Muted>
      </View>
      <View style={styles.flex}>
        <Body style={styles.strong} numberOfLines={1}>{item.stage_name ? `${item.stage_name} · ` : ""}{item.label}</Body>
        <Muted numberOfLines={1}>{leadNames(item)}</Muted>
        {clocked ? (
          <MatchClock size="sm" startedAt={item.started_at} durationMinutes={item.timing?.duration_minutes} pausedAt={item.paused_at} pausedSeconds={item.paused_seconds} offset={offset} testID={`lead-clock-${item.id}`} style={styles.rowClock} />
        ) : null}
        {!clocked || missing ? (
          <View style={styles.lineRow}>
            <Ionicons name={item.timing?.running_minutes != null ? "radio-outline" : "time-outline"} size={13} color={missing ? colors.gold : colors.muted} />
            <Muted style={missing ? styles.gold : undefined} testID={`lead-line-${item.id}`}>{leadLine(item, (value) => formatWhen(value))}</Muted>
          </View>
        ) : null}
      </View>
      {item.hold ? (
        <Muted style={styles.cyan} testID={`lead-held-${item.id}`}>{item.hold.mine ? "gespeichert" : `${item.hold.actor_name || "Turnierleitung"} trägt ein`}</Muted>
      ) : item.can_enter ? (
        <Button label="Eintragen" onPress={onEnter} testID={`lead-enter-${item.id}`} />
      ) : null}
    </Card>
  );
}

/** Show-Auslosung (#1590): der Topf steht - die Leitung lost mit einem Tipp, sonst der Server nach der Frist. */
function DrawCaseCard({ card, serverNow, highlighted, busy, onDraw }: { card: DrawCard; serverNow?: string | null; highlighted: boolean; busy: boolean; onDraw: () => void }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const names = card.pot || [];
  return (
    <Card style={[styles.caseCard, styles.drawCard, highlighted && styles.highlighted]} testID={`lead-draw-${card.group || card.id}`}>
      <View style={styles.row}>
        <View style={[styles.station, styles.stationOn]}>
          <Ionicons name="shuffle" size={20} color={roles.brand} />
        </View>
        <View style={styles.flex}>
          <Body style={styles.strong}>Auslosung bereit · {card.pot_size} {card.pot_size === 1 ? "Name" : "Namen"}</Body>
          <Muted>{card.stage_name ? `${card.stage_name} · ` : ""}{drawTargetText(card)}</Muted>
          <Muted style={styles.cyan}>{drawCountdown(card, serverNow, tick)}</Muted>
        </View>
      </View>
      {names.length ? <Muted testID={`lead-draw-pot-${card.group || card.id}`}>Im Topf: {names.join(" · ")}</Muted> : null}
      {card.can_draw ? <Button label="Jetzt auslosen" onPress={onDraw} disabled={busy} testID={`lead-draw-now-${card.group || card.id}`} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, padding: 18, paddingBottom: 110 },
  cyan: { color: colors.cyan, fontWeight: "900" },
  drawCard: { borderColor: "rgba(41,182,232,0.45)" },
  eyebrow: { color: colors.gold, fontWeight: "900", letterSpacing: 1.5, textTransform: "uppercase" },
  flex: { flex: 1, minWidth: 0 },
  gold: { color: colors.gold, fontWeight: "800" },
  header: { gap: 4 },
  hint: { fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  lineRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  missing: { backgroundColor: "rgba(255,215,0,0.05)", borderColor: "rgba(255,215,0,0.45)" },
  notice: { color: colors.success, fontWeight: "800" },
  red: { color: colors.live },
  broken: { borderColor: "rgba(255,59,48,0.45)" },
  caseCard: { borderColor: "rgba(255,215,0,0.45)", gap: 10 },
  highlighted: { borderColor: colors.gold, borderWidth: 2 },
  row: { alignItems: "center", flexDirection: "row", gap: 10 },
  rowClock: { marginTop: 4 },
  stack: { gap: 8 },
  station: { alignItems: "center", borderColor: colors.border, borderRadius: 7, borderWidth: 1, height: 48, justifyContent: "center", paddingHorizontal: 4, width: 58 },
  stationOn: { borderColor: "rgba(41,182,232,0.45)" },
  stationText: { fontSize: 11, fontWeight: "900", textAlign: "center" },
  strong: { fontWeight: "900" },
});
