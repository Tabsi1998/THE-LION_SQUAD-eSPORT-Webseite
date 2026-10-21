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
import { LeagueTable, Matchdays, SeasonMaps, Squad } from "../../components/references/season/TeamLeague";
import { TournamentDays } from "../../components/references/season/TournamentDays";
import { MapPoolView } from "../../components/references/MapCards";
import { poolGroups } from "../../lib/teamLeague";
import { SeasonNotice, SeriesPartners } from "../../components/references/seriesParts";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { api } from "../../lib/api";
import {
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
import { colors } from "../../theme";

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
          {/* „Veranstaltet von“ mit Logo (#1934). */}
          <SeriesPartners partners={page.partners} />
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
          {/* Map-Pool der Saison (#1616) - bei der Team-Liga im Reiter „Maps“, sonst unter den Terminen. */}
          {active === "calendar" ? <MapPoolView title="Map-Pool" hint="Die Maps dieser Saison, je Modus." groups={poolGroups(page.map_pool)} testID="season-map-pool" style={styles.pool} /> : null}
          {active === "table" ? (seasonKind(page) === "team_league" ? <LeagueTable page={page} /> : <SeasonStandings page={page} />) : null}
          {active === "drivers" ? <SeasonDrivers page={page} /> : null}
          {active === "statistics" ? <SeasonStatistics lineage={lineage} season={season} /> : null}
          {active === "matchdays" ? <Matchdays page={page} /> : null}
          {active === "squad" ? <Squad page={page} /> : null}
          {active === "maps" ? <SeasonMaps page={page} /> : null}
          {active === "days" ? <TournamentDays page={page} /> : null}
        </View>
        {webButton}
      </ScrollView>
    </Screen>
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
  pool: { marginTop: 20 },
  web: { marginHorizontal: 16, marginTop: 4 },
  pressed: { opacity: 0.72 },
});
