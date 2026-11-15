import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { historyMovement, historyPlace, historyWhere, type LeagueHistoryRow } from "../../lib/leagueTeam";
import { openLink } from "../../lib/openLink";
import { colors, roles } from "../../theme";
import { Card } from "../Card";
import { StaggerIn } from "../motion";
import { Body, Heading, Muted } from "../Text";

// Season-Historie an Team- und Spielerprofil (#2173, Web: components/tls/league/LeagueSeasonHistory.jsx, docs/LIGA.md F.2): je
// abgeschlossener Liga-Staffel Season, Liga N, Platz von wie vielen, Meister und Auf- oder Abstieg. Der Server liefert nur, was der
// Endstand festhielt und was die Person sehen darf - ohne Einträge zeigt der Baustein nichts. Die Zeilen bauen sich gestaffelt auf.

export function LeagueSeasonHistory({ rows, showTeam = false, testID = "league-season-history" }: { rows?: LeagueHistoryRow[] | null; showTeam?: boolean; testID?: string }) {
  if (!rows?.length) return null;
  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.titleRow}>
        <Ionicons name="layers-outline" size={18} color={roles.brand} />
        <Heading>Seasons</Heading>
      </View>
      <StaggerIn style={styles.list}>
        {rows.map((row) => {
          const move = historyMovement(row.zone);
          const title = `${row.league_name} · ${row.season_name}`;
          return (
            <View key={`${row.season_id}-${row.staffel}-${row.display_name}`} style={styles.row} testID={`${testID}-${row.season_id}`}>
              <View style={styles.main}>
                {row.url ? (
                  <Pressable onPress={() => { openLink(row.url); }} accessibilityRole="link" hitSlop={6}>
                    <Body style={[styles.title, styles.link]} numberOfLines={2}>{title}</Body>
                  </Pressable>
                ) : <Body style={styles.title} numberOfLines={2}>{title}</Body>}
                <Muted style={styles.small} numberOfLines={2}>{historyWhere(row, showTeam)}</Muted>
              </View>
              <View style={styles.facts}>
                {row.champion ? (
                  <View style={styles.inline} testID={`${testID}-champion-${row.season_id}`}>
                    <Ionicons name="trophy" size={14} color={roles.honor} />
                    <Text style={styles.champion}>Meister</Text>
                  </View>
                ) : null}
                <Text style={styles.place}>{historyPlace(row)}</Text>
                {move ? (
                  <View style={styles.inline}>
                    {move.direction ? <Ionicons name={move.direction === "up" ? "arrow-up" : "arrow-down"} size={13} color={move.direction === "up" ? roles.ok : roles.warn} /> : null}
                    <Text style={[styles.move, move.direction === "up" && { color: roles.ok }, move.direction === "down" && { color: roles.warn }]}>{move.label}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </StaggerIn>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  list: { gap: 0 },
  row: { borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 10 },
  main: { flexBasis: 180, flexGrow: 1, minWidth: 0 },
  title: { fontWeight: "800" },
  link: { color: roles.brand },
  small: { fontSize: 12 },
  facts: { alignItems: "flex-end", gap: 2 },
  inline: { alignItems: "center", flexDirection: "row", gap: 4 },
  champion: { color: roles.honor, fontSize: 13, fontWeight: "900" },
  place: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontVariant: ["tabular-nums"] },
  move: { color: roles.muted, fontSize: 12 },
});
