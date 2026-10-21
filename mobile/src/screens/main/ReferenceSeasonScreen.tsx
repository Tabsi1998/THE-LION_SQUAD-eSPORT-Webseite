import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { FadeIn } from "../../components/FadeIn";
import { ErrorState, SkeletonList, loadProblem, type LoadProblem } from "../../components/ListState";
import { CountryFlag } from "../../components/references/CountryFlag";
import { FilterChip, ink } from "../../components/references/parts";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { api } from "../../lib/api";
import {
  driverCards,
  leagueTableRows,
  matchdayRows,
  mobileRows,
  racingTableRows,
  roundRows,
  seasonEyebrow,
  seasonFigures,
  seasonKind,
  seasonTabs,
  seasonTitle,
  seasonWebPath,
  type SeasonPage,
  type SeasonTabKey,
  type StateTone,
} from "../../lib/referenceSeason";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import type { MoreStackParamList } from "../../navigation/types";
import { colors, roles, surfaces } from "../../theme";

// Saison einer Serie (#1945) nach dem freigegebenen Entwurf „AppSaison“ (21.10.2026), nur lesen: Kopf mit Art, Titel und
// Kennzahlen (ohne Nullen), dann je Art eigene Reiter - Rennliga: Kalender, Tabelle (Fahrer/Teams), Fahrer (Vereins-
// Garage); Team-Liga: Spieltage und Tabelle; Turnierserie: Termine und Tabelle. Die Daten kommen aus dem öffentlichen
// Endpunkt der Serienseite des Webs, die Logik steht in lib/referenceSeason.ts. Was die App (noch) nicht zeigt -
// Rennraster, Regeln, Finale, Aufstellung, Platzierungsverlauf -, öffnet „Im Web öffnen“. Das Land eines Termins steht
// als Flagge da (#1925, Datei von der Website). „Veranstaltet von Partner“ (#1934) und die Lauf-Chips (#1930) kommen
// mit ihren Issues.

type Props = NativeStackScreenProps<MoreStackParamList, "ReferenceSeason">;

const STATE_STYLES: Record<StateTone, { fg: string; bg: string }> = {
  done: { fg: roles.ok, bg: "rgba(31,208,142,0.12)" },
  today: { fg: "#06121A", bg: roles.honor },
  missing: { fg: roles.warn, bg: "rgba(255,159,67,0.12)" },
  cancelled: { fg: roles.warn, bg: "rgba(255,159,67,0.12)" },
  postponed: { fg: roles.event, bg: "rgba(159,122,234,0.12)" },
  planned: { fg: ink.muted, bg: surfaces.s2 },
};

export function ReferenceSeasonScreen({ route }: Props) {
  const lineage = route.params?.lineage || "";
  const season = route.params?.season || "";
  const [page, setPage] = useState<SeasonPage | null>(null);
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  const [loading, setLoading] = useState(Boolean(lineage && season));
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<SeasonTabKey | null>(null);

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
          {active === "calendar" ? <Calendar page={page} /> : null}
          {active === "table" ? (seasonKind(page) === "team_league" ? <LeagueTable page={page} /> : <StandingsTable page={page} />) : null}
          {active === "drivers" ? <Drivers page={page} /> : null}
          {active === "matchdays" ? <Matchdays page={page} /> : null}
        </View>
        {webButton}
      </ScrollView>
    </Screen>
  );
}

function StateChip({ label, tone }: { label: string; tone: StateTone }) {
  if (!label) return null;
  const look = STATE_STYLES[tone];
  return <Muted style={[styles.state, { color: look.fg, backgroundColor: look.bg }]}>{label}</Muted>;
}

function Calendar({ page }: { page: SeasonPage }) {
  const rows = roundRows(page);
  if (!rows.length) return <Muted style={styles.empty}>Noch keine Termine.</Muted>;
  return (
    <View>
      {rows.map((row) => (
        <View key={row.key} style={styles.round} testID={`season-round-${row.key}`}>
          <Body style={[styles.code, row.final && { color: roles.honor }]}>{row.code}</Body>
          <View style={styles.roundBody}>
            <View style={styles.roundTop}>
              {row.country ? (
                <View testID="season-round-country">
                  <CountryFlag code={row.country} height={15} />
                </View>
              ) : null}
              <Body style={[styles.venue, row.tone === "cancelled" && styles.cancelled]}>{row.place || row.code}</Body>
              <View style={styles.spacer} />
              <StateChip label={row.state} tone={row.tone} />
            </View>
            <Muted style={styles.when}>{row.when}</Muted>
            {row.winner ? <Muted style={styles.who}>Sieg: <Body style={styles.whoName}>{row.winner}</Body></Muted> : null}
            {row.best ? <Muted style={styles.who}>{`Bester Vereinsfahrer: ${row.best}`}</Muted> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function TableRows({ rows, idPrefix }: { rows: Array<{ key: string; pos: string; name: string; team: string; points: string; club: boolean; hidden?: boolean }>; idPrefix: string }) {
  return (
    <View style={styles.table}>
      {rows.map((row) => (
        <View
          key={row.key}
          style={[styles.tableRow, row.club && styles.tableRowClub]}
          accessible
          accessibilityLabel={[`Platz ${row.pos}`, row.name, row.team, `${row.points} Punkte`, row.club ? "Verein" : ""].filter(Boolean).join(", ")}
          testID={`${idPrefix}-${row.key}`}
        >
          <Body style={styles.pos}>{row.pos}</Body>
          <View style={styles.flex}>
            <Body style={[styles.name, row.club && styles.nameClub, row.hidden && styles.nameHidden]}>{row.name}</Body>
            {row.team ? <Muted style={styles.team}>{row.team}</Muted> : null}
          </View>
          <Body style={styles.points}>{row.points}</Body>
        </View>
      ))}
    </View>
  );
}

function StandingsTable({ page }: { page: SeasonPage }) {
  const [scope, setScope] = useState<"drivers" | "teams">("drivers");
  const [expanded, setExpanded] = useState(false);
  const hasTeams = racingTableRows(page, "teams").length > 0;
  const all = racingTableRows(page, hasTeams ? scope : "drivers");
  const shown = mobileRows(all, { expanded });
  if (!all.length) return <Muted style={styles.empty}>Die Tabelle steht hier nach der ersten gewerteten Runde.</Muted>;
  return (
    <View style={styles.tableWrap}>
      {hasTeams ? (
        <View style={styles.scope}>
          <FilterChip label={seasonKind(page) === "racing" ? "Fahrer" : "Gesamt"} selected={scope === "drivers"} onPress={() => setScope("drivers")} testID="season-table-scope-drivers" />
          <FilterChip label="Teams" selected={scope === "teams"} onPress={() => setScope("teams")} testID="season-table-scope-teams" />
        </View>
      ) : null}
      <TableRows rows={shown} idPrefix="season-table" />
      {shown.length < all.length ? (
        <Button label={`Ganze Tabelle zeigen (${all.length})`} variant="quiet" compact onPress={() => setExpanded(true)} testID="season-table-all" style={styles.more} />
      ) : null}
    </View>
  );
}

function Drivers({ page }: { page: SeasonPage }) {
  const cards = driverCards(page);
  if (!cards.length) return <Muted style={styles.empty}>Hier stehen die Vereinsfahrer, sobald sie in der Wertung sind.</Muted>;
  return (
    <View style={styles.cards}>
      {cards.map((card) => (
        <View key={card.key} style={styles.card} testID={`season-driver-${card.key}`}>
          <View style={styles.cardTop}>
            <Body style={[styles.cardName, styles.flex]}>{card.name}</Body>
            {card.pos ? <Body style={styles.cardPos}>{card.pos}</Body> : null}
          </View>
          <Muted style={styles.cardMeta}>{card.meta}</Muted>
          {card.stats ? <Muted style={styles.cardStats}>{card.stats}</Muted> : null}
        </View>
      ))}
    </View>
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
