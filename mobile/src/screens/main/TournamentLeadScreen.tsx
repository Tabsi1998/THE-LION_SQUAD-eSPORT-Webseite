import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ErrorState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Muted, Title } from "../../components/Text";
import { ResultEntrySheet, ResultUndoBar, useResultUndo } from "../../components/results/ResultEntrySheet";
import { DisputeCard } from "../../components/results/DisputeCard";
import { api, errorMessage } from "../../lib/api";
import { formatWhen } from "../../lib/format";
import type { ResultEntry } from "../../lib/resultEntry";
import { leadFilter, leadLine, leadNames, type LeadFilter } from "../../lib/tournamentLead";
import type { TournamentStackParamList } from "../../navigation/types";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { colors } from "../../theme";

// Turnierleitung am Handy (#1156): dieselbe Ansicht wie /tournaments/<slug>/leitung auf der Website. Reiter
// „Ergebnisse“: alle offenen Spiele, zuerst was fehlt, dann nach Station; „Eintragen“ öffnet das Ergebnis-Fenster,
// danach 10 Sekunden „Rückgängig“. Nur für die Turnierleitung dieses Turniers - der Server prüft jede Anfrage.

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentLead">;

type LeadView = {
  tournament?: { id: string; slug?: string; title?: string; status?: string };
  matches?: ResultEntry[];
  recent?: ResultEntry[];
  counts?: { open?: number; running?: number; missing?: number };
};

const LIVE = ["matches", "matches-v2", "tournaments", "stations"];

export function TournamentLeadScreen({ route }: Props) {
  const [view, setView] = useState<LeadView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [openId, setOpenId] = useState(route.params?.spiel || "");
  const [notice, setNotice] = useState("");
  const [deciding, setDeciding] = useState(false);
  // Eigene Adresse je Fall (#1158, #1160): fall=ds-<spiel> hebt den Streitfall hervor.
  const fall = route.params?.fall || "";

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<LeadView>(`/tournaments/${encodeURIComponent(route.params.id)}/lead`);
      setView(data || null);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Diese Ansicht ist nur für die Turnierleitung dieses Turniers."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [route.params.id]);

  const isFocused = useIsFocused();
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useLiveRefresh(() => load(), LIVE, { enabled: isFocused, fallbackMs: 15000 });
  const undo = useResultUndo(() => { void load(); });

  const matches = useMemo(() => view?.matches || [], [view]);
  const shown = useMemo(() => matches.filter((item) => leadFilter(item, filter)), [matches, filter]);
  const opened = [...matches, ...(view?.recent || [])].find((item) => item.id === openId && item.can_enter) || null;
  const disputes = matches.filter((item) => item.dispute);

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

  if (loading) {
    return <Screen><SkeletonList count={4} hasImage={false} /></Screen>;
  }
  if (!view) {
    return <Screen><ErrorState title="Turnierleitung" detail={error || "Diese Ansicht ist nur für die Turnierleitung dieses Turniers."} /></Screen>;
  }

  const counts = view.counts || {};
  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.cyan} />}
      >
        <View style={styles.header}>
          <Muted style={styles.eyebrow}>Turnierleitung</Muted>
          <Title>{view.tournament?.title || "Turnier"}</Title>
        </View>
        {disputes.length ? (
          <View style={styles.stack} testID="lead-disputes">
            <Muted style={[styles.hint, styles.red]}>Streitfälle ({disputes.length})</Muted>
            {disputes.map((item) => (
              <DisputeCard key={item.id} item={item} busy={deciding} highlighted={fall === `ds-${item.id}`} onKeep={(note) => { void keepResult(item, note); }} onChange={() => setOpenId(item.id)} />
            ))}
          </View>
        ) : null}
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
        {notice ? <Muted style={styles.notice} testID="lead-notice">{notice}</Muted> : null}
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
  row: { alignItems: "center", flexDirection: "row", gap: 10 },
  stack: { gap: 8 },
  station: { alignItems: "center", borderColor: colors.border, borderRadius: 7, borderWidth: 1, height: 48, justifyContent: "center", paddingHorizontal: 4, width: 58 },
  stationOn: { borderColor: "rgba(41,182,232,0.45)" },
  stationText: { fontSize: 11, fontWeight: "900", textAlign: "center" },
  strong: { fontWeight: "900" },
});
