import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { FadeIn } from "../../components/FadeIn";
import { ErrorState, SkeletonList, loadProblem, type LoadProblem } from "../../components/ListState";
import { ink } from "../../components/references/parts";
import { SeasonCalendar } from "../../components/references/season/SeasonCalendar";
import { SeasonDrivers } from "../../components/references/season/SeasonDrivers";
import { SeasonStandings } from "../../components/references/season/SeasonStandings";
import { SeasonStatistics } from "../../components/references/season/SeasonStatistics";
import { SeasonNotice, StateChip } from "../../components/references/seriesParts";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { api } from "../../lib/api";
import {
  leagueTableRows,
  matchdayRows,
  seasonEyebrow,
  seasonFigures,
  seasonKind,
  seasonTabs,
  seasonTitle,
  seasonWebPath,
  type SeasonPage,
  type SeasonTabKey,
} from "../../lib/referenceSeason";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import type { MoreStackParamList } from "../../navigation/types";
import { colors, surfaces } from "../../theme";

// Saison einer Serie (#1945) nach dem freigegebenen Entwurf „AppSaison“ (21.10.2026), nur lesen: Kopf mit Art, Titel und
// Kennzahlen (ohne Nullen), dann je Art eigene Reiter - Rennliga: Kalender, Tabelle (Fahrer/Teams), Fahrer (Vereins-
// Garage); Team-Liga: Spieltage und Tabelle; Turnierserie: Termine und Tabelle. Die Daten kommen aus dem öffentlichen
// Endpunkt der Serienseite des Webs, die Logik steht in lib/referenceSeason.ts. Das Land eines Termins steht als Flagge
// da (#1925, Datei von der Website).
// #1974: Runde mit Läufen (#1930) - Kalender je Runde mit Lauf-Chips, Wertung je Lauf, Poles, Ø Start, Quali-Duell; eine
// Runde öffnet ihr Ergebnis (#1950). Sonderregeln (#1960) - Hinweis „Saison abgebrochen“ mit Nachfolger,
// Regeländerungen, „−5“ mit Grund, Quelle und Modus der Teamwertung. Was die App nicht zeigt (Rennraster, Finale,
// Platzierungsverlauf), öffnet „Im Web öffnen“.

type Props = NativeStackScreenProps<MoreStackParamList, "ReferenceSeason">;

export function ReferenceSeasonScreen({ navigation, route }: Props) {
  const lineage = route.params?.lineage || "";
  const season = route.params?.season || "";
  const [page, setPage] = useState<SeasonPage | null>(null);
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  const [loading, setLoading] = useState(Boolean(lineage && season));
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<SeasonTabKey | null>(route.params?.view === "statistik" ? "statistics" : null);

  const load = useCallback(async () => {
    if (!lineage || !season) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get<SeasonPage>(`/reference-series/public/${encodeURIComponent(lineage)}/${encodeURIComponent(season)}`);
      // Ein alter Server schickt hier etwas anderes - dann gilt die Saison als leer, nicht als Fehler.
      setPage(data && typeof data === "object" && !Array.isArray(data) ? data : {});
      setProblem(null);
    } catch (error) {
      setProblem(loadProblem(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [lineage, season]);

  useEffect(() => { void load(); }, [load]);

  const tabs = useMemo(() => seasonTabs(page), [page]);
  const active = tabs.some((item) => item.key === tab) ? (tab as SeasonTabKey) : tabs[0].key;
  const openWeb = () => {
    const path = lineage && season ? seasonWebPath(lineage, season) : "/references";
    Linking.openURL(`${WEB_BASE_URL}${path}`).catch(() => {});
  };
  // Ergebnis einer Runde (#1950): aus dem Kalender, optional mit dem Lauf des Chips.
  const openRound = (round: number, session?: string) => navigation.navigate("ReferenceRound", { lineage, season, round, ...(session ? { session } : {}) });
  // Nachfolger einer abgebrochenen Saison (#1960): eine eigene Seite darüber.
  const openSeason = (target: { lineage: string; season: string }) => navigation.push("ReferenceSeason", target);
  const webButton = <Button label="Im Web öffnen" variant="quiet" icon="open-outline" onPress={openWeb} testID="season-open-web" style={styles.web} />;

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={4} hasImage={false} />
      </Screen>
    );
  }

  if (!page) {
    return (
      <Screen>
        <ErrorState
          title="Saison nicht gefunden"
          detail="Diese Saison gibt es nicht (mehr) oder sie ist nicht öffentlich."
          problem={problem}
          onRetry={lineage && season ? () => { setLoading(true); void load(); } : null}
          testID="season-error"
        />
        {webButton}
      </Screen>
    );
  }

  const figures = seasonFigures(page);
  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.cyan} />}
        testID="season-screen"
      >
        <FadeIn style={styles.head}>
          <Muted style={styles.eyebrow}>{seasonEyebrow(page)}</Muted>
          <Body style={styles.title} accessibilityRole="header">{seasonTitle(page) || "Saison"}</Body>
          {figures.length ? (
            <View style={styles.figures} testID="season-figures">
              {figures.map((figure) => (
                <View key={figure.key} style={styles.figure} accessible accessibilityLabel={`${figure.value} ${figure.label}`}>
                  <Body style={styles.figureValue}>{figure.value}</Body>
                  <Muted style={styles.figureLabel}>{figure.label}</Muted>
                </View>
              ))}
            </View>
          ) : null}
          <SeasonNotice series={page.series} successor={page.successor} onOpenSuccessor={openSeason} style={styles.notice} />
        </FadeIn>

        <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Saisonbereiche">
          {tabs.map((item) => {
            const on = item.key === active;
            return (
              <Pressable
                key={item.key}
                onPress={() => setTab(item.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={item.label}
                style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && styles.pressed]}
              >
                <Body style={[styles.tabText, on && styles.tabTextOn]}>{item.label}</Body>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.body}>
          {active === "calendar" ? <SeasonCalendar page={page} onOpenRound={seasonKind(page) === "racing" ? openRound : undefined} /> : null}
          {active === "table" ? (seasonKind(page) === "team_league" ? <LeagueTable page={page} /> : <SeasonStandings page={page} />) : null}
          {active === "drivers" ? <SeasonDrivers page={page} /> : null}
          {active === "statistics" ? <SeasonStatistics lineage={lineage} season={season} /> : null}
          {active === "matchdays" ? <Matchdays page={page} /> : null}
        </View>
        {webButton}
      </ScrollView>
    </Screen>
  );
}

function Matchdays({ page }: { page: SeasonPage }) {
  const rows = matchdayRows(page);
  if (!rows.length) return <Muted style={styles.empty}>Noch keine Spieltage.</Muted>;
  return (
    <View>
      {rows.map((row) => (
        <View key={row.key} style={styles.round} testID={`season-matchday-${row.key}`}>
          <Body style={styles.code}>{row.code}</Body>
          <View style={styles.roundBody}>
            <Muted style={styles.when}>{row.when}</Muted>
            {row.opponent ? <Body style={styles.venue}>{[row.opponent, row.side].filter(Boolean).join(" · ")}</Body> : null}
            {row.maps.length ? <Muted style={styles.maps}>{row.maps.join(" · ")}</Muted> : null}
          </View>
          {row.score ? (
            <View style={styles.score} accessible accessibilityLabel={`${row.outcome} ${row.score}`}>
              <Muted style={[styles.outcome, row.outcomeKey === "win" && styles.outcomeWin]}>{row.outcome.slice(0, 1)}</Muted>
              <Body style={styles.scoreText}>{row.score}</Body>
            </View>
          ) : <StateChip label={row.state} tone={row.tone} />}
        </View>
      ))}
    </View>
  );
}

function LeagueTable({ page }: { page: SeasonPage }) {
  const rows = leagueTableRows(page);
  if (!rows.length) return <Muted style={styles.empty}>Die Tabelle steht hier nach dem ersten Spieltag.</Muted>;
  return (
    <View style={styles.table}>
      <View style={styles.tableHead}>
        <Muted style={[styles.headText, styles.pos]}>#</Muted>
        <Muted style={[styles.headText, styles.flex]}>Team</Muted>
        <Muted style={[styles.headText, styles.played]}>Sp.</Muted>
        <Muted style={[styles.headText, styles.points]}>Pkt.</Muted>
      </View>
      {rows.map((row) => (
        <View
          key={row.key}
          style={[styles.tableRow, row.own && styles.tableRowClub]}
          accessible
          accessibilityLabel={[`Platz ${row.pos}`, row.name, `${row.played} Spiele`, `${row.points} Punkte`, row.own ? "unser Team" : ""].filter(Boolean).join(", ")}
          testID={`season-league-${row.key}`}
        >
          <Body style={styles.pos}>{row.pos}</Body>
          <Body style={[styles.name, styles.flex, row.own && styles.nameClub]}>{row.name}</Body>
          <Body style={[styles.played, styles.playedText]}>{row.played}</Body>
          <Body style={styles.points}>{row.points}</Body>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  head: { borderBottomColor: ink.line, borderBottomWidth: 1, gap: 10, paddingBottom: 14, paddingHorizontal: 16, paddingTop: 18 },
  eyebrow: { color: colors.cyan, fontSize: 11, fontWeight: "800", letterSpacing: 2.4, textTransform: "uppercase" },
  title: { color: ink.text, fontSize: 24, fontWeight: "900", lineHeight: 27, textTransform: "uppercase" },
  figures: { flexDirection: "row", gap: 8, paddingTop: 4 },
  figure: { flex: 1, minWidth: 0 },
  figureValue: { color: ink.text, fontSize: 24, fontVariant: ["tabular-nums"], fontWeight: "800", lineHeight: 28 },
  figureLabel: { color: ink.muted, fontSize: 12 },
  notice: { marginTop: 4 },
  tabs: { borderBottomColor: ink.line, borderBottomWidth: 1, flexDirection: "row", paddingHorizontal: 8 },
  tab: { alignItems: "center", borderBottomColor: "transparent", borderBottomWidth: 2, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 4 },
  tabOn: { borderBottomColor: colors.cyan },
  tabText: { color: ink.quiet, fontSize: 14, fontWeight: "700" },
  tabTextOn: { color: ink.text },
  body: { paddingBottom: 20, paddingHorizontal: 16, paddingTop: 12 },
  empty: { color: ink.muted, paddingVertical: 14 },
  round: { alignItems: "flex-start", borderBottomColor: ink.rowLine, borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 14 },
  code: { color: ink.muted, fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "800", width: 44 },
  roundBody: { flex: 1, gap: 6, minWidth: 0 },
  roundTop: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  venue: { color: ink.text, flexShrink: 1, fontSize: 15, fontWeight: "700" },
  cancelled: { color: ink.muted, textDecorationLine: "line-through" },
  spacer: { flex: 1 },
  state: { borderRadius: 4, fontSize: 11, fontWeight: "800", letterSpacing: 0.9, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2, textTransform: "uppercase" },
  when: { color: ink.quiet, fontSize: 13 },
  who: { color: ink.second, fontSize: 13 },
  whoName: { color: ink.text, fontSize: 13, fontWeight: "700" },
  tableWrap: { gap: 12 },
  scope: { flexDirection: "row", gap: 6 },
  table: { gap: 2 },
  tableHead: { flexDirection: "row", gap: 10, paddingHorizontal: 8, paddingVertical: 6 },
  headText: { color: ink.quiet, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  tableRow: { alignItems: "center", borderLeftColor: "transparent", borderLeftWidth: 3, borderRadius: 6, flexDirection: "row", gap: 10, paddingHorizontal: 8, paddingVertical: 10 },
  tableRowClub: { backgroundColor: "rgba(41,182,232,0.08)", borderLeftColor: colors.cyan },
  pos: { color: ink.muted, fontSize: 17, fontVariant: ["tabular-nums"], fontWeight: "800", width: 28 },
  flex: { flex: 1, minWidth: 0 },
  name: { color: ink.text, fontSize: 15, fontWeight: "500" },
  nameClub: { fontWeight: "800" },
  nameHidden: { color: ink.muted, fontStyle: "italic" },
  team: { color: ink.quiet, fontSize: 12 },
  points: { color: ink.text, fontSize: 17, fontVariant: ["tabular-nums"], fontWeight: "800", minWidth: 44, textAlign: "right" },
  played: { minWidth: 32, textAlign: "right" },
  playedText: { color: ink.second, fontSize: 15, fontVariant: ["tabular-nums"] },
  more: { alignSelf: "flex-start" },
  cards: { gap: 10, paddingTop: 4 },
  card: { backgroundColor: surfaces.s1, borderColor: ink.cardLine, borderRadius: 12, borderWidth: 1, gap: 6, padding: 14 },
  cardTop: { flexDirection: "row", gap: 8 },
  cardName: { color: ink.text, fontWeight: "700" },
  cardPos: { color: ink.text, fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "800" },
  cardMeta: { color: ink.muted, fontSize: 13 },
  cardStats: { color: ink.second, fontSize: 13 },
  maps: { color: ink.muted, fontSize: 12 },
  score: { alignItems: "center", flexDirection: "row", gap: 6 },
  outcome: { backgroundColor: surfaces.s2, borderRadius: 4, color: ink.muted, fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 1 },
  outcomeWin: { backgroundColor: "rgba(41,182,232,0.16)", color: colors.cyan },
  scoreText: { color: ink.text, fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "800" },
  web: { marginHorizontal: 16, marginTop: 4 },
  pressed: { opacity: 0.72 },
});
