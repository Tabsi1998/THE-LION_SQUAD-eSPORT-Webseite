import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ErrorState, PartialLoadNotice, SkeletonList } from "../../components/ListState";
import { CountUp, Glow, Press, StaggerIn, staggerInDelay, useReduceMotion } from "../../components/motion";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { API_URL } from "../../config";
import { api } from "../../lib/api";
import {
  cellText, isStruck, levelState, overallApiPath, overallWinner, pointsWord, rulesLine, seasonColumns,
  type OverallLevel, type OverallRow, type OverallView,
} from "../../lib/leagueOverall";
import { countDelay, countsUp } from "../../lib/countUp";
import { useKeyedLoad } from "../../lib/useKeyedLoad";
import type { AppStackParamList } from "../../navigation/types";
import { colors, motion, radius, roles, surfaces } from "../../theme";

// Gesamtwertung über Seasons in der App (F.5, #2215; App: #2173, Web: pages/public/LeagueSeasonOverallPage.jsx): der Zeitraum dieser
// Season, je Liga N eine eigene Wertung mit Co-Teams und Spielern. Eine einfache Liste statt der breiten Tabelle: Platz, Name, Summe; ein
// Tipp klappt die Punkte je Season auf (Platz, Staffelsieg, Streichergebnis durchgestrichen, ausgeschieden). Gerechnet wird auf dem Server
// nach der Sichtbarkeit der Person. Einen „Gesamtsieger“ gibt es nur bei abgeschlossener Wertung mit ganzer Sicht (`complete`).
// Bewegung (Detail-Runde): Die Zeilen steigen gestaffelt ein, die Summen zählen hoch, der Gesamtsieger und Aufsteiger in der Wertung leuchten
// danach einmal auf, der Pfeil dreht sich beim Aufklappen. Nur Verschieben, Drehen und Deckkraft; „Bewegung reduzieren“: alles steht.

type Props = NativeStackScreenProps<AppStackParamList, "LeagueOverall">;
type Kind = "teams" | "players";
const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

function Chevron({ open }: { open: boolean }) {
  const reduce = useReduceMotion();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = reduce ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: motion.mid, easing: ease });
  }, [open, reduce, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <Ionicons name="chevron-down" size={16} color={roles.quiet} />
    </Animated.View>
  );
}

function StandingRow({ row, index, kind, columns, leader, onOpen }: {
  row: OverallRow;
  index: number;
  kind: Kind;
  columns: Array<{ id: string; name: string }>;
  leader: boolean;
  onOpen: (row: OverallRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const cells = row.seasons || [];
  const delay = staggerInDelay(index);
  const canOpen = (kind === "teams" && Boolean(row.team_id)) || (kind === "players" && Boolean(row.username));
  const label = `Platz ${row.place}${row.tie ? " (geteilt)" : ""}: ${row.name || "Team"}, ${pointsWord(row.total)}${leader ? ", führt die Gesamtwertung an" : ""}${row.climbed ? ", in der Wertung nach vorn gekommen" : ""}`;
  return (
    <View style={[styles.row, leader && styles.leaderRow]} testID={`overall-row-${index}`}>
      <Press onPress={() => setOpen((value) => !value)} style={styles.rowHead} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={label} accessibilityHint="Punkte je Season" testID={`overall-row-${index}-toggle`}>
        <Text style={[styles.rank, row.place === 1 && styles.first]}>{row.place}.</Text>
        <View style={styles.nameBox}>
          {leader ? <Ionicons name="trophy" size={14} color={roles.honor} /> : null}
          <Text style={[styles.name, row.private && styles.private]} numberOfLines={2}>{row.name || "Team"}</Text>
          {row.climbed ? <View testID={`overall-row-${index}-up`}><Ionicons name="arrow-up" size={13} color={roles.ok} /></View> : null}
        </View>
        <CountUp value={row.total} delay={countDelay(index)} play={countsUp(index)} style={styles.total} containerStyle={styles.totalBox} />
        <Chevron open={open} />
      </Press>
      {row.lead_decision ? (
        <Muted style={styles.decision} testID={`overall-row-${index}-decision`}>{row.lead_decision.method_label || "Entscheid"}: {row.lead_decision.reason}</Muted>
      ) : null}
      {open ? (
        <View style={styles.detail} testID={`overall-row-${index}-detail`}>
          {cells.map((cell, at) => {
            const name = columns[at]?.name || "Season";
            const struck = isStruck(cell);
            return (
              <View key={cell.season_id} style={styles.cell} accessible accessibilityLabel={cellText(cell, name)} testID={`overall-row-${index}-cell-${cell.season_id}`}>
                <View style={styles.cellMain}>
                  <Text style={styles.cellSeason}>
                    {name}{cell.played && !cell.exit && cell.place ? ` · Platz ${cell.place} von ${cell.of}` : ""}{cell.exit ? " · ausgeschieden" : ""}
                  </Text>
                  {cell.champion || struck || cell.co_team_name ? (
                    <Text style={styles.cellNote}>
                      {[cell.champion ? "Staffelsieg" : "", struck ? "Streichergebnis" : "", cell.co_team_name ? `für ${cell.co_team_name}` : ""].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                </View>
                {cell.champion ? <Ionicons name="trophy" size={12} color={roles.honor} /> : null}
                <Text style={[styles.cellPoints, struck && styles.struck]}>{cell.played ? pointsWord(cell.points) : "–"}</Text>
              </View>
            );
          })}
          {canOpen ? (
            <Button compact={false} variant="secondary" arrow={false} icon={kind === "teams" ? "people-outline" : "person-outline"}
              label={kind === "teams" ? "Zum Team" : "Zum Profil"} onPress={() => onOpen(row)} testID={`overall-row-${index}-open`} />
          ) : null}
        </View>
      ) : null}
      {leader ? <Glow active tone="honor" delay={(delay ?? 0) + 420} radius={radius.lg} /> : null}
      {!leader && row.climbed ? <Glow active tone="ok" delay={(delay ?? 0) + 420} radius={radius.lg} /> : null}
    </View>
  );
}

function LevelBlock({ block, view, pdf, onOpen }: { block: OverallLevel; view: OverallView; pdf: string; onOpen: (kind: Kind, row: OverallRow) => void }) {
  const [kind, setKind] = useState<Kind>("teams");
  const rows = (kind === "teams" ? block.teams : block.players) || [];
  const columns = seasonColumns(view.seasons, block.season_ids);
  const winner = overallWinner(block);
  const leaders = rows.filter((row) => row.place === 1);
  const leaderKey = leaders.length === 1 ? leaders[0] : null;
  const settings = block.settings || view.settings || null;
  return (
    <View style={styles.level} testID={`overall-${block.level}`}>
      <View style={styles.levelHead}>
        <Title style={styles.levelTitle}>{block.label || `Liga ${block.level}`}</Title>
        <View style={styles.inline}>
          {block.closed ? <Ionicons name="lock-closed" size={13} color={roles.quiet} /> : null}
          <Muted style={styles.small} testID={`overall-${block.level}-state`}>{levelState(block)}</Muted>
        </View>
      </View>
      <SegmentedTabs label="Wertung" items={[{ key: "teams" as Kind, label: "Co-Teams" }, { key: "players" as Kind, label: "Spieler" }]} value={kind} onChange={setKind} />
      {/* Gesamtsieger nur, wenn die Person die ganze Fassung sieht - sonst ist Platz 1 nicht der echte Sieger. */}
      {winner ? (
        <View style={styles.winner} testID={`overall-${block.level}-winner`}>
          <Ionicons name="trophy" size={16} color={roles.honor} />
          <Text style={styles.winnerLabel}>Gesamtsieger</Text>
          <Text style={styles.winnerName} numberOfLines={2}>{winner.name}</Text>
          <Glow active tone="honor" delay={300} radius={radius.sm} />
        </View>
      ) : null}
      {rows.length ? (
        <StaggerIn key={kind} style={styles.list} testID={`overall-${block.level}-${kind}`}>
          {rows.map((row, index) => (
            <StandingRow key={`${row.key || row.name}-${index}`} row={row} index={index} kind={kind} columns={columns}
              leader={leaderKey === row && !(block.closed && block.complete === false)} onOpen={(item) => onOpen(kind, item)} />
          ))}
        </StaggerIn>
      ) : <Muted style={styles.emptyRows}>Noch niemand in der Wertung.</Muted>}
      <View style={styles.legend} accessibilityLabel="Zeichen der Wertung">
        <View style={styles.inline}><Ionicons name="trophy" size={12} color={roles.honor} /><Muted style={styles.small}>Staffelsieg (mit Zusatzpunkten)</Muted></View>
        <Muted style={styles.small}><Text style={styles.struck}>3 Punkte</Text> Streichergebnis · – nicht dabei · ausgeschieden 0 Punkte</Muted>
        {kind === "players" ? <Muted style={styles.small}>Spieler bekommen die Punkte ihres Co-Teams, wenn sie mindestens ein Spiel gespielt haben.</Muted> : null}
      </View>
      {settings ? <Muted style={styles.small} testID={`overall-${block.level}-rules`}>{rulesLine(settings)}</Muted> : null}
      <Button variant="secondary" arrow={false} icon="document-outline" label="PDF öffnen" accessibilityLabel={["Gesamtwertung", block.label, "als PDF öffnen"].filter(Boolean).join(" ")}
        onPress={() => { Linking.openURL(`${pdf}?level=${block.level}`).catch(() => undefined); }} testID={`overall-${block.level}-pdf`} />
    </View>
  );
}

export function LeagueOverallScreen({ navigation, route }: Props) {
  const { league, season } = route.params;
  const fetchOverall = useCallback(async (key: string): Promise<OverallView> => {
    const split = key.indexOf("/");
    const { data } = await api.get<OverallView>(overallApiPath(key.slice(0, split), key.slice(split + 1)));
    return data || {};
  }, []);
  const { data: view, loading, problem, stale, reload } = useKeyedLoad(`${league}/${season}`, fetchOverall);
  const [level, setLevel] = useState<number | null>(route.params.level ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void reload().finally(() => setRefreshing(false));
  };
  const openRow = (kind: Kind, row: OverallRow) => {
    if (kind === "teams" && row.team_id) navigation.navigate("TeamDetail", { id: row.team_id });
    else if (kind === "players" && row.username) navigation.navigate("PublicProfile", { username: row.username });
  };

  if (loading && !view) {
    return (
      <Screen>
        <SkeletonList count={4} hasImage={false} />
      </Screen>
    );
  }
  if (!view) {
    return (
      <Screen>
        <ErrorState title="Keine Gesamtwertung" detail="Für diese Season gibt es keine Gesamtwertung." problem={problem} onRetry={() => { void reload(); }} testID="overall-missing" />
      </Screen>
    );
  }
  const levels = view.levels || [];
  const active = levels.find((row) => row.level === level) || levels[0] || null;
  const pdf = `${API_URL}${overallApiPath(league, season)}.pdf`;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.cyan} />} testID="overall">
        {stale && problem ? <PartialLoadNotice problem={problem} onRetry={() => { void reload(); }} testID="overall-stale" /> : null}
        <Card style={styles.head}>
          <Text style={styles.kicker}>Gesamtwertung</Text>
          <Heading testID="overall-period">{view.period?.name || "Gesamtwertung"}</Heading>
          <Muted>{(view.seasons || []).map((row) => row.name).filter(Boolean).join(", ") || "noch keine Season"}</Muted>
        </Card>
        {levels.length > 1 ? (
          <SegmentedTabs label="Liga N" items={levels.map((row) => ({ key: String(row.level), label: row.label || `Liga ${row.level}` }))}
            value={String(active?.level ?? "")} onChange={(key) => setLevel(Number(key))} />
        ) : null}
        {active ? <LevelBlock key={active.level} block={active} view={view} pdf={pdf} onOpen={openRow} /> : (
          <Body style={styles.empty} testID="overall-empty">Noch keine abgeschlossene Season – die Gesamtwertung beginnt mit dem ersten Endstand.</Body>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 18, paddingBottom: 40 },
  head: { gap: 4 },
  kicker: { color: roles.brand, fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  level: { gap: 12 },
  levelHead: { gap: 4 },
  levelTitle: { fontSize: 24 },
  inline: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  small: { fontSize: 12 },
  winner: { alignItems: "center", alignSelf: "flex-start", borderColor: "rgba(255,215,0,0.45)", borderRadius: radius.sm, borderWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 6, maxWidth: "100%", paddingHorizontal: 10, paddingVertical: 6 },
  winnerLabel: { color: roles.honor, fontSize: 13, fontWeight: "900" },
  winnerName: { color: colors.white, flexShrink: 1, fontSize: 13, fontWeight: "800" },
  list: { gap: 8 },
  row: { backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  leaderRow: { borderColor: "rgba(255,215,0,0.45)" },
  rowHead: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8 },
  rank: { color: roles.muted, fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "900", width: 30 },
  first: { color: roles.honor },
  nameBox: { alignItems: "center", flex: 1, flexDirection: "row", gap: 6, minWidth: 0 },
  name: { color: colors.white, flexShrink: 1, fontSize: 14, fontWeight: "800" },
  private: { color: roles.muted, fontStyle: "italic" },
  total: { color: colors.white, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "900", textAlign: "right" },
  totalBox: { minWidth: 36 },
  decision: { fontSize: 11, paddingBottom: 8, paddingHorizontal: 12 },
  detail: { borderTopColor: "rgba(255,255,255,0.06)", borderTopWidth: 1, gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  cell: { alignItems: "center", flexDirection: "row", gap: 8, minHeight: 32 },
  cellMain: { flex: 1, minWidth: 0 },
  cellSeason: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  cellNote: { color: roles.quiet, fontSize: 11 },
  cellPoints: { color: colors.white, fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "800" },
  struck: { color: roles.quiet, textDecorationLine: "line-through" },
  legend: { gap: 4 },
  emptyRows: { paddingVertical: 16, textAlign: "center" },
  empty: { color: roles.muted, paddingVertical: 24, textAlign: "center" },
});
