import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ErrorState, PartialLoadNotice, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Muted, Title } from "../../components/Text";
import { ResultEntrySheet, ResultUndoBar, useResultUndo } from "../../components/results/ResultEntrySheet";
import { DisputeCard } from "../../components/results/DisputeCard";
import { api, errorMessage } from "../../lib/api";
import { idSegment } from "../../lib/apiIds";
import { useKeyedLoad } from "../../lib/useKeyedLoad";
import { formatWhen } from "../../lib/format";
import type { ResultEntry } from "../../lib/resultEntry";
import { leadFilter, leadLine, leadNames, type LeadFilter } from "../../lib/tournamentLead";
import type { TournamentStackParamList } from "../../navigation/types";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { colors } from "../../theme";

// Turnierleitung am Handy (#1156): dieselbe Ansicht wie /tournaments/<slug>/leitung auf der Website. Erster Reiter
// „Braucht Aufmerksamkeit“ (#1160): was hängt, mit dem passenden Knopf (Eintragen, Ansehen, Umlegen) - Erledigtes
// verschwindet von selbst. Reiter „Ergebnisse“: alle offenen Spiele, zuerst was fehlt, dann nach Station; „Eintragen“
// öffnet das Ergebnis-Fenster, danach 10 Sekunden „Rückgängig“. Nur für die Turnierleitung dieses Turniers.

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentLead">;

type AttentionItem = {
  id: string;
  kind: "result_missing" | "dispute" | "report_conflict" | "station_broken" | string;
  title: string;
  detail?: string;
  action: "enter" | "view" | "move" | string;
  match_id?: string;
  match_ids?: string[];
  station_text?: string;
  label?: string;
  names?: string;
};

type LeadView = {
  attention?: AttentionItem[];
  stations?: Array<{ id: string; name: string; status?: string; busy?: boolean }>;
  tournament?: { id: string; slug?: string; title?: string; status?: string };
  matches?: ResultEntry[];
  recent?: ResultEntry[];
  counts?: { open?: number; running?: number; missing?: number };
};

const LIVE = ["matches", "matches-v2", "tournaments", "stations"];

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
  const [tab, setTab] = useState<"attention" | "results" | null>(null);
  const [movingId, setMovingId] = useState("");
  // Eigene Adresse je Fall (#1158, #1160): fall=ds-<spiel> hebt den Streitfall hervor.
  const fall = route.params?.fall || "";

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const isFocused = useIsFocused();
  // Beim Wiederkommen frisch laden; das erste Öffnen lädt schon useKeyedLoad.
  const focusedBefore = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!focusedBefore.current) {
      focusedBefore.current = true;
      return;
    }
    void load();
  }, [load]));
  useLiveRefresh(() => load(), LIVE, { enabled: isFocused, fallbackMs: 15000 });
  const undo = useResultUndo(() => { void load(); });

  const matches = useMemo(() => view?.matches || [], [view]);
  const shown = useMemo(() => matches.filter((item) => leadFilter(item, filter)), [matches, filter]);
  const opened = [...matches, ...(view?.recent || [])].find((item) => item.id === openId && item.can_enter) || null;
  const attention = view?.attention || [];
  const byId = Object.fromEntries(matches.map((item) => [item.id, item]));
  const activeTab = tab || (fall || attention.length ? "attention" : "results");
  const freeStations = (view?.stations || []).filter((station) => station.status !== "broken" && !station.busy);

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

  if (!view && loading) {
    return <Screen><SkeletonList count={4} hasImage={false} /></Screen>;
  }
  if (!view) {
    return <Screen><ErrorState title="Turnierleitung" detail={error || "Diese Ansicht ist nur für die Turnierleitung dieses Turniers."} problem={problem} onRetry={() => { void load(); }} /></Screen>;
  }

  const counts = view.counts || {};
  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.cyan} />}
      >
        {/* Nachladen gescheitert (#1000): die Liste ist ausdrücklich der letzte Stand. */}
        {stale && problem ? <PartialLoadNotice problem={problem} onRetry={() => { void load(); }} testID="lead-stale" /> : null}
        <View style={styles.header}>
          <Muted style={styles.eyebrow}>Turnierleitung</Muted>
          <Title>{view.tournament?.title || "Turnier"}</Title>
        </View>
        <SegmentedTabs
          value={activeTab}
          onChange={setTab}
          items={[{ key: "attention", label: `Braucht Aufmerksamkeit (${attention.length})` }, { key: "results", label: "Ergebnisse" }]}
        />
        {notice ? <Muted style={styles.notice} testID="lead-notice">{notice}</Muted> : null}
        {activeTab === "attention" ? (
          <View style={styles.stack} testID="lead-attention">
            {attention.length === 0 ? <Card><Muted testID="lead-attention-empty">Gerade hängt nichts.</Muted></Card> : null}
            {attention.map((item) => (item.kind === "dispute" && item.match_id && byId[item.match_id]?.dispute ? (
              <DisputeCard key={item.id} item={byId[item.match_id]} busy={deciding} highlighted={fall === item.id} onKeep={(note) => { void keepResult(byId[item.match_id as string], note); }} onChange={() => setOpenId(item.match_id as string)} />
            ) : (
              <Card key={item.id} style={[styles.caseCard, fall === item.id && styles.highlighted, item.kind === "station_broken" && styles.broken]} testID={`lead-case-${item.id}`}>
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
                  ) : item.match_id && byId[item.match_id]?.can_enter ? (
                    <Button label="Eintragen" onPress={() => setOpenId(item.match_id as string)} disabled={deciding} testID={`lead-case-enter-${item.id}`} />
                  ) : null}
                </View>
                {movingId === item.id ? (
                  <View style={styles.stack} testID={`lead-case-stations-${item.id}`}>
                    <Muted style={styles.hint}>Auf welche Station?</Muted>
                    {freeStations.length ? freeStations.map((station) => (
                      <Button key={station.id} label={station.name} variant="secondary" onPress={() => { void moveTo(item, station.id); }} disabled={deciding} testID={`lead-move-to-${station.id}`} />
                    )) : <Muted>Gerade ist keine Station frei.</Muted>}
                  </View>
                ) : null}
              </Card>
            )))}
            <Muted>Erledigtes verschwindet von selbst. Bei neuen Fällen kommt eine Benachrichtigung.</Muted>
          </View>
        ) : null}
        {activeTab === "results" ? (<>
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
        {shown.map((item) => <LeadCard key={item.id} item={item} onEnter={() => setOpenId(item.id)} />)}
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
        </>) : null}
        <Muted>Hier stehen nur Spiele, für die du eingeteilt bist. Jede Eingabe steht im Protokoll.</Muted>
      </ScrollView>
      <ResultEntrySheet entry={opened} onClose={() => setOpenId("")} onSaved={undo.start} />
      <ResultUndoBar undo={undo} onMessage={setNotice} />
    </Screen>
  );
}

function LeadCard({ item, onEnter }: { item: ResultEntry; onEnter: () => void }) {
  const missing = Boolean(item.timing?.missing);
  return (
    <Card style={[styles.row, missing && styles.missing]} testID={`lead-row-${item.id}`}>
      <View style={[styles.station, item.station_text ? styles.stationOn : null]}>
        <Muted style={[styles.stationText, item.station_text ? styles.cyan : null]} numberOfLines={2}>{item.station_text ? item.station_text.split(" · ")[0] : "ohne Station"}</Muted>
      </View>
      <View style={styles.flex}>
        <Body style={styles.strong} numberOfLines={1}>{item.stage_name ? `${item.stage_name} · ` : ""}{item.label}</Body>
        <Muted numberOfLines={1}>{leadNames(item)}</Muted>
        <View style={styles.lineRow}>
          <Ionicons name={item.timing?.running_minutes != null ? "radio-outline" : "time-outline"} size={13} color={missing ? colors.gold : colors.muted} />
          <Muted style={missing ? styles.gold : undefined} testID={`lead-line-${item.id}`}>{leadLine(item, (value) => formatWhen(value))}</Muted>
        </View>
      </View>
      {item.hold ? (
        <Muted style={styles.cyan} testID={`lead-held-${item.id}`}>{item.hold.mine ? "gespeichert" : `${item.hold.actor_name || "Turnierleitung"} trägt ein`}</Muted>
      ) : item.can_enter ? (
        <Button label="Eintragen" onPress={onEnter} testID={`lead-enter-${item.id}`} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, padding: 18, paddingBottom: 110 },
  cyan: { color: colors.cyan, fontWeight: "900" },
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
  stack: { gap: 8 },
  station: { alignItems: "center", borderColor: colors.border, borderRadius: 7, borderWidth: 1, height: 48, justifyContent: "center", paddingHorizontal: 4, width: 58 },
  stationOn: { borderColor: "rgba(41,182,232,0.45)" },
  stationText: { fontSize: 11, fontWeight: "900", textAlign: "center" },
  strong: { fontWeight: "900" },
});
