import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { isCancelled, isDone, isLive, type BracketMatch } from "../../lib/bracketGraph";
import { plannedText } from "../../lib/slotSource";
import { hasPlayer, matchStatusText, roundLabels, scheduleSections } from "../../lib/tournamentView";
import { colors, radius, roles, surfaces } from "../../theme";
import { useReduceMotion } from "../FadeIn";
import { SegmentedTabs } from "../SegmentedTabs";
import { YouCorners, YouFill, YouTag } from "../YouFrame";
import { youSpeech } from "../../lib/youLabel";
import { LiveClock, clockDuration } from "./bracket/LiveClock";
import { playersText } from "./bracket/LiveNow";
import { breatheStyle } from "./bracket/motion";

// Der Spielplan (#1563): nach Spieltag/Runde oder nach Station gruppiert, „Nur meine“ für die eigenen Spiele. Laufendes
// mit rotem Punkt und Uhr, entfallene Spiele leise mit ihrem Grund. Antippen öffnet das Spiel. Dein Spiel trägt die
// Ecken-Klammern und „Du“ bzw. „Dein Team“ (#1316, wie TournamentSchedulePage im Web).

type Props = {
  matches: BracketMatch[];
  stages: Array<{ id?: string; stage_type?: string | null }>;
  format?: string | null;
  nameOf: (registrationId: string) => string;
  mineId: string | null;
  /** Etikett an deinem Spiel: „Du“ oder „Dein Team“ (lib/youLabel). */
  mineLabel?: string;
  onOpen: (matchId: string) => void;
};

export function ScheduleList({ matches, stages, format, nameOf, mineId, mineLabel = "Du", onOpen }: Props) {
  const reduce = useReduceMotion();
  const [by, setBy] = useState<"day" | "station">("day");
  const [onlyMine, setOnlyMine] = useState(false);
  const labels = useMemo(() => roundLabels(matches, stages, format), [format, matches, stages]);
  const hasStations = matches.some((match) => match.station_text);
  const mineCount = useMemo(() => (mineId ? matches.filter((match) => hasPlayer(match, mineId)).length : 0), [matches, mineId]);
  const sections = useMemo(() => scheduleSections(matches, { by, mine: onlyMine ? mineId : null, labels }), [by, labels, matches, mineId, onlyMine]);
  return (
    <View style={styles.wrap}>
      <SegmentedTabs label="Spielplan ordnen" items={[{ key: "day", label: "Spieltag" }, { key: "station", label: "Station" }]} value={by} onChange={setBy} />
      {mineCount ? (
        <Pressable
          onPress={() => setOnlyMine((value) => !value)}
          style={styles.mineToggle}
          accessibilityRole="switch"
          accessibilityState={{ checked: onlyMine }}
          hitSlop={8}
          testID="schedule-only-mine"
        >
          <View style={[styles.box, onlyMine && styles.boxOn]} />
          <Text style={styles.mineText}>Nur meine ({mineCount})</Text>
        </Pressable>
      ) : null}
      {!hasStations && by === "station" ? <Text style={styles.hint}>Noch ist keinem Spiel eine Station zugeteilt.</Text> : null}
      {sections.length ? sections.map((section) => (
        <View key={section.key} style={styles.section} testID={`schedule-section-${section.key}`}>
          <View style={styles.sectionHead}>
            {section.live ? <Animated.View style={[styles.liveDot, breatheStyle(reduce)]} /> : null}
            <Text style={[styles.sectionTitle, section.live && styles.sectionLive]} accessibilityRole="header">{section.title}</Text>
            <Text style={styles.count}>{section.items.length}</Text>
          </View>
          {section.items.map((match) => (
            <ScheduleRow key={match.id} match={match} round={by === "station" ? labels.get(match.id) || "" : ""} nameOf={nameOf} mine={hasPlayer(match, mineId)} mineLabel={mineLabel} reduce={reduce} onOpen={onOpen} />
          ))}
        </View>
      )) : <Text style={styles.hint}>{onlyMine ? "Für dich ist hier gerade kein Spiel." : "Noch keine Spiele veröffentlicht."}</Text>}
    </View>
  );
}

const ScheduleRow = React.memo(function ScheduleRow({ match, round, nameOf, mine, mineLabel, reduce, onOpen }: {
  match: BracketMatch; round: string; nameOf: (id: string) => string; mine: boolean; mineLabel: string; reduce: boolean; onOpen: (id: string) => void;
}) {
  const live = isLive(match);
  const cancelled = isCancelled(match);
  const done = isDone(match);
  const title = match.match_type === "ffa" ? `Lauf ${match.match_key || ""}` : match.match_key || "Spiel";
  const when = live ? "" : plannedText(match);
  const meta = [round, !live && match.station_text ? match.station_text : "", when].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={() => onOpen(match.id)}
      style={({ pressed }) => [styles.row, live && styles.rowLive, cancelled && styles.rowQuiet, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${playersText(match, nameOf)}${mine ? `, ${youSpeech(mineLabel)}` : ""}, ${matchStatusText(match)}`}
      testID={`schedule-row-${match.id}`}
    >
      {mine ? <YouFill radius={radius.lg} /> : null}
      <View style={styles.key}>
        <Text style={styles.keyText} numberOfLines={1}>{title}</Text>
      </View>
      <View style={styles.main}>
        <Text style={[styles.names, done && styles.namesDone]} numberOfLines={2} maxFontSizeMultiplier={1.4}>{playersText(match, nameOf)}</Text>
        {meta ? <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={1.4}>{meta}</Text> : null}
      </View>
      <View style={styles.side}>
        {mine ? <YouTag label={mineLabel} testID={`schedule-you-${match.id}`} style={styles.youTag} /> : null}
        {live ? (
          <View style={styles.liveRow}>
            <Animated.View style={[styles.liveDot, breatheStyle(reduce)]} />
            <Text style={styles.liveText} numberOfLines={1}>{match.station_text || "läuft"}</Text>
            <LiveClock startedAt={match.started_at} durationMinutes={clockDuration(match)} pausedAt={match.paused_at} pausedSeconds={match.paused_seconds} style={styles.liveText} />
          </View>
        ) : (
          <Text style={[styles.status, cancelled && styles.statusQuiet]} numberOfLines={2}>{matchStatusText(match)}</Text>
        )}
      </View>
      {/* Ecken-Klammern (#1316): 5 Punkte außen - die Zeilen stehen 6 Punkte auseinander, nichts wird abgeschnitten. */}
      {mine ? <YouCorners /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  hint: { color: roles.muted, fontSize: 13 },
  mineToggle: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 8, minHeight: 40 },
  box: { borderColor: colors.border, borderRadius: radius.lg, borderWidth: 2, height: 18, width: 18 },
  boxOn: { backgroundColor: roles.brand, borderColor: roles.brand },
  mineText: { color: colors.white, fontSize: 14, fontWeight: "800" },
  section: { gap: 6 },
  sectionHead: { alignItems: "center", flexDirection: "row", gap: 7, paddingTop: 4 },
  sectionTitle: { color: colors.white, flex: 1, fontSize: 15, fontWeight: "900" },
  sectionLive: { color: roles.live },
  count: { color: roles.quiet, fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "800" },
  row: { alignItems: "center", backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 56, paddingHorizontal: 10, paddingVertical: 8 },
  rowLive: { borderColor: "rgba(255,59,48,0.55)" },
  rowQuiet: { backgroundColor: "transparent", borderStyle: "dashed", opacity: 0.75 },
  pressed: { opacity: 0.72 },
  key: { width: 52 },
  keyText: { color: roles.muted, fontSize: 11, fontWeight: "900" },
  main: { flex: 1, gap: 2, minWidth: 0 },
  names: { color: colors.white, fontSize: 14, fontWeight: "800" },
  namesDone: { color: "rgba(255,255,255,0.75)" },
  meta: { color: roles.muted, fontSize: 12 },
  side: { alignItems: "flex-end", gap: 3, maxWidth: 120 },
  youTag: { alignSelf: "flex-end" },
  status: { color: roles.muted, fontSize: 12, fontWeight: "700", textAlign: "right" },
  statusQuiet: { color: roles.quiet, fontStyle: "italic" },
  liveRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  liveDot: { backgroundColor: roles.live, borderRadius: 4, height: 7, width: 7 },
  liveText: { color: roles.live, fontSize: 12, fontWeight: "900" },
});
