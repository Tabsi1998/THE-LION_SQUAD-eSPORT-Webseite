import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { canOperateStation, queueSummaryLine, type LiveQueue } from "../../lib/liveQueue";
import { problemCountText, type Problem, type ProblemTone } from "../../lib/tournamentCockpit";
import { micro, motion, radius, roles, surfaces } from "../../theme";
import { Glow, useReduceMotion } from "../motion";
import { useLeaving, type Displayed } from "../motion/useLeaving";
import { StationTile, type StationHandlers } from "../live/StationTile";

// Turnier-Cockpit in der App (#1653, #2393): der Einstieg der Turnierleitung am Turniertag vor Ort - wie im Web oben
// bzw. am Tablet quer links die „Probleme“ (dringendstes zuerst, ein Tipp führt zum Fall), darunter bzw. rechts die
// Stationen mit „läuft“ (Spielzeit-Uhr) und „Als Nächstes“ - Aufrufen, Starten, Freigeben, Defekt.
// Bewegung (nur transform und opacity): Neue Probleme blenden gestaffelt ein und heben sich einmal leicht an, ihr Rahmen
// leuchtet kurz auf; erledigte gleiten nach rechts hinaus. Beim Nachladen bleiben die Zeilen stehen (Schlüssel je
// Fall). Mit „Bewegung reduzieren“ springen die Zustände.

const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);
export const PROBLEM_LEAVE_MS = motion.slow;

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  dispute: "scale-outline",
  procedure: "scale-outline",
  no_show: "person-remove-outline",
  station_broken: "construct-outline",
  result_missing: "clipboard-outline",
  report_conflict: "chatbubbles-outline",
  delay: "timer-outline",
  draw: "shuffle",
};

const TONES: Record<ProblemTone, { color: string; border: string }> = {
  warn: { color: roles.warn, border: "rgba(255,159,67,0.35)" },
  honor: { color: roles.honor, border: "rgba(255,215,0,0.3)" },
  brand: { color: roles.brand, border: "rgba(41,182,232,0.35)" },
};

/**
 * Wann eine neue Zeile einsteigt: die Zeilen, die beim selben Laden dazukommen, nacheinander (je `micro.stagger`,
 * höchstens `micro.staggerMax`) - Zeilen, die schon standen, behalten ihren Platz und bewegen sich nicht.
 */
export function useStaggerOrder(ids: string[]) {
  const seen = useRef(new Map<string, number>());
  const current = new Set(ids);
  // Ein erledigter Fall, der später wiederkommt, steigt neu ein.
  for (const id of [...seen.current.keys()]) if (!current.has(id)) seen.current.delete(id);
  ids.filter((id) => !seen.current.has(id)).forEach((id, index) => seen.current.set(id, Math.min(index, micro.staggerMax)));
  return (id: string) => seen.current.get(id) ?? 0;
}

function ProblemRow({ problem, order, leaving, reduce, onOpen }: { problem: Problem; order: number; leaving: boolean; reduce: boolean; onOpen: (problem: Problem) => void }) {
  const tone = TONES[problem.tone] || TONES.honor;
  const delay = order * micro.stagger;
  // Beim ersten Zeichnen: einblenden, dabei 10 Punkte hoch, kurz über das Ziel (-3) und zurück. Ohne Bewegung: steht.
  const [arrives] = useState(!reduce);
  const shown = useSharedValue(arrives ? 0 : 1);
  const rise = useSharedValue(arrives ? 10 : 0);
  const out = useSharedValue(0);
  useEffect(() => {
    if (!arrives) return;
    shown.value = withDelay(delay, withTiming(1, { duration: motion.mid, easing: ease }));
    rise.value = withDelay(delay, withSequence(withTiming(-3, { duration: Math.round(motion.slow * 0.6), easing: ease }), withTiming(0, { duration: Math.round(motion.slow * 0.4), easing: ease })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (leaving && !reduce) out.value = withTiming(1, { duration: PROBLEM_LEAVE_MS, easing: ease });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value * (1 - out.value),
    transform: [{ translateY: rise.value }, { translateX: out.value * 28 }],
  }));
  return (
    <Animated.View style={style} pointerEvents={leaving ? "none" : "auto"} testID={leaving ? undefined : `cockpit-problem-item-${problem.id}`}>
      <Pressable
        onPress={() => onOpen(problem)}
        accessibilityRole="button"
        accessibilityLabel={[problem.chip, problem.where, problem.title, problem.what, problem.detail].filter(Boolean).join(", ")}
        accessibilityHint={problem.target === "station" ? "Springt zur Station" : "Öffnet den Fall"}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        testID={leaving ? undefined : `cockpit-problem-${problem.id}`}
      >
        <Glow active={arrives} delay={delay + motion.fast} color={tone.color} peak={0.14} radius={radius.sm} />
        <View style={[styles.icon, { borderColor: tone.border }]}>
          <Ionicons name={ICONS[problem.kind] || "alert-circle-outline"} size={20} color={tone.color} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.chip, { color: tone.color }]} maxFontSizeMultiplier={1.3} testID={`cockpit-problem-chip-${problem.id}`}>
            {problem.chip.toUpperCase()}{problem.where ? <Text style={styles.where}>{`  ${problem.where}`}</Text> : null}
          </Text>
          <Text style={styles.title} maxFontSizeMultiplier={1.4}>{problem.title}</Text>
          {problem.what ? <Text style={styles.what} maxFontSizeMultiplier={1.4}>{problem.what}</Text> : null}
          {problem.detail ? <Text style={styles.detail} maxFontSizeMultiplier={1.4}>{problem.detail}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.35)" />
      </Pressable>
    </Animated.View>
  );
}

/** Die Liste „Probleme“ - erledigte bleiben kurz stehen und gleiten hinaus (`displayed` aus `useLeaving`). */
export function ProblemList({ problems, displayed, onOpen }: { problems: Problem[]; displayed: Displayed<Problem>[]; onOpen: (problem: Problem) => void }) {
  const reduce = useReduceMotion();
  const orderOf = useStaggerOrder(problems.map((problem) => problem.id));
  return (
    <View style={styles.list} testID="cockpit-problems-list">
      {displayed.map(({ item, leaving }) => (
        <ProblemRow key={item.id} problem={item} order={orderOf(item.id)} leaving={leaving} reduce={reduce} onOpen={onOpen} />
      ))}
    </View>
  );
}

export function TournamentCockpit({ problems, loaded, queue, offset = null, busyStation = "", highlight, handlers, onOpen, onStationLayout }: {
  problems: Problem[];
  loaded: boolean;
  queue: LiveQueue;
  offset?: number | null;
  busyStation?: string;
  /** Die Station, zu der ein Tipp auf „Verzug“ gesprungen ist, und wie oft schon. */
  highlight?: { id: string; pulse: number } | null;
  handlers: StationHandlers;
  onOpen: (problem: Problem) => void;
  /** Wo jede Station steht (Abstand zum oberen Rand des Cockpits) - zum Hinspringen. */
  onStationLayout?: (stationId: string, y: number) => void;
}) {
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const displayed = useLeaving(problems, (problem) => problem.id, PROBLEM_LEAVE_MS, reduce);
  // „Alles im Plan“ erst, wenn die letzte Zeile hinausgeglitten ist - sonst stünde beides kurz übereinander.
  const settled = !displayed.some((row) => row.leaving);
  // Tablet quer: Probleme links, Stationen rechts. Ab Tablet-Breite stehen die Kacheln zu zweit nebeneinander.
  const side = width >= 960;
  const pairs = width >= 640 && !side;
  const count = problems.length;
  const summary = queueSummaryLine(queue.summary);
  const stations = queue.stations || [];
  const sectionY = useRef({ stations: 0, grid: 0 });
  const tileY = useRef<Record<string, number>>({});
  const report = (id: string) => {
    if (!onStationLayout || tileY.current[id] === undefined) return;
    onStationLayout(id, sectionY.current.stations + sectionY.current.grid + tileY.current[id]);
  };
  // Wächst die Liste darüber, rutschen die Stationen nach unten - dann alle neu melden.
  const reportAll = () => Object.keys(tileY.current).forEach(report);
  return (
    <View style={[styles.cockpit, side && styles.cockpitSide]} testID="lead-cockpit">
      <View style={[styles.section, side && styles.problemsSide]} testID="cockpit-problems">
        <View style={styles.sectionHead}>
          <View style={styles.flex}>
            <Text style={styles.heading} accessibilityRole="header">PROBLEME</Text>
            <Text style={styles.sub}>Dringendes zuerst – ein Tipp führt zum Fall.</Text>
          </View>
          {/* Vor dem ersten Laden der Fälle nichts ansagen - „Keine Probleme“ wäre geraten. */}
          <Text
            style={[styles.count, !loaded ? styles.countWait : count ? styles.countSome : styles.countNone]}
            accessibilityLiveRegion="polite"
            testID="cockpit-problems-count"
          >
            {loaded ? problemCountText(count).toUpperCase() : "WIRD GELADEN …"}
          </Text>
        </View>
        {loaded && !count && settled ? (
          <View style={styles.empty} testID="cockpit-problems-empty">
            <Ionicons name="checkmark-circle-outline" size={24} color={roles.ok} />
            <View style={styles.flex}>
              <Text style={styles.title}>Alles im Plan</Text>
              <Text style={styles.what}>Gerade hängt nichts. Neue Fälle erscheinen hier von selbst.</Text>
            </View>
          </View>
        ) : null}
        <ProblemList problems={problems} displayed={displayed} onOpen={onOpen} />
      </View>

      <View
        style={[styles.section, side && styles.stationsSide]}
        onLayout={(event: LayoutChangeEvent) => { sectionY.current.stations = event.nativeEvent.layout.y; reportAll(); }}
        testID="cockpit-stations"
      >
        <View>
          <Text style={styles.heading} accessibilityRole="header">STATIONEN</Text>
          <Text style={styles.sub}>Was läuft, was als Nächstes kommt – mit einem Tipp aufrufen und starten.</Text>
        </View>
        {summary ? (
          <View style={styles.summary} testID="live-summary">
            <Ionicons name="timer-outline" size={16} color={roles.brand} />
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        ) : null}
        <View style={[styles.grid, pairs && styles.gridPairs]} onLayout={(event: LayoutChangeEvent) => { sectionY.current.grid = event.nativeEvent.layout.y; reportAll(); }}>
          {stations.map((station, index) => (
            <View key={station.id} style={pairs ? styles.half : undefined} onLayout={(event: LayoutChangeEvent) => { tileY.current[station.id] = event.nativeEvent.layout.y; report(station.id); }}>
              <StationTile
                station={station}
                index={index}
                busy={busyStation === station.id}
                canOperate={canOperateStation(queue, station)}
                highlight={highlight?.id === station.id ? highlight.pulse : 0}
                offset={offset}
                handlers={handlers}
              />
            </View>
          ))}
        </View>
        {(queue.unplaced || []).length ? (
          <Text style={styles.what} testID="live-unplaced">
            {queue.unplaced?.length === 1 ? "1 Spiel hat keine Station (fester Termin oder freigegeben) – es steht in „Ergebnisse“." : `${queue.unplaced?.length} Spiele haben keine Station (fester Termin oder freigegeben) – sie stehen in „Ergebnisse“.`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  cockpit: { gap: 20 },
  cockpitSide: { alignItems: "flex-start", columnGap: 20, flexDirection: "row" },
  count: { borderRadius: radius.sm, borderWidth: 1, fontSize: 11, fontWeight: "800", letterSpacing: 1, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 2 },
  countNone: { borderColor: "rgba(31,208,142,0.4)", color: roles.ok },
  countSome: { borderColor: "rgba(255,215,0,0.4)", color: roles.honor },
  countWait: { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" },
  detail: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },
  empty: { alignItems: "center", backgroundColor: "rgba(31,208,142,0.05)", borderColor: "rgba(31,208,142,0.25)", borderRadius: radius.sm, borderWidth: 1, columnGap: 12, flexDirection: "row", padding: 14 },
  flex: { flex: 1, minWidth: 0 },
  grid: { gap: 12 },
  gridPairs: { flexDirection: "row", flexWrap: "wrap" },
  half: { flexBasis: "48%", flexGrow: 1 },
  heading: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  icon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: radius.sm, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  list: { gap: 8 },
  pressed: { opacity: 0.85 },
  problemsSide: { flex: 5 },
  row: { alignItems: "center", backgroundColor: surfaces.s1, borderColor: "rgba(255,255,255,0.1)", borderRadius: radius.sm, borderWidth: 1, columnGap: 12, flexDirection: "row", minHeight: 64, paddingLeft: 14, paddingRight: 10, paddingVertical: 10 },
  section: { gap: 12 },
  sectionHead: { alignItems: "flex-end", columnGap: 12, flexDirection: "row" },
  stationsSide: { flex: 7 },
  sub: { color: "rgba(255,255,255,0.45)", fontSize: 12 },
  summary: { alignItems: "center", backgroundColor: surfaces.s1, borderColor: "rgba(255,255,255,0.1)", borderRadius: radius.sm, borderWidth: 1, columnGap: 8, flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8 },
  summaryText: { color: "#FFFFFF", flexShrink: 1, fontSize: 14, fontWeight: "800" },
  title: { color: "#FFFFFF", fontSize: 14, fontWeight: "800", marginTop: 2 },
  what: { color: "rgba(255,255,255,0.55)", fontSize: 12 },
  where: { color: "rgba(255,255,255,0.45)", letterSpacing: 1 },
});
