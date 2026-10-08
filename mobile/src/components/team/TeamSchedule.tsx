import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Card } from "../Card";
import { Body, Heading, Muted } from "../Text";
import { outcomeLabel, recentLine, upcomingLine, type TeamOverview, type TeamRecent } from "../../lib/teamPage";
import { colors } from "../../theme";

// Team-Seite (#1191): „Angemeldet für“ und „Letzte Spiele“ wie im Web. Farben nach „Jede Farbe hat eine Aufgabe“:
// Sieg hell mit Cyan, Niederlage grau - Rot heißt nur „läuft gerade“.

export function TeamSchedule({ overview, onOpenTournament, onOpenMatch }: {
  overview: TeamOverview | null;
  onOpenTournament: (idOrSlug: string) => void;
  onOpenMatch: (id: string) => void;
}) {
  const upcoming = overview?.upcoming || [];
  const recent = overview?.recent || [];
  if (!upcoming.length && !recent.length) return null;
  return (
    <>
      {upcoming.length ? (
        <Card style={styles.card} testID="team-upcoming">
          <Heading>Angemeldet für</Heading>
          {upcoming.map((row) => (
            <Pressable
              key={row.registration_id}
              onPress={() => onOpenTournament(String(row.tournament.slug || row.tournament.id || ""))}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              testID={`team-upcoming-${row.registration_id}`}
            >
              <View style={[styles.icon, styles.iconGold]}><Ionicons name="trophy-outline" size={18} color={colors.gold} /></View>
              <View style={styles.main}>
                <Muted style={styles.kicker}>TURNIER</Muted>
                <Body style={styles.title} numberOfLines={1}>{row.tournament.title || "Turnier"}</Body>
                {upcomingLine(row) ? <Muted numberOfLines={1}>{upcomingLine(row)}</Muted> : null}
                <View style={styles.statusPill}><Muted style={styles.statusText}>{String(row.status_label || "Angemeldet").toUpperCase()}</Muted></View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
      ) : null}
      {recent.length ? (
        <Card style={styles.card} testID="team-recent">
          <Heading>Letzte Spiele</Heading>
          {recent.map((row) => (
            <Pressable
              key={row.match_id}
              onPress={() => onOpenMatch(row.match_id)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              testID={`team-recent-${row.match_id}`}
            >
              <View style={[styles.icon, toneStyle(row)]}><Ionicons name="trophy-outline" size={16} color={row.outcome === "win" ? colors.cyan : colors.muted} /></View>
              <View style={styles.main}>
                <Body style={[styles.title, row.outcome === "loss" && styles.dim]} numberOfLines={1}>{recentLine(row)}</Body>
                <Muted numberOfLines={1}>{[row.tournament?.title, row.round_label].filter(Boolean).join(" · ")}</Muted>
              </View>
              <View style={[styles.outcomePill, toneStyle(row)]}>
                <Muted style={[styles.outcomeText, row.outcome === "win" && styles.winText]} testID={`team-recent-outcome-${row.match_id}`}>{outcomeLabel(row).toUpperCase()}</Muted>
              </View>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </>
  );
}

function toneStyle(row: TeamRecent) {
  if (row.outcome === "win") return styles.win;
  if (row.outcome === "loss") return styles.loss;
  return styles.neutral;
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  row: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 12, paddingTop: 10 },
  pressed: { opacity: 0.72 },
  icon: { alignItems: "center", borderRadius: 6, borderWidth: 1, height: 40, justifyContent: "center", width: 40 },
  iconGold: { backgroundColor: "rgba(255,215,0,0.08)", borderColor: "rgba(255,215,0,0.3)" },
  main: { flex: 1, gap: 2 },
  kicker: { color: colors.gold, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  title: { fontWeight: "900" },
  dim: { color: "rgba(255,255,255,0.6)" },
  statusPill: { alignSelf: "flex-start", backgroundColor: "rgba(255,215,0,0.1)", borderColor: "rgba(255,215,0,0.4)", borderRadius: 4, borderWidth: 1, marginTop: 4, paddingHorizontal: 6, paddingVertical: 2 },
  statusText: { color: colors.gold, fontSize: 10, fontWeight: "900" },
  outcomePill: { borderRadius: 4, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  outcomeText: { color: colors.muted, fontSize: 10, fontWeight: "900" },
  winText: { color: "#7FDBFF" },
  win: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.45)" },
  loss: { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border },
  neutral: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.2)" },
});
