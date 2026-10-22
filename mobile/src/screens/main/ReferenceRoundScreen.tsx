import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { FadeIn, staggerDelay } from "../../components/FadeIn";
import { ErrorState, SkeletonList, loadProblem, type LoadProblem } from "../../components/ListState";
import { CountryFlag } from "../../components/references/CountryFlag";
import { ink, medalTone } from "../../components/references/parts";
import { NoScoreNote, SeasonNotice } from "../../components/references/seriesParts";
import { CountUp, Glow } from "../../components/motion";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { api } from "../../lib/api";
import { gridWords } from "../../lib/raceWeekend";
import { COUNT_UP_MS, countDelay, countsUp } from "../../lib/countUp";
import {
  emptyText,
  mobileMain,
  mobileSub,
  neighbourLabel,
  pickSession,
  posLabel,
  medalOf,
  roundEyebrow,
  roundHeading,
  roundSubline,
  roundWebPath,
  rowBadges,
  sessionShows,
  summaryCards,
  type Badge,
  type RoundPage,
  type RoundRow,
  type RoundSession,
  type SummaryCard,
} from "../../lib/referenceRound";
import { nameOf } from "../../lib/seriesFormat";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import type { MoreStackParamList } from "../../navigation/types";
import { colors, roles, surfaces } from "../../theme";

// Ergebnis einer Runde in der App (#1950, #1974) nach der Handy-Ansicht des Webs (/references/series/<spur>/<saison>/
// runde/<nr>, freigegebener Entwurf „RundeHandy“): Kopf mit Flagge, Runde und Tag, Pfeile zur vorigen und nächsten Runde;
// Hinweis bei abgebrochener Saison (#1960); die Zusammenfassung (Sieger, Pole, schnellste Runde, Fahrer des Tages,
// bester Vereinsfahrer) zum Wischen; Reiter je Lauf (Qualifying, Sprint, Rennen), darunter „Ohne Wertung“ und die
// umgekehrte Startaufstellung, und die Ergebnisliste wie beim Veranstalter. Zeiten zählen beim Öffnen und bei jedem
// Reiterwechsel ruhig hoch, je Zeile versetzt; danach leuchten Vereinszeilen einmal auf. Mit „Bewegung reduzieren“
// steht alles sofort da. Fremde Namen nur in der Liste - in der Zusammenfassung das Team (wie im Web).

type Props = NativeStackScreenProps<MoreStackParamList, "ReferenceRound">;

const TONES: Record<string, string> = { winner: roles.honor, pole: roles.pole, fastest_lap: roles.fastest, driver_of_the_day: roles.honor, best_club: colors.cyan };
const BADGE_STYLES: Record<Badge["key"], { fg: string; bg: string; border?: string }> = {
  pole: { fg: "#1A0620", bg: roles.pole },
  fastest_lap: { fg: "#140A24", bg: roles.fastest },
  driver_of_the_day: { fg: "#1A1400", bg: roles.honor },
  dnf: { fg: ink.muted, bg: "transparent", border: "rgba(255,255,255,0.25)" },
  dsq: { fg: ink.muted, bg: "transparent", border: "rgba(255,255,255,0.25)" },
  penalty: { fg: roles.warn, bg: "rgba(255,159,67,0.12)" },
};

export function ReferenceRoundScreen({ navigation, route }: Props) {
  const lineage = route.params?.lineage || "";
  const season = route.params?.season || "";
  const number = Number(route.params?.round) || 0;
  const [page, setPage] = useState<RoundPage | null>(null);
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  const [loading, setLoading] = useState(Boolean(lineage && season && number));
  const [refreshing, setRefreshing] = useState(false);
  const [wanted, setWanted] = useState<string>(route.params?.session || "");

  const load = useCallback(async () => {
    if (!lineage || !season || !number) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get<RoundPage>(`/reference-series/public/${encodeURIComponent(lineage)}/${encodeURIComponent(season)}/rounds/${number}`);
      // Ein älterer Server kennt die Rundenseite nicht (404) - dann zeigt der Screen den Hinweis mit Weg ins Web.
      setPage(data && typeof data === "object" && !Array.isArray(data) ? data : null);
      setProblem(null);
    } catch (error) {
      setProblem(loadProblem(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [lineage, season, number]);

  useEffect(() => { void load(); }, [load]);

  const session = useMemo(() => pickSession(page, wanted), [page, wanted]);
  const cards = useMemo(() => summaryCards(page, session), [page, session]);
  // Neu hochgezählt wird beim Öffnen und bei jedem Reiterwechsel - nicht beim Ziehen zum Aktualisieren.
  const playKey = `${number}:${session?.key || ""}`;
  const openWeb = () => {
    const path = roundWebPath(lineage, season, number, session && session.key !== page?.main ? session.key : "") || "/references";
    Linking.openURL(`${WEB_BASE_URL}${path}`).catch(() => {});
  };
  const goTo = (target: number | null | undefined) => {
    if (target) navigation.replace("ReferenceRound", { lineage, season, round: target });
  };
  const webButton = <Button label="Im Web öffnen" variant="quiet" icon="open-outline" onPress={openWeb} testID="round-open-web" style={styles.web} />;

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={5} hasImage={false} />
      </Screen>
    );
  }

  if (!page) {
    return (
      <Screen>
        <ErrorState
          title="Runde nicht gefunden"
          detail="Diese Runde gibt es nicht (mehr), sie ist nicht öffentlich oder die Website ist noch nicht so weit."
          problem={problem}
          onRetry={lineage && season && number ? () => { setLoading(true); void load(); } : null}
          testID="round-error"
        />
        {webButton}
      </Screen>
    );
  }

  const round = page.round || { number };
  const { heading, sub } = roundHeading(round);
  const sessions = (page.sessions || []).filter((item) => item?.key);
  const ownTeams = (page.own_teams || []).filter(Boolean);
  const hasOwn = (session?.rows || []).some((row) => row.own);
  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.cyan} />}
        testID="round-screen"
      >
        <FadeIn style={styles.head}>
          <View style={styles.headRow} testID="round-head">
            {round.country_code ? <CountryFlag code={round.country_code} height={26} /> : null}
            <View style={styles.flex}>
              {/* Am Handy wie im Web: oben nur „Runde 1 von 24“, Tag und Strecke stehen in der Zeile unter dem Namen. */}
              {round.number ? <Muted style={styles.eyebrow} testID="round-eyebrow">{roundEyebrow({ number: round.number, total: round.total })}</Muted> : null}
              <Body style={styles.title} accessibilityRole="header">{heading}</Body>
              <Muted style={styles.subline} testID="round-subline">{roundSubline(round, sub)}</Muted>
            </View>
            <View style={styles.nav} accessibilityLabel="Runden">
              <NavArrow dir="prev" label={neighbourLabel(page.previous)} onPress={page.previous?.number ? () => goTo(page.previous?.number) : null} />
              <NavArrow dir="next" label={neighbourLabel(page.next)} onPress={page.next?.number ? () => goTo(page.next?.number) : null} />
            </View>
          </View>
        </FadeIn>

        <SeasonNotice series={page.series} style={styles.notice} />

        {cards.length ? (
          <FadeIn delay={staggerDelay(1)}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.facts} accessibilityLabel="Zusammenfassung der Runde" testID="round-summary">
              {cards.map((card) => <FactCard key={card.key} card={card} playKey={playKey} />)}
            </ScrollView>
          </FadeIn>
        ) : null}

        {sessions.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabBar} accessibilityRole="tablist" accessibilityLabel="Läufe dieser Runde" testID="round-tabs">
            {sessions.map((item) => {
              const on = item.key === session?.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setWanted(item.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={[item.label, item.time].filter(Boolean).join(", ")}
                  style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && styles.pressed]}
                  testID={`round-tab-${item.key}`}
                >
                  <Body style={[styles.tabText, on && styles.tabTextOn]}>{item.label}</Body>
                  {item.time ? <Muted style={styles.tabTime}>{item.time}</Muted> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Der Lauf blendet bei jedem Reiterwechsel neu ein - seine Zeiten zählen dann neu hoch. */}
        <FadeIn key={playKey} trigger={playKey} style={styles.body}>
          <SessionPanel session={session} playKey={playKey} />
          {ownTeams.length && hasOwn ? <Muted style={styles.footnote} testID="round-own-teams">{`Vereinsteams hervorgehoben: ${ownTeams.join(", ")}`}</Muted> : null}
        </FadeIn>
        {webButton}
      </ScrollView>
    </Screen>
  );
}

function NavArrow({ dir, label, onPress }: { dir: "prev" | "next"; label: string; onPress: (() => void) | null }) {
  // Am Handy nur Pfeile (44 Punkte); eine fehlende Richtung fällt weg, wie im Web.
  if (!onPress) return <View style={styles.navSpace} />;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${dir === "prev" ? "Vorige" : "Nächste"} Runde: ${label}`}
      hitSlop={4}
      style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
      testID={`round-${dir}`}
    >
      <Ionicons name={dir === "prev" ? "chevron-back" : "chevron-forward"} size={20} color={ink.text} />
    </Pressable>
  );
}

function FactCard({ card, playKey }: { card: SummaryCard; playKey: string }) {
  const color = TONES[card.key] || ink.muted;
  return (
    <View
      style={styles.fact}
      accessible
      accessibilityLabel={[card.label, card.value, card.count, card.sub].filter(Boolean).join(", ")}
      testID={`round-fact-${card.key}`}
    >
      <Muted style={[styles.factLabel, { color }]}>{card.label}</Muted>
      <Body style={[styles.factValue, !card.named && card.color ? { color: card.color } : null]} numberOfLines={2}>{card.value}</Body>
      {card.count || card.sub ? (
        <View style={styles.factSub}>
          {card.count ? <CountUp value={card.count} playKey={playKey} variant="muted" style={styles.factSubText} /> : null}
          {card.sub ? <Muted style={styles.factSubText}>{card.count ? ` · ${card.sub}` : card.sub}</Muted> : null}
        </View>
      ) : null}
    </View>
  );
}

function SessionPanel({ session, playKey }: { session: RoundSession | null; playKey: string }) {
  const grid = gridWords(session?.grid_source, session?.reverse_top);
  const rows = (session?.rows || []).filter((row) => row?.key);
  const shows = sessionShows(session);
  return (
    <View testID="round-panel">
      {session && (grid || session.no_score_reason) ? (
        <View style={styles.rules} testID="round-session-rules">
          <NoScoreNote round={session} />
          {grid ? <Muted style={styles.ruleText} testID="round-session-grid">{grid}</Muted> : null}
        </View>
      ) : null}
      {session?.has_result && rows.length ? (
        <View style={styles.list} testID={`round-results-${session.key}`}>
          {rows.map((row, index) => <ResultRow key={row.key} row={row} index={index} playKey={playKey} shows={shows} />)}
        </View>
      ) : (
        <Muted style={styles.empty} testID="round-empty">{emptyText(session)}</Muted>
      )}
    </View>
  );
}

function ResultRow({ row, index, playKey, shows }: { row: RoundRow; index: number; playKey: string; shows: ReturnType<typeof sessionShows> }) {
  const medal = medalOf(row);
  const tone = medalTone(medal);
  const finished = !row.status || row.status === "finished";
  const badges = rowBadges(row);
  // Ohne Zeiten steht rechts nur „15 P“ (wie im Web).
  const main = shows.times ? mobileMain(row) : shows.points ? mobileSub(row, { points: true }) : "";
  const subText = shows.times ? mobileSub(row, { points: shows.points }) : "";
  const delay = countDelay(index);
  const label = [
    posLabel(row) === "–" ? "ohne Platz" : finished ? `Platz ${posLabel(row)}` : posLabel(row),
    row.start_number ? `Nummer ${row.start_number}` : "",
    nameOf(row),
    row.team || "",
    ...badges.map((badge) => badge.label),
    main,
    subText,
    row.own ? "Verein" : "",
  ].filter(Boolean).join(", ");
  return (
    <View style={[styles.row, row.own && styles.rowOwn, !finished && styles.rowOut]} accessible accessibilityLabel={label} testID={`round-row-${row.key}`}>
      {row.own ? <Glow active delay={delay + COUNT_UP_MS} trigger={playKey} radius={6} /> : null}
      <View style={[styles.pos, tone ? { backgroundColor: tone.ring } : null]}>
        <Body style={[styles.posText, tone ? styles.posTextMedal : null, !finished && styles.posTextOut]}>{posLabel(row)}</Body>
      </View>
      {shows.number ? <Body style={[styles.number, row.team_color ? { color: row.team_color } : null]}>{row.start_number || ""}</Body> : null}
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Body style={[styles.name, row.name_hidden || !row.name ? styles.nameHidden : null, row.own && styles.nameOwn]}>{nameOf(row)}</Body>
          {badges.map((badge) => <RowBadge key={badge.key} badge={badge} glowDelay={delay + COUNT_UP_MS} playKey={playKey} />)}
        </View>
        {row.team ? <Muted style={[styles.team, row.team_color ? { color: row.team_color } : null]}>{row.team}</Muted> : null}
      </View>
      {main ? (
        <View style={styles.right}>
          {shows.times
            ? <CountUp value={main} playKey={playKey} delay={delay} play={countsUp(index)} style={[styles.main, !finished && styles.mainOut]} />
            : <Body style={[styles.main, !finished && styles.mainOut]}>{main}</Body>}
          {subText ? <Muted style={styles.sub}>{subText}</Muted> : null}
        </View>
      ) : null}
    </View>
  );
}

function RowBadge({ badge, glowDelay, playKey }: { badge: Badge; glowDelay: number; playKey: string }) {
  const look = BADGE_STYLES[badge.key];
  // Pole und beste Runde leuchten einmal auf, wenn die Zeit der Zeile steht (wie im Web).
  const glow = badge.key === "pole" || badge.key === "fastest_lap";
  return (
    <View style={[styles.badge, { backgroundColor: look.bg, borderColor: look.border || look.bg }]} testID={`round-badge-${badge.key}`}>
      {glow ? <Glow active delay={glowDelay} color="#FFFFFF" peak={0.45} trigger={playKey} radius={3} /> : null}
      <Muted style={[styles.badgeText, { color: look.fg }]}>{badge.short}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  head: { borderBottomColor: ink.line, borderBottomWidth: 1, paddingBottom: 14, paddingHorizontal: 16, paddingTop: 18 },
  headRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.cyan, fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "800", letterSpacing: 1.6, textTransform: "uppercase" },
  title: { color: ink.text, fontSize: 22, fontWeight: "900", lineHeight: 26, marginTop: 2, textTransform: "uppercase" },
  subline: { color: ink.second, fontSize: 13, fontVariant: ["tabular-nums"], marginTop: 2 },
  nav: { flexDirection: "row", gap: 6 },
  navButton: { alignItems: "center", backgroundColor: surfaces.s2, borderColor: "rgba(255,255,255,0.12)", borderRadius: 8, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  navSpace: { height: 44, width: 0 },
  notice: { marginHorizontal: 16, marginTop: 14 },
  facts: { gap: 10, paddingHorizontal: 16, paddingTop: 16 },
  fact: { backgroundColor: surfaces.s1, borderColor: ink.cardLine, borderRadius: 10, borderWidth: 1, gap: 4, minWidth: 150, paddingHorizontal: 12, paddingVertical: 10 },
  factLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  factValue: { color: ink.text, fontSize: 15, fontWeight: "800", lineHeight: 19, maxWidth: 220 },
  factSub: { alignItems: "center", flexDirection: "row", flexWrap: "wrap" },
  factSubText: { color: ink.second, fontSize: 12, fontVariant: ["tabular-nums"] },
  tabBar: { borderBottomColor: ink.line, borderBottomWidth: 1, marginTop: 14 },
  tabs: { paddingHorizontal: 8 },
  tab: { alignItems: "center", borderBottomColor: "transparent", borderBottomWidth: 3, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
  tabOn: { borderBottomColor: colors.cyan },
  tabText: { color: "rgba(255,255,255,0.58)", fontSize: 14, fontWeight: "700" },
  tabTextOn: { color: ink.text },
  tabTime: { color: ink.quiet, fontSize: 11, fontVariant: ["tabular-nums"] },
  body: { paddingHorizontal: 16, paddingTop: 12 },
  rules: { gap: 4, paddingBottom: 10 },
  ruleText: { color: ink.second, fontSize: 13 },
  list: { gap: 2 },
  empty: { color: ink.muted, paddingVertical: 14 },
  row: { alignItems: "center", borderLeftColor: "transparent", borderLeftWidth: 3, borderRadius: 6, flexDirection: "row", gap: 10, minHeight: 56, paddingHorizontal: 8, paddingVertical: 8 },
  rowOwn: { backgroundColor: "rgba(41,182,232,0.06)", borderLeftColor: colors.cyan },
  rowOut: { opacity: 0.6 },
  pos: { alignItems: "center", borderRadius: 6, height: 30, justifyContent: "center", width: 30 },
  posText: { color: ink.text, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "800" },
  posTextMedal: { color: "#0A0A0A" },
  posTextOut: { color: ink.quiet, fontSize: 11 },
  number: { color: ink.muted, fontSize: 17, fontVariant: ["tabular-nums"], fontWeight: "800", minWidth: 22, textAlign: "center" },
  nameLine: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  name: { color: ink.text, flexShrink: 1, fontSize: 15, fontWeight: "700" },
  nameOwn: { fontWeight: "800" },
  nameHidden: { color: "rgba(255,255,255,0.45)", fontStyle: "italic", fontWeight: "500" },
  team: { color: ink.muted, fontSize: 12, marginTop: 1 },
  badge: { borderRadius: 3, borderWidth: 1, overflow: "hidden", paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  right: { alignItems: "flex-end", minWidth: 72 },
  main: { color: ink.text, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "800", textAlign: "right" },
  mainOut: { color: ink.muted, fontSize: 13 },
  sub: { color: ink.quiet, fontSize: 12, fontVariant: ["tabular-nums"], textAlign: "right" },
  footnote: { color: ink.quiet, fontSize: 12, paddingTop: 12 },
  web: { marginHorizontal: 16, marginTop: 12 },
  pressed: { opacity: 0.72 },
});
