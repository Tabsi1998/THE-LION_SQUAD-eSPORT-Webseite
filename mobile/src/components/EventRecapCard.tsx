import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api } from "../lib/api";
import { numberTiles, ownResultLine, podiumDetail, podiumOrder, type EventRecapData, type PodiumEntry, type RecapItem } from "../lib/eventRecap";
import { colors, radius } from "../theme";
import { Card } from "./Card";
import { Body, Heading, Muted } from "./Text";

// Rückblick nach dem Event (#1187): wie im Web (EventRecap) - „Du warst dabei“ mit dem eigenen Ergebnis, die Zahlen, die
// Sieger je Turnier und Fast Lap als kleines Treppchen und der Bericht. Ohne Daten (vorher, Fehler, älterer Server)
// zeigt die Karte nichts; die Event-Seite bleibt dann wie bisher.

type Props = {
  eventKey: string;
  onOpen: (kind: "tournament" | "fastlap" | "news", key: string) => void;
};

const PLACE = {
  1: { height: 44, color: colors.gold, fill: "rgba(255,215,0,0.18)" },
  2: { height: 30, color: "#D4D4D8", fill: "rgba(255,255,255,0.08)" },
  3: { height: 22, color: "#E0A36B", fill: "rgba(205,127,50,0.16)" },
} as const;

function MiniPodium({ podium, testID }: { podium: PodiumEntry[]; testID: string }) {
  if (!podium.length) return <Muted>Noch keine Ergebnisse.</Muted>;
  return (
    <View style={styles.podium} testID={testID}>
      {podiumOrder(podium).map((entry, index) => {
        const rank = ([2, 1, 3] as const)[index];
        const place = PLACE[rank];
        if (!entry) return <View key={rank} style={styles.step} />;
        const detail = podiumDetail(entry);
        return (
          <View key={rank} style={styles.step} accessible accessibilityLabel={`Platz ${rank}: ${entry.name}${detail ? `, ${detail}` : ""}`} testID={`${testID}-${rank}`}>
            <Body style={[styles.stepName, rank === 1 && styles.strong]} numberOfLines={2}>{entry.name}</Body>
            {detail ? <Muted style={styles.stepDetail} numberOfLines={1}>{detail}</Muted> : null}
            <View style={[styles.stepBar, { height: place.height, backgroundColor: place.fill, borderColor: place.color }]}>
              <Body style={[styles.stepRank, { color: place.color }]}>{rank}</Body>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function EventRecapCard({ eventKey, onOpen }: Props) {
  const [recap, setRecap] = useState<EventRecapData | null>(null);

  useEffect(() => {
    let alive = true;
    setRecap(null);
    api.get<EventRecapData>(`/events/${eventKey}/recap`)
      .then(({ data }) => { if (alive) setRecap(data?.available === true ? data : null); })
      .catch(() => { if (alive) setRecap(null); });
    return () => { alive = false; };
  }, [eventKey]);

  if (!recap) return null;
  const tiles = numberTiles(recap.numbers);
  const items: RecapItem[] = [...(recap.winners || []), ...(recap.fastlaps || [])];
  const mine = recap.mine?.was_there ? recap.mine : null;

  return (
    <Card style={styles.card} testID="event-recap">
      <View style={styles.titleRow}>
        <Ionicons name="ribbon-outline" size={18} color={colors.gold} />
        <Heading>Rückblick</Heading>
      </View>

      {mine ? (
        <View style={styles.mine} testID="event-recap-mine">
          <View style={styles.titleRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.cyan} />
            <Body style={[styles.strong, styles.mineTitle]}>Du warst dabei</Body>
          </View>
          {mine.results.map((result) => (
            <Pressable
              key={`${result.kind}-${result.id}`}
              onPress={() => onOpen(result.kind, String(result.slug || result.id))}
              accessibilityRole="link"
              testID={`event-recap-mine-${result.kind}-${result.id}`}
            >
              <Body><Body style={styles.strong}>{result.title}</Body> <Muted>{ownResultLine(result)}</Muted></Body>
            </Pressable>
          ))}
        </View>
      ) : null}

      {tiles.length ? (
        <View style={styles.tiles} testID="event-recap-numbers">
          {tiles.map((tile) => (
            <View key={tile.key} style={styles.tile} accessible accessibilityLabel={`${tile.value} ${tile.label}`} testID={`event-recap-number-${tile.key}`}>
              <Body style={styles.tileValue}>{tile.value}</Body>
              <Muted style={styles.tileLabel}>{tile.label}</Muted>
            </View>
          ))}
        </View>
      ) : null}

      {items.map((item) => (
        <View key={`${item.kind}-${item.id}`} style={styles.item} testID={`event-recap-${item.kind}-${item.id}`}>
          <Pressable onPress={() => onOpen(item.kind, String(item.slug || item.id))} accessibilityRole="link" style={styles.titleRow}>
            <Ionicons name={item.kind === "fastlap" ? "flag-outline" : "trophy-outline"} size={16} color={item.kind === "fastlap" ? "#2DD4BF" : colors.cyan} />
            <Body style={[styles.strong, styles.flex]} numberOfLines={2}>{item.title}</Body>
          </Pressable>
          {item.kind === "fastlap" && item.track ? <Muted>Beste Zeit auf {item.track}</Muted> : null}
          {item.kind === "tournament" && item.team ? <Muted>Team-Turnier</Muted> : null}
          <MiniPodium podium={item.podium || []} testID={`event-recap-podium-${item.id}`} />
        </View>
      ))}

      {recap.report ? (
        <Pressable onPress={() => onOpen("news", String(recap.report?.slug || recap.report?.id))} accessibilityRole="link" style={styles.report} testID="event-recap-report">
          <Ionicons name="newspaper-outline" size={18} color={colors.cyan} />
          <View style={styles.flex}>
            <Muted style={styles.tileLabel}>Bericht</Muted>
            <Body style={styles.strong}>{recap.report.title}</Body>
            {recap.report.excerpt ? <Muted numberOfLines={2}>{recap.report.excerpt}</Muted> : null}
          </View>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  strong: { fontWeight: "700", color: colors.white },
  flex: { flex: 1 },
  mine: { gap: 6, padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(41,182,232,0.4)", backgroundColor: "rgba(41,182,232,0.06)" },
  mineTitle: { color: colors.cyan, textTransform: "uppercase" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { minWidth: 90, flexGrow: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.05)" },
  tileValue: { fontSize: 24, fontWeight: "800", color: colors.white },
  tileLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  item: { gap: 8, padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt },
  podium: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  step: { flex: 1, alignItems: "center" },
  stepName: { textAlign: "center", fontSize: 13 },
  stepDetail: { textAlign: "center", fontSize: 11 },
  stepBar: { alignSelf: "stretch", marginTop: 6, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, alignItems: "center", paddingTop: 2 },
  stepRank: { fontWeight: "800", fontSize: 16 },
  report: { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
});
