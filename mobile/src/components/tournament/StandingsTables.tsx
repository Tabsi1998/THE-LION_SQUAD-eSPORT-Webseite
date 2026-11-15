import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { countDelay, countsUp } from "../../lib/countUp";
import { ZONE_COLORS, ZONE_LABELS, zoneLegend } from "../../lib/leagueTeam";
import type { StandingsTable } from "../../lib/tournamentView";
import { CountUp } from "../motion";
import { colors, radius, roles, surfaces } from "../../theme";

// Gruppen, Liga und Swiss als Tabelle statt Baum-Spalten (#1563): je Gruppe eine Tabelle, Platz, Name, Spiele, Siege,
// Unentschieden, Niederlagen, Differenz (Swiss: Buchholz) und Punkte. „Du“ in Cyan, Ausgeschiedene leise markiert.
// Die Punkte zählen beim Öffnen hoch, je Zeile leicht versetzt (#1969); beim Live-Nachladen leuchtet nur ein neuer
// Stand kurz auf. Liga-Staffeln (#2173, docs/LIGA.md F.1/F.2): Zonen für Auf- und Abstieg als farbige Kante je Zeile mit Legende
// darunter (nur die vorkommenden, Wort statt nur Farbe), über der Tabelle „Endstand · abgeschlossen am …“, sobald sie eingefroren ist.

const COLUMN_HINTS: Record<string, string> = { Sp: "Spiele", S: "Siege", U: "Unentschieden", N: "Niederlagen", Diff: "Differenz", BH: "Buchholz", Pkt: "Punkte" };

export function StandingsTables({ tables, empty, finalNote = "" }: { tables: StandingsTable[]; empty: string; finalNote?: string }) {
  if (!tables.length) return <Text style={styles.empty}>{empty}</Text>;
  return (
    <View style={styles.wrap}>
      {finalNote ? (
        <View style={styles.final} testID="standings-final">
          <Text style={styles.finalText}>{finalNote}</Text>
        </View>
      ) : null}
      {tables.map((table) => (
        <View key={table.key} style={styles.table} testID={`standings-table-${table.key}`}>
          {table.title ? <Text style={styles.title} accessibilityRole="header">{table.title}</Text> : null}
          <View style={[styles.row, styles.headRow]} accessibilityRole="header">
            <Text style={[styles.rank, styles.headText]}>#</Text>
            <Text style={[styles.name, styles.headText]}>Name</Text>
            {table.columns.map((column) => (
              <Text key={column} style={[styles.cell, styles.headText, column === "Pkt" && styles.points]} accessibilityLabel={COLUMN_HINTS[column]}>{column}</Text>
            ))}
          </View>
          {table.rows.map((row, rowIndex) => (
            <View
              key={row.id}
              style={[styles.row, row.mine && styles.mineRow, row.zone ? { borderLeftColor: ZONE_COLORS[row.zone], borderLeftWidth: 3 } : null]}
              testID={`standings-row-${table.title || "all"}-${row.rank}`}
              accessible
              accessibilityLabel={`Platz ${row.rank}: ${row.name}${row.mine ? " (du)" : ""}${row.out ? `, ${row.out}` : ""}${row.zone ? `, ${ZONE_LABELS[row.zone]}` : ""}. ${table.columns.map((column, index) => `${COLUMN_HINTS[column]} ${row.cells[index]}`).join(", ")}`}
            >
              <Text style={[styles.rank, row.rank === 1 && styles.first]} maxFontSizeMultiplier={1.4}>{row.rank}</Text>
              <View style={styles.nameBox}>
                <Text style={[styles.nameText, row.mine && styles.mineText, row.out && styles.out]} numberOfLines={2} maxFontSizeMultiplier={1.4}>{row.name}</Text>
                {row.mine ? <Text style={styles.du}>Du</Text> : null}
                {row.out ? <Text style={styles.outTag}>{row.out}</Text> : null}
              </View>
              {row.cells.map((cell, index) => (table.columns[index] === "Pkt" ? (
                <CountUp key="Pkt" value={cell} delay={countDelay(rowIndex)} play={countsUp(rowIndex)} style={[styles.cell, styles.points]} containerStyle={styles.pointsBox} />
              ) : (
                <Text key={table.columns[index]} style={styles.cell} maxFontSizeMultiplier={1.4}>{cell}</Text>
              )))}
            </View>
          ))}
          {zoneLegend(table.rows).length ? (
            <View style={styles.legend} testID={`standings-zones-${table.key}`}>
              {zoneLegend(table.rows).map((item) => (
                <View key={item.zone} style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: ZONE_COLORS[item.zone] }]} />
                  <Text style={styles.legendText}>{item.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  empty: { color: roles.muted, fontSize: 14 },
  table: { backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  title: { color: colors.white, fontSize: 15, fontWeight: "900", paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6 },
  row: { alignItems: "center", borderTopColor: "rgba(255,255,255,0.06)", borderTopWidth: 1, flexDirection: "row", minHeight: 40, paddingHorizontal: 8, paddingVertical: 4 },
  headRow: { minHeight: 30 },
  headText: { color: roles.quiet, fontSize: 11, fontWeight: "900" },
  rank: { color: roles.muted, fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "900", width: 24 },
  first: { color: roles.honor },
  name: { flex: 1 },
  nameBox: { alignItems: "center", flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6, minWidth: 0 },
  nameText: { color: colors.white, flexShrink: 1, fontSize: 13, fontWeight: "800" },
  mineRow: { backgroundColor: "rgba(41,182,232,0.08)" },
  mineText: { color: roles.brand },
  du: { color: roles.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  out: { color: roles.quiet, textDecorationLine: "line-through" },
  outTag: { color: roles.warn, fontSize: 10, fontWeight: "900" },
  cell: { color: roles.muted, fontSize: 12, fontVariant: ["tabular-nums"], textAlign: "right", width: 30 },
  points: { color: colors.white, fontWeight: "900", width: 34 },
  pointsBox: { width: 34 },
  final: { alignSelf: "flex-start", borderColor: "rgba(255,215,0,0.4)", borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  finalText: { color: roles.honor, fontSize: 12, fontWeight: "900" },
  legend: { borderTopColor: "rgba(255,255,255,0.06)", borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 10, paddingVertical: 8 },
  legendItem: { alignItems: "center", flexDirection: "row", gap: 6 },
  legendSwatch: { borderRadius: 1, height: 10, width: 4 },
  legendText: { color: roles.muted, fontSize: 11 },
});
