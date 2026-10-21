import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { api } from "../../lib/api";
import {
  clubChronicle,
  gameKey,
  gameOptions,
  honorStats,
  linkedSeasons,
  pathSteps,
  leaguePath,
  pickShowcase,
  podiumItems,
  runningView,
  showcaseView,
  type ClubReference,
  type LineageItem,
  type ReferenceSummaryData,
  type RunningItem,
  type SeasonTarget,
  type Showcase,
} from "../../lib/references";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import { colors, roles, surfaces } from "../../theme";
import { FadeIn, staggerDelay } from "../FadeIn";
import { Button } from "../Button";
import { EmptyState } from "../ListState";
import { CountryFlag } from "./CountryFlag";
import { Body, Muted } from "../Text";
import { FilterChip, MedalMark, PathStrip, PlaceRing, ProgressFill, SectionLabel, ink, medalTone } from "./parts";

// Verein › Erfolge (#1945) nach dem freigegebenen Entwurf „AppErfolge“ (21.10.2026) - ein Ausschnitt der Übersicht im Web
// (#1878): Ehrentafel (nur Werte über null), „Läuft gerade“, Vitrine (Hauptkarte nach derselben Regel wie im Web,
// `showcase` aus /references), Serien und Ligen mit Liga-Weg und die Chronik mit Spiel-Filter. Die Referenzen lädt der
// Bereich „Verein“; laufende Saisons und Spuren lädt dieser Teil selbst - ein Fehler blendet nur seinen Abschnitt aus.
// Eine Saison öffnet in der App, eine Referenz ohne Saison im Web.

const MEDALS: Array<[1 | 2 | 3, "gold" | "silver" | "bronze", string]> = [[1, "gold", "Siege"], [2, "silver", "Zweite"], [3, "bronze", "Dritte"]];

// Die Chronik zeigt erst so viele Zeilen und holt mit „Mehr anzeigen“ je so viele dazu: /references liefert bis zu
// 1000 Teilnahmen, und die Zeilen stehen in der Seite (keine eigene, verschachtelte Liste).
export const CHRONICLE_PAGE = 20;

/** Laufende Saisons und Serien & Ligen: eigene Endpunkte; ein alter Server ohne sie zeigt die Abschnitte nicht. */
function useSeriesOverview() {
  const [running, setRunning] = useState<RunningItem[]>([]);
  const [lineages, setLineages] = useState<LineageItem[]>([]);
  useEffect(() => {
    let alive = true;
    api.get<{ items?: RunningItem[] }>("/reference-series/public/running")
      .then(({ data }) => { if (alive) setRunning(Array.isArray(data?.items) ? data.items.filter((item) => item?.lineage && item?.series) : []); })
      .catch(() => { if (alive) setRunning([]); });
    api.get<{ items?: LineageItem[] }>("/reference-series/public/lineages")
      .then(({ data }) => { if (alive) setLineages(Array.isArray(data?.items) ? data.items.filter((item) => item?.lineage?.slug && item?.seasons?.length) : []); })
      .catch(() => { if (alive) setLineages([]); });
    return () => { alive = false; };
  }, []);
  return { running, lineages };
}

function openReferenceInWeb(id: string) {
  Linking.openURL(`${WEB_BASE_URL}/references/${encodeURIComponent(id)}`).catch(() => {});
}

export function ClubSuccess({ items, summary, showcase, onOpenSeason }: {
  items: ClubReference[];
  summary: ReferenceSummaryData;
  showcase: Showcase;
  onOpenSeason: (target: SeasonTarget) => void;
}) {
  const { running, lineages } = useSeriesOverview();
  const linked = useMemo(() => linkedSeasons(lineages), [lineages]);
  const stats = useMemo(() => honorStats({ summary, items, lineages }), [summary, items, lineages]);
  const podium = useMemo(() => podiumItems(items), [items]);
  const main = useMemo(() => pickShowcase(podium.length ? podium : items, showcase, linked), [podium, items, showcase, linked]);
  const [game, setGame] = useState("all");
  const [limit, setLimit] = useState(CHRONICLE_PAGE);
  const games = useMemo(() => gameOptions(items), [items]);
  const rows = useMemo(() => clubChronicle(game === "all" ? items : items.filter((item) => gameKey(item) === game), linked), [items, game, linked]);
  const pickGame = (key: string) => {
    setGame(key);
    setLimit(CHRONICLE_PAGE);
  };

  if (!items.length && !running.length && !lineages.length) {
    return <EmptyState icon="medal-outline" title="Noch keine Referenzen" detail="Externe Turniere und Ligen, bei denen der Verein angetreten ist, erscheinen hier." />;
  }

  const medals = MEDALS.filter(([, key]) => stats[key] > 0);
  const facts = [
    stats.total ? `${stats.total} ${stats.total === 1 ? "Teilnahme" : "Teilnahmen"}` : "",
    stats.games ? `${stats.games} ${stats.games === 1 ? "Spiel" : "Spiele"}` : "",
    stats.since ? `seit ${stats.since}` : "",
  ].filter(Boolean).join(" · ");
  let section = 0;
  const next = () => staggerDelay(section++);

  return (
    <View style={styles.wrap} testID="club-success">
      <FadeIn delay={next()} style={styles.head}>
        <View style={styles.titleBlock}>
          <Muted style={styles.eyebrow}>Erfolgswand</Muted>
          <Body style={styles.title} accessibilityRole="header">Erfolge & Referenzen</Body>
        </View>
        {medals.length ? (
          <View style={styles.honor} testID="club-success-honor">
            {medals.map(([place, key, label], index) => (
              <View key={key} style={[styles.medal, index > 0 && styles.medalDivider]} accessible accessibilityLabel={`${stats[key]} ${label}`}>
                <MedalMark placement={place} />
                <Body style={[styles.medalCount, { color: medalTone(place)?.fg }]}>{String(stats[key])}</Body>
                <Muted style={styles.medalLabel}>{label}</Muted>
              </View>
            ))}
          </View>
        ) : null}
        {facts ? <Muted style={styles.facts}>{facts}</Muted> : null}
      </FadeIn>

      {running.length ? (
        <FadeIn delay={next()} style={styles.section}>
          <View testID="club-success-running" style={styles.section}>
            <SectionLabel pulse={running.some((item) => item.today)}>Läuft gerade</SectionLabel>
            {running.map((item) => <RunningCard key={runningView(item).key} item={item} onOpen={onOpenSeason} />)}
          </View>
        </FadeIn>
      ) : null}

      {main ? (
        <FadeIn delay={next()} style={styles.section}>
          <SectionLabel>Vitrine</SectionLabel>
          <ShowcaseCard item={main} link={linked.get(main.id)} onOpenSeason={onOpenSeason} />
        </FadeIn>
      ) : null}

      {lineages.length ? (
        <FadeIn delay={next()} style={styles.section}>
          <View testID="club-success-series" style={styles.section}>
            <SectionLabel>Serien & Ligen</SectionLabel>
            {lineages.map((item) => <LineageCard key={item.lineage.slug} item={item} onOpen={onOpenSeason} />)}
          </View>
        </FadeIn>
      ) : null}

      {items.length ? (
        <FadeIn delay={next()} style={styles.section}>
          <View testID="club-success-chronicle" style={styles.section}>
            <SectionLabel>Chronik</SectionLabel>
            {games.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Spiel">
                <FilterChip label="Alle" selected={game === "all"} onPress={() => pickGame("all")} testID="club-success-game-all" />
                {games.map((option) => (
                  <FilterChip key={option.key} label={option.title} selected={game === option.key} onPress={() => pickGame(option.key)} testID={`club-success-game-${option.key}`} />
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.list}>
              {rows.slice(0, limit).map((row) => (
                <Pressable
                  key={row.id}
                  onPress={() => (row.season ? onOpenSeason(row.season) : openReferenceInWeb(row.id))}
                  accessibilityRole={row.season ? "button" : "link"}
                  accessibilityLabel={[row.placement ? `${row.placement}. Platz` : "", row.title, row.sub, row.season ? "Saison ansehen" : "im Web öffnen"].filter(Boolean).join(", ")}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  testID={`club-success-row-${row.id}`}
                >
                  <PlaceRing placement={row.placement} />
                  <View style={styles.rowText}>
                    <Body style={styles.rowTitle}>{row.title}</Body>
                    {row.sub ? <Muted style={styles.rowSub}>{row.sub}</Muted> : null}
                  </View>
                  <Ionicons name={row.season ? "chevron-forward" : "open-outline"} color={colors.cyan} size={16} />
                </Pressable>
              ))}
            </View>
            {rows.length > limit ? (
              <Button
                label={`Mehr anzeigen (${rows.length - limit} weitere)`}
                variant="quiet"
                compact
                onPress={() => setLimit((value) => value + CHRONICLE_PAGE)}
                style={styles.more}
                testID="club-success-more"
              />
            ) : null}
          </View>
        </FadeIn>
      ) : null}
    </View>
  );
}

function RunningCard({ item, onOpen }: { item: RunningItem; onOpen: (target: SeasonTarget) => void }) {
  const view = runningView(item);
  const target = view.season;
  return (
    <Pressable
      onPress={target ? () => onOpen(target) : undefined}
      disabled={!target}
      accessibilityRole="button"
      accessibilityLabel={[view.kind, view.title, view.today ? "heute" : "", view.next, view.progress?.text, view.place].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.card, view.today && styles.cardToday, pressed && styles.pressed]}
      testID={`running-card-${view.key}`}
    >
      <View style={styles.cardTop}>
        <View style={styles.flex}>
          <Muted style={styles.kind}>{view.kind}</Muted>
          <Body style={styles.cardTitle}>{view.title}</Body>
        </View>
        {view.today ? (
          <View style={styles.todayChip}>
            <Muted style={styles.todayText}>Heute</Muted>
          </View>
        ) : null}
      </View>
      {view.next || view.progress ? (
        <View style={styles.nextRow}>
          <View style={[styles.nextText, styles.flex]}>
            {view.country ? <CountryFlag code={view.country} height={12} /> : null}
            <Muted style={[styles.next, styles.flex]}>{view.next}</Muted>
          </View>
          {view.progress ? <Muted style={styles.progress}>{`${view.progress.scored} / ${view.progress.total}`}</Muted> : null}
        </View>
      ) : null}
      {view.progress ? <ProgressFill share={view.progress.share} label={view.progress.text} /> : null}
      <Muted style={styles.place}>{view.place}</Muted>
    </Pressable>
  );
}

function ShowcaseCard({ item, link, onOpenSeason }: { item: ClubReference; link: Parameters<typeof showcaseView>[1]; onOpenSeason: (target: SeasonTarget) => void }) {
  const view = showcaseView(item, link);
  const tone = medalTone(view.placement);
  const season = view.season;
  return (
    <Pressable
      onPress={() => (season ? onOpenSeason(season) : openReferenceInWeb(item.id))}
      accessibilityRole={season ? "button" : "link"}
      accessibilityLabel={[view.eyebrow, view.title, view.detail, season ? "Saison ansehen" : "im Web öffnen"].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.card, styles.showcase, tone ? { borderColor: `${tone.ring}59` } : null, pressed && styles.pressed]}
      testID="club-success-showcase"
    >
      <View style={styles.showcaseTop}>
        <PlaceRing placement={view.placement} size={56} />
        <View style={styles.flex}>
          {view.eyebrow ? <Muted style={[styles.showcaseEyebrow, tone ? { color: tone.fg } : null]}>{view.eyebrow}</Muted> : null}
          <Body style={styles.showcaseTitle}>{view.title}</Body>
        </View>
      </View>
      {view.detail ? <Muted style={styles.showcaseDetail}>{view.detail}</Muted> : null}
    </Pressable>
  );
}

function LineageCard({ item, onOpen }: { item: LineageItem; onOpen: (target: SeasonTarget) => void }) {
  const path = leaguePath(item.seasons, item.lineage.tier_order);
  const tiles = pathSteps(item.seasons, item.lineage.tier_order, undefined, item.lineage.kind);
  const target = item.lineage.slug && path.target?.season_slug ? { lineage: item.lineage.slug, season: path.target.season_slug } : null;
  return (
    <Pressable
      onPress={target ? () => onOpen(target) : undefined}
      disabled={!target}
      accessibilityRole="button"
      accessibilityLabel={[item.lineage.title, path.summary, "Saison ansehen"].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      testID={`club-success-lineage-${item.lineage.slug}`}
    >
      <View style={styles.lineageTop}>
        <Body style={[styles.lineageTitle, styles.flex]}>{item.lineage.title}</Body>
        <Muted style={styles.lineageCount}>{path.summary}</Muted>
      </View>
      <PathStrip tiles={tiles} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 22 },
  head: { gap: 14 },
  titleBlock: { gap: 6 },
  eyebrow: { color: roles.honor, fontSize: 11, fontWeight: "800", letterSpacing: 2.6, textTransform: "uppercase" },
  title: { color: ink.text, fontSize: 28, fontWeight: "900", lineHeight: 30, textTransform: "uppercase" },
  honor: { backgroundColor: surfaces.s1, borderColor: ink.cardLine, borderRadius: 12, borderWidth: 1, flexDirection: "row", paddingVertical: 16 },
  medal: { flex: 1, gap: 4, paddingHorizontal: 12 },
  medalDivider: { borderLeftColor: ink.line, borderLeftWidth: 1 },
  medalCount: { fontSize: 38, fontVariant: ["tabular-nums"], fontWeight: "800", lineHeight: 42 },
  medalLabel: { color: ink.second, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  facts: { color: ink.quiet, fontSize: 13 },
  section: { gap: 10 },
  card: { backgroundColor: surfaces.s1, borderColor: ink.cardLine, borderRadius: 12, borderWidth: 1, gap: 10, padding: 14 },
  cardToday: { borderColor: "rgba(255,215,0,0.4)" },
  cardTop: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  kind: { color: ink.muted, fontSize: 12 },
  cardTitle: { color: ink.text, fontSize: 16, fontWeight: "700", lineHeight: 20 },
  todayChip: { alignItems: "center", backgroundColor: roles.honor, borderRadius: 4, flexDirection: "row", gap: 6, paddingHorizontal: 8, paddingVertical: 3 },
  todayText: { color: "#06121A", fontSize: 11, fontWeight: "800", letterSpacing: 1.1, textTransform: "uppercase" },
  nextRow: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  nextText: { alignItems: "center", flexDirection: "row", gap: 6 },
  next: { color: ink.second, fontSize: 13 },
  progress: { color: ink.second, fontSize: 13, fontVariant: ["tabular-nums"] },
  place: { color: ink.soft, fontSize: 13 },
  showcase: { gap: 12, padding: 18 },
  showcaseTop: { alignItems: "center", flexDirection: "row", gap: 14 },
  showcaseEyebrow: { color: roles.honor, fontSize: 12, fontWeight: "800", letterSpacing: 1.6, textTransform: "uppercase" },
  showcaseTitle: { color: ink.text, fontSize: 17, fontWeight: "900", lineHeight: 21, textTransform: "uppercase" },
  showcaseDetail: { color: ink.second, fontSize: 13 },
  lineageTop: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  lineageTitle: { color: ink.text, fontWeight: "700" },
  lineageCount: { color: ink.quiet, fontSize: 13 },
  chips: { gap: 6, paddingBottom: 2, paddingRight: 4 },
  list: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1 },
  row: { alignItems: "center", borderBottomColor: ink.rowLine, borderBottomWidth: 1, flexDirection: "row", gap: 12, minHeight: 64, paddingHorizontal: 2, paddingVertical: 12 },
  rowText: { flex: 1, gap: 1, minWidth: 0 },
  rowTitle: { color: ink.text, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  rowSub: { color: ink.muted, fontSize: 13 },
  more: { alignSelf: "flex-start", marginTop: 4 },
  pressed: { opacity: 0.72 },
});
