import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { isOverallWinner, pointsWord, standingState, type OverallStandingRow } from "../../lib/leagueOverall";
import { openLink } from "../../lib/openLink";
import { colors, roles } from "../../theme";
import { Card } from "../Card";
import { Glow, Press, StaggerIn, staggerInDelay } from "../motion";
import { Body, Heading, Muted } from "../Text";

// Platz in der Gesamtwertung über Seasons an Team- und Spielerprofil (F.5, #2215; App: #2173, Web: components/tls/league/
// LeagueOverallStanding.jsx): je Zeitraum und Liga N Platz von wie vielen und die Punkte, mit Weg zur Gesamtwertung. Der Server liefert nur,
// was die Person sehen darf - ohne Einträge (oder bei älteren Servern ohne das Feld) steht nichts da. „Gesamtsieger“ nur bei
// abgeschlossener Wertung mit ganzer Sicht (`complete`). Die Zeilen steigen gestaffelt ein, ein Gesamtsieg leuchtet danach einmal in Gold.

export function LeagueOverallStanding({ rows, showTeam = false, testID = "league-overall" }: { rows?: OverallStandingRow[] | null; showTeam?: boolean; testID?: string }) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return null;
  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.titleRow}>
        <Ionicons name="trophy-outline" size={18} color={roles.brand} />
        <Heading accessibilityRole="header">Gesamtwertung</Heading>
      </View>
      <StaggerIn style={styles.list}>
        {list.map((row, index) => {
          const title = [row.league_name, row.period_name].filter(Boolean).join(" · ");
          const winner = isOverallWinner(row);
          const detail = [row.division_label, showTeam ? row.name : "", standingState(row)].filter(Boolean).join(" · ");
          const facts = (
            <View style={styles.facts}>
              {winner ? (
                <View style={styles.inline} testID={`${testID}-winner-${index}`}>
                  <Ionicons name="trophy" size={14} color={roles.honor} />
                  <Text style={styles.winner}>Gesamtsieger</Text>
                </View>
              ) : null}
              <View style={styles.inline}>
                {row.closed ? <Ionicons name="lock-closed" size={12} color={roles.quiet} accessibilityLabel="Abgeschlossen" /> : null}
                <Text style={styles.place}>Platz {row.place} von {row.of}</Text>
              </View>
              <Text style={styles.points}>{pointsWord(row.points)}</Text>
            </View>
          );
          const label = `${title}. ${detail}. Platz ${row.place} von ${row.of}, ${pointsWord(row.points)}${winner ? ", Gesamtsieger" : ""}`;
          const body = (
            <>
              <View style={styles.main}>
                <Body style={[styles.title, row.url ? styles.link : null]} numberOfLines={2}>{title}</Body>
                <Muted style={styles.small} numberOfLines={2} testID={`${testID}-state-${index}`}>{detail}</Muted>
              </View>
              {facts}
            </>
          );
          const delay = staggerInDelay(index);
          return (
            <View key={`${title}-${row.level}-${row.name || ""}-${index}`} style={styles.rowWrap} testID={`${testID}-${row.level ?? index}`}>
              {row.url ? (
                <Press onPress={() => { openLink(row.url); }} style={styles.row} accessibilityRole="link" accessibilityLabel={label} testID={`${testID}-open-${index}`}>
                  {body}
                </Press>
              ) : <View style={styles.row} accessible accessibilityLabel={label}>{body}</View>}
              {winner ? <Glow active tone="honor" delay={(delay ?? 0) + 360} /> : null}
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
  rowWrap: { borderTopColor: colors.border, borderTopWidth: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, minHeight: 48, paddingVertical: 10 },
  main: { flexBasis: 180, flexGrow: 1, minWidth: 0 },
  title: { fontWeight: "800" },
  link: { color: roles.brand },
  small: { fontSize: 12 },
  facts: { alignItems: "flex-end", gap: 2 },
  inline: { alignItems: "center", flexDirection: "row", gap: 4 },
  winner: { color: roles.honor, fontSize: 13, fontWeight: "900" },
  place: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontVariant: ["tabular-nums"] },
  points: { color: roles.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
});
