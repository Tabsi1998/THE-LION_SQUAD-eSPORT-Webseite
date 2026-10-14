import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import type { BracketMatch } from "../../../lib/bracketGraph";
import { colors, radius, roles, surfaces } from "../../../theme";
import { LiveClock } from "./LiveClock";
import { breatheStyle } from "./motion";

/** Wer spielt gerade (#1563): die laufenden Spiele oben angepinnt - Station, Runde, Namen, Spielzeit. */
export function playersText(match: BracketMatch, nameOf: (id: string) => string) {
  const names = (match.slots || []).map((slot) => (slot.registration_id ? nameOf(slot.registration_id) : "")).filter(Boolean);
  if (match.match_type !== "ffa" && names.length === 2) return `${names[0]} gegen ${names[1]}`;
  if (names.length <= 3) return names.join(", ") || "noch offen";
  return `${names.length} Spieler`;
}

export function LiveNow({ matches, labels, nameOf, reduce, onOpen }: {
  matches: BracketMatch[];
  labels: Map<string, string>;
  nameOf: (id: string) => string;
  reduce: boolean;
  onOpen: (matchId: string) => void;
}) {
  const sorted = [...matches].sort((a, b) => String(a.station_text || "~").localeCompare(String(b.station_text || "~"), "de", { numeric: true }));
  return (
    <View style={styles.box} testID="bracket-live-now">
      <View style={styles.head}>
        <Animated.View style={[styles.dot, breatheStyle(reduce)]} />
        <Text style={styles.title} accessibilityRole="header">Läuft gerade</Text>
      </View>
      {sorted.map((match) => (
        <Pressable key={match.id} onPress={() => onOpen(match.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${match.station_text || "Spiel"}: ${playersText(match, nameOf)} öffnen`}>
          <View style={styles.station}>
            <Text style={styles.stationText} numberOfLines={2} maxFontSizeMultiplier={1.4}>{match.station_text || match.match_key || "Spiel"}</Text>
          </View>
          <View style={styles.main}>
            <Text style={styles.names} numberOfLines={2} maxFontSizeMultiplier={1.4}>{playersText(match, nameOf)}</Text>
            <Text style={styles.round} numberOfLines={1} maxFontSizeMultiplier={1.4}>{labels.get(match.id) || ""}{match.match_type === "ffa" ? ` · Lauf ${match.match_key || ""}` : ""}</Text>
          </View>
          <LiveClock startedAt={match.started_at} style={styles.clock} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: surfaces.s1, borderColor: "rgba(255,59,48,0.35)", borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  head: { alignItems: "center", flexDirection: "row", gap: 7, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  dot: { backgroundColor: roles.live, borderRadius: 4, height: 8, width: 8 },
  title: { color: roles.live, fontSize: 12, fontWeight: "900", letterSpacing: 0.6 },
  row: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 48, paddingHorizontal: 12, paddingVertical: 6 },
  pressed: { backgroundColor: "rgba(255,255,255,0.05)" },
  station: { alignItems: "center", borderColor: "rgba(255,59,48,0.45)", borderRadius: radius.lg, borderWidth: 1, justifyContent: "center", minHeight: 36, paddingHorizontal: 4, width: 64 },
  stationText: { color: colors.white, fontSize: 11, fontWeight: "900", textAlign: "center" },
  main: { flex: 1, gap: 1, minWidth: 0 },
  names: { color: colors.white, fontSize: 13, fontWeight: "800" },
  round: { color: roles.muted, fontSize: 11 },
  clock: { color: roles.live, fontSize: 15, fontWeight: "900" },
});
