import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { FadeIn, staggerDelay } from "../../FadeIn";
import { SkeletonList } from "../../ListState";
import { CountUp } from "../../motion";
import { Body, Muted } from "../../Text";
import { FilterChip, ink } from "../parts";
import { api } from "../../../lib/api";
import { METRICS, knownMetrics, leaders, metricText, rankBy, type StatRow, type StatisticsPage } from "../../../lib/referenceRound";
import { countDelay, countsUp } from "../../../lib/countUp";
import { nameOf } from "../../../lib/seriesFormat";
import { colors, surfaces } from "../../../theme";

// Statistik der Saison (#1950, #1974), wie der Reiter „Statistik“ im Web: je Fahrer und Team die Kennzahlen (Siege,
// Podien, Poles, schnellste Runden, Fahrer des Tages, Ausfälle, Ø Start, Ø Ziel, gutgemachte Plätze) - nur die, die
// in der Saison vorkommen. Oben je Kennzahl die ersten drei zum Wischen; Tippen sortiert die Liste darunter nach ihr.
// Vereinsfahrer und -teams hervorgehoben. Fremde Namen nur hier in der Rangliste. Geladen wird erst beim Öffnen.

export function SeasonStatistics({ lineage, season }: { lineage: string; season: string }) {
  const [data, setData] = useState<StatisticsPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [scope, setScope] = useState<"drivers" | "teams">("drivers");
  const [metric, setMetric] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<StatisticsPage>(`/reference-series/public/${encodeURIComponent(lineage)}/${encodeURIComponent(season)}/statistics`)
      .then(({ data: body }) => {
        if (!alive) return;
        setData(body && typeof body === "object" && !Array.isArray(body) ? body : {});
      })
      // Ein älterer Server kennt die Statistik nicht - dann nur der Hinweis.
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [lineage, season]);

  const teamsShown = Boolean((data?.teams || []).length && knownMetrics(data?.metrics?.teams).length);
  const shownScope = teamsShown ? scope : "drivers";
  const rows = useMemo(() => ((shownScope === "teams" ? data?.teams : data?.drivers) || []).filter(Boolean), [data, shownScope]);
  const metrics = knownMetrics(shownScope === "teams" ? data?.metrics?.teams : data?.metrics?.drivers);
  const active = metric && metrics.includes(metric) ? metric : metrics[0] || "";
  const ranked = useMemo(() => (active ? rankBy(rows, active) : []), [rows, active]);

  if (failed) return <Muted style={styles.empty} testID="season-statistics-error">Die Statistik lässt sich gerade nicht laden.</Muted>;
  if (!data) return <SkeletonList count={3} hasImage={false} />;
  if (!rows.length || !metrics.length) {
    return <Muted style={styles.empty} testID="season-statistics-empty">Noch keine Ergebnisse – die Statistik erscheint nach der ersten gewerteten Runde.</Muted>;
  }
  const mine = (row: StatRow) => Boolean(row.club_member || row.own);
  const label = (row: StatRow) => (shownScope === "teams" ? String(row.team || row.key || "") : nameOf(row));
  return (
    <View style={styles.wrap} testID="season-statistics">
      {teamsShown ? (
        <View style={styles.scope} accessibilityLabel="Statistik für">
          <FilterChip label="Fahrer" selected={shownScope === "drivers"} onPress={() => setScope("drivers")} testID="season-statistics-drivers" />
          <FilterChip label="Teams" selected={shownScope === "teams"} onPress={() => setScope("teams")} testID="season-statistics-teams" />
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.leaders} accessibilityLabel="Rangliste je Kennzahl">
        {metrics.map((key, index) => {
          const on = key === active;
          const top = leaders(rows, key);
          return (
            <FadeIn key={`${shownScope}-${key}`} delay={staggerDelay(index)}>
              <Pressable
                onPress={() => setMetric(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={[METRICS[key].title, ...top.map((entry) => `${entry.rank}. ${label(entry.row)} ${metricText(entry.row, key)}`)].join(", ")}
                style={({ pressed }) => [styles.card, on && styles.cardOn, pressed && styles.pressed]}
                testID={`season-statistics-card-${key}`}
              >
                <Muted style={styles.cardTitle}>{METRICS[key].title}</Muted>
                {top.map((entry) => (
                  <View key={String(entry.row.key)} style={styles.leader}>
                    <Muted style={styles.leaderRank}>{String(entry.rank)}</Muted>
                    <Body style={[styles.leaderName, mine(entry.row) && styles.mine]} numberOfLines={1}>{label(entry.row)}</Body>
                    <Body style={styles.leaderValue}>{metricText(entry.row, key)}</Body>
                  </View>
                ))}
              </Pressable>
            </FadeIn>
          );
        })}
      </ScrollView>
      <FadeIn trigger={`${shownScope}-${active}`}>
        <Muted style={styles.caption}>{`Sortiert: ${METRICS[active]?.title || ""}`}</Muted>
        <View style={styles.table} testID="season-statistics-table">
          {ranked.map(({ row, rank }, index) => {
            const others = metrics.filter((key) => key !== active && metricText(row, key) !== "–").map((key) => `${METRICS[key].column} ${metricText(row, key)}`).join(" · ");
            return (
              <View
                key={String(row.key || label(row))}
                style={[styles.row, mine(row) && styles.rowMine]}
                accessible
                accessibilityLabel={[rank ? `Platz ${rank}` : "", label(row), `${METRICS[active].column} ${metricText(row, active)}`, others, mine(row) ? "Verein" : ""].filter(Boolean).join(", ")}
                testID={`season-statistics-row-${row.key}`}
              >
                <Body style={styles.rank}>{rank ? String(rank) : ""}</Body>
                <View style={styles.flex}>
                  <Body style={[styles.name, mine(row) && styles.mine, row.name_hidden && styles.hidden]}>{label(row)}</Body>
                  {others ? <Muted style={styles.others}>{others}</Muted> : null}
                </View>
                {/* Der Wert zählt beim Öffnen und bei jeder neuen Sortierung hoch (#1969). */}
                <CountUp value={metricText(row, active)} playKey={`${shownScope}-${active}`} delay={countDelay(index)} play={countsUp(index)} style={styles.value} />
              </View>
            );
          })}
        </View>
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  empty: { color: ink.muted, paddingVertical: 14 },
  scope: { flexDirection: "row", gap: 6 },
  leaders: { gap: 10, paddingRight: 4 },
  card: { backgroundColor: surfaces.s1, borderColor: ink.cardLine, borderRadius: 10, borderWidth: 1, gap: 4, padding: 12, width: 210 },
  cardOn: { backgroundColor: "rgba(41,182,232,0.08)", borderColor: colors.cyan },
  cardTitle: { color: colors.cyan, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 2, textTransform: "uppercase" },
  leader: { alignItems: "center", flexDirection: "row", gap: 8 },
  leaderRank: { color: ink.quiet, fontSize: 12, fontVariant: ["tabular-nums"], width: 14 },
  leaderName: { color: ink.second, flex: 1, fontSize: 13 },
  leaderValue: { color: ink.text, fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "800" },
  mine: { color: colors.cyan, fontWeight: "700" },
  caption: { color: ink.quiet, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, paddingBottom: 6, textTransform: "uppercase" },
  table: { gap: 2 },
  row: { alignItems: "center", borderLeftColor: "transparent", borderLeftWidth: 3, borderRadius: 6, flexDirection: "row", gap: 10, paddingHorizontal: 8, paddingVertical: 9 },
  rowMine: { backgroundColor: "rgba(41,182,232,0.08)", borderLeftColor: colors.cyan },
  rank: { color: ink.muted, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "800", width: 24 },
  flex: { flex: 1, minWidth: 0 },
  name: { color: ink.text, fontSize: 14, fontWeight: "600" },
  hidden: { color: ink.muted, fontStyle: "italic" },
  others: { color: ink.quiet, fontSize: 12, fontVariant: ["tabular-nums"] },
  value: { color: ink.text, fontSize: 17, fontVariant: ["tabular-nums"], fontWeight: "800", minWidth: 40, textAlign: "right" },
  pressed: { opacity: 0.72 },
});
