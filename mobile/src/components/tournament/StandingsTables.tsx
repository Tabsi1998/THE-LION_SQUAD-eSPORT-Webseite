import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StandingsTable } from "../../lib/tournamentView";
import { colors, radius, roles, surfaces } from "../../theme";

// Gruppen, Liga und Swiss als Tabelle statt Baum-Spalten (#1563): je Gruppe eine Tabelle, Platz, Name, Spiele, Siege,
// Unentschieden, Niederlagen, Differenz (Swiss: Buchholz) und Punkte. „Du“ in Cyan, Ausgeschiedene leise markiert.

const COLUMN_HINTS: Record<string, string> = { Sp: "Spiele", S: "Siege", U: "Unentschieden", N: "Niederlagen", Diff: "Differenz", BH: "Buchholz", Pkt: "Punkte" };

export function StandingsTables({ tables, empty }: { tables: StandingsTable[]; empty: string }) {
  if (!tables.length) return <Text style={styles.empty}>{empty}</Text>;
  return (
    <View style={styles.wrap}>
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
          {table.rows.map((row) => (
            <View
              key={row.id}
              style={[styles.row, row.mine && styles.mineRow]}
              testID={`standings-row-${table.title || "all"}-${row.rank}`}
              accessible
              accessibilityLabel={`Platz ${row.rank}: ${row.name}${row.mine ? " (du)" : ""}${row.out ? `, ${row.out}` : ""}. ${table.columns.map((column, index) => `${COLUMN_HINTS[column]} ${row.cells[index]}`).join(", ")}`}
            >
              <Text style={[styles.rank, row.rank === 1 && styles.first]} maxFontSizeMultiplier={1.4}>{row.rank}</Text>
              <View style={styles.nameBox}>
                <Text style={[styles.nameText, row.mine && styles.mineText, row.out && styles.out]} numberOfLines={2} maxFontSizeMultiplier={1.4}>{row.name}</Text>
                {row.mine ? <Text style={styles.du}>Du</Text> : null}
                {row.out ? <Text style={styles.outTag}>{row.out}</Text> : null}
              </View>
              {row.cells.map((cell, index) => (
                <Text key={table.columns[index]} style={[styles.cell, table.columns[index] === "Pkt" && styles.points]} maxFontSizeMultiplier={1.4}>{cell}</Text>
              ))}
            </View>
          ))}
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
});
