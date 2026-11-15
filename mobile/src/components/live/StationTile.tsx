import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import {
  STATION_TONE_LABELS,
  brokenOtherQuestion,
  calledLine,
  nextAction,
  queueWhat,
  queueWhen,
  releaseQuestion,
  stationHolds,
  stationTone,
  stationWho,
  type QueueEntry,
  type QueueStation,
  type StationTone,
} from "../../lib/liveQueue";
import { micro, motion, radius, roles, surfaces } from "../../theme";
import { Button } from "../Button";
import { Glow, useReduceMotion } from "../motion";
import { MatchClock } from "./MatchClock";

// Eine Station als Kachel (#1556, #1162, #2393) - wie StationTile im Web: Zustand, Spiel und Namen im Klartext, darunter
// die Knöpfe für den Turniertag: „Aufrufen“, „Starten“, „Freigeben“ (mit Rückfrage) und „Defekt“ bzw. „Bereit“ (an einer
// Station eines anderen Turniers mit Rückfrage). Die Kachel rechnet nichts - Reihenfolge und „Als Nächstes“ kommen vom
// Server. Knöpfe nur mit Recht (`canOperate`, `operate` des Servers).
// Bewegung (nur transform/opacity): Die Kacheln kommen beim ersten Zeichnen gestaffelt; ein neuer Aufruf hebt den Block
// „Als Nächstes“ einmal leicht an und lässt ihn kurz aufleuchten; springt ein Tipp auf „Verzug“ hierher, leuchtet die
// ganze Kachel einmal auf. Mit „Bewegung reduzieren“ springen die Zustände.

const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

const TONE_COLORS: Record<StationTone, { text: string; border: string; background: string }> = {
  running: { text: roles.live, border: "rgba(255,59,48,0.4)", background: "rgba(255,59,48,0.1)" },
  called: { text: roles.brand, border: "rgba(41,182,232,0.5)", background: "rgba(41,182,232,0.1)" },
  broken: { text: roles.warn, border: "rgba(255,159,67,0.5)", background: "rgba(255,159,67,0.1)" },
  free: { text: roles.ok, border: "rgba(31,208,142,0.4)", background: "rgba(31,208,142,0.1)" },
  other: { text: "rgba(255,255,255,0.7)", border: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.05)" },
  stuck: { text: roles.warn, border: "rgba(255,159,67,0.5)", background: "rgba(255,159,67,0.1)" },
};

export type StationHandlers = {
  onCall: (station: QueueStation, entry: QueueEntry) => void;
  onStart: (station: QueueStation, entry: QueueEntry) => void;
  onRelease: (station: QueueStation, entry: QueueEntry) => void;
  onBroken: (station: QueueStation, broken: boolean, extra?: { confirm_other?: boolean }) => void;
};

/** Steigt beim ersten Zeichnen leise auf - gestaffelt nach der Stelle; danach ist Ruhe. */
function useArrival(index: number, reduce: boolean) {
  const [plan] = useState(() => (reduce ? null : Math.min(index, micro.staggerMax) * micro.stagger));
  const shown = useSharedValue(plan === null ? 1 : 0);
  useEffect(() => {
    if (plan !== null) shown.value = withDelay(plan, withTiming(1, { duration: motion.mid, easing: ease }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 6 }] }));
}

/** Aufgerufen: hebt sich einmal leicht an (4 Punkte, dann zurück) - nur beim Wechsel, nie beim ersten Zeichnen. */
function useLift(trigger: string, reduce: boolean) {
  const lift = useSharedValue(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduce || trigger !== "called") return;
    lift.value = withSequence(withTiming(-4, { duration: motion.fast, easing: ease }), withTiming(0, { duration: motion.mid, easing: ease }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }] }));
}

export function StationTile({ station, index = 0, busy = false, canOperate = false, highlight = 0, offset = null, handlers, onLayout }: {
  station: QueueStation;
  index?: number;
  busy?: boolean;
  canOperate?: boolean;
  /** Zählt die Sprünge hierher (Tipp auf „Verzug“) - jeder neue lässt die Kachel einmal aufleuchten. */
  highlight?: number;
  /** Abstand der Serveruhr (ms) aus der Antwort - die Uhr zählt danach. */
  offset?: number | null;
  handlers: StationHandlers;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const reduce = useReduceMotion();
  const tone = stationTone(station);
  const colorsOf = TONE_COLORS[tone];
  const { running, next, after } = station;
  const broken = tone === "broken";
  const holds = stationHolds(station);
  const [panel, setPanel] = useState<"" | "release" | "broken-other">("");
  const arrival = useArrival(index, reduce);
  const lift = useLift(next?.state === "called" ? "called" : next ? "queued" : "", reduce);
  const where = station.station_text || station.name || "Station";
  const action = nextAction(station, canOperate);
  const toggle = (name: "release" | "broken-other") => setPanel((current) => (current === name ? "" : name));

  return (
    <Animated.View style={[styles.tile, broken && styles.tileBroken, arrival]} onLayout={onLayout} testID={`live-station-${station.id}`} accessibilityLabel={where}>
      <Glow trigger={highlight || undefined} tone="brand" peak={0.22} radius={radius.md} testID={`live-station-glow-${station.id}`} />
      <View style={styles.header}>
        <Text style={styles.name} maxFontSizeMultiplier={1.4} accessibilityRole="header">{where}</Text>
        <View style={[styles.chip, { borderColor: colorsOf.border, backgroundColor: colorsOf.background }]} testID={`live-chip-${station.id}`}>
          {running && !broken ? <View style={styles.dot} /> : null}
          <Text style={[styles.chipText, { color: colorsOf.text }]} maxFontSizeMultiplier={1.3}>{STATION_TONE_LABELS[tone].toUpperCase()}</Text>
        </View>
      </View>

      {tone === "other" ? (
        <Text style={styles.hintBox} testID={`live-other-hint-${station.id}`}>Hier spielt gerade „{station.hold_issue?.tournament_title || "ein anderes Turnier"}“ – dessen Leitung ruft auf, startet und gibt frei.</Text>
      ) : null}
      {tone === "stuck" ? (
        <Text style={[styles.hintBox, styles.warnBox]} testID={`live-stuck-hint-${station.id}`}>Als belegt gespeichert, aber ohne offenes Spiel – räumen geht in der Turnierleitung im Web (Reiter „Stationen“).</Text>
      ) : null}
      {broken && holds ? (
        <Text style={[styles.hintBox, styles.warnBox]} testID={`live-broken-hint-${station.id}`}>
          {running ? "Das laufende Spiel steht noch hier – mit „Umlegen“ auf eine freie Station, Uhr und Startzeit bleiben." : "Der Aufruf steht noch hier – mit „Umlegen“ an einer freien Station neu aufrufen."}
        </Text>
      ) : null}

      {running ? (
        <View style={styles.block} testID={`live-running-${station.id}`}>
          <Text style={styles.what} maxFontSizeMultiplier={1.4}>{queueWhat(running)}</Text>
          <Text style={styles.who} maxFontSizeMultiplier={1.4}>{stationWho(running)}</Text>
          <MatchClock startedAt={running.started_at} durationMinutes={running.duration_minutes} pausedAt={running.paused_at} pausedSeconds={running.paused_seconds} offset={offset} testID={`live-clock-${running.match_id}`} style={styles.clock} />
        </View>
      ) : null}

      {next ? (
        <Animated.View style={[styles.next, next.state === "called" && styles.nextCalled, lift]} testID={`live-next-${station.id}`}>
          {next.state === "called" ? <Glow trigger={next.called_at || next.match_id} tone="brand" peak={0.18} radius={radius.md} /> : null}
          <Text style={styles.eyebrow} maxFontSizeMultiplier={1.3}>ALS NÄCHSTES</Text>
          <Text style={styles.what} maxFontSizeMultiplier={1.4}>{queueWhat(next)}</Text>
          <Text style={styles.who} maxFontSizeMultiplier={1.4}>{stationWho(next)}</Text>
          <View style={styles.lineRow}>
            {next.state === "called" ? <Ionicons name="notifications" size={13} color={roles.brand} /> : null}
            <Text style={[styles.line, next.state === "called" && styles.lineCalled]} maxFontSizeMultiplier={1.4} testID={`live-next-line-${station.id}`}>{next.state === "called" ? calledLine(next) : queueWhen(next)}</Text>
          </View>
          {action?.kind === "waiting" ? <Text style={styles.quiet} testID={`live-waiting-${station.id}`}>{action.text}</Text> : null}
          {action?.kind === "hint" ? <Text style={styles.quiet}>{action.text}</Text> : null}
          {action?.kind === "start" ? (
            <Button label={busy ? "Wird gespeichert …" : "Starten"} icon="play" onPress={() => handlers.onStart(station, next)} disabled={busy} busy={busy} style={styles.action} testID={`live-start-${station.id}`} />
          ) : null}
          {action?.kind === "call" ? (
            <Button label={busy ? "Wird aufgerufen …" : "Aufrufen"} icon="notifications" variant="secondary" onPress={() => handlers.onCall(station, next)} disabled={busy} busy={busy} style={styles.action} testID={`live-call-${station.id}`} />
          ) : null}
        </Animated.View>
      ) : !running ? (
        <Text style={styles.empty}>{broken ? "Station ist defekt – nichts wird hierher geplant." : "Nichts mehr in der Warteschlange."}</Text>
      ) : null}

      {after ? (
        <Text style={styles.after} maxFontSizeMultiplier={1.4} testID={`live-after-${station.id}`}>
          <Text style={styles.afterLabel}>DANACH</Text> · {queueWhat(after)} · {stationWho(after)}{queueWhen(after) ? ` · ${queueWhen(after)}` : ""}
        </Text>
      ) : null}

      {canOperate ? (
        <View style={styles.tools} testID={`live-tools-${station.id}`}>
          <View style={styles.toolRow}>
            <Button label="Freigeben" icon="lock-open-outline" variant="secondary" onPress={() => toggle("release")} disabled={busy || !holds} style={styles.tool} testID={`live-release-${station.id}`} />
            <Button
              label={broken ? "Bereit" : "Defekt"}
              icon={broken ? "refresh" : "construct-outline"}
              variant={broken ? "secondary" : "danger"}
              accessibilityLabel={broken ? "Station wieder bereit" : "Station defekt melden"}
              onPress={() => (tone === "other" ? toggle("broken-other") : handlers.onBroken(station, !broken))}
              disabled={busy}
              style={styles.tool}
              testID={`live-broken-${station.id}`}
            />
          </View>
          {panel === "release" && holds ? (
            <Confirm
              text={releaseQuestion(station).text}
              yes={releaseQuestion(station).yes}
              busy={busy}
              onNo={() => setPanel("")}
              onYes={() => { setPanel(""); handlers.onRelease(station, holds); }}
              testID={`live-release-confirm-${station.id}`}
              yesTestID={`live-release-yes-${station.id}`}
            />
          ) : null}
          {panel === "broken-other" && tone === "other" ? (
            <Confirm
              text={brokenOtherQuestion(station)}
              yes="Defekt melden"
              busy={busy}
              onNo={() => setPanel("")}
              onYes={() => { setPanel(""); handlers.onBroken(station, true, { confirm_other: true }); }}
              testID={`live-broken-confirm-${station.id}`}
              yesTestID={`live-broken-yes-${station.id}`}
            />
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Rückfrage in der Kachel - kein Fenster über der Seite, die Station bleibt im Blick. Blendet leise ein. */
function Confirm({ text, yes, busy, onYes, onNo, testID, yesTestID }: { text: string; yes: string; busy: boolean; onYes: () => void; onNo: () => void; testID: string; yesTestID: string }) {
  const reduce = useReduceMotion();
  const arrival = useArrival(0, reduce);
  return (
    <Animated.View style={[styles.confirm, arrival]} testID={testID}>
      <Text style={styles.confirmText} maxFontSizeMultiplier={1.4}>{text}</Text>
      <View style={styles.toolRow}>
        <Button label="Abbrechen" variant="quiet" onPress={onNo} style={styles.tool} />
        <Button label={yes} onPress={onYes} disabled={busy} style={styles.tool} testID={yesTestID} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: 10 },
  after: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 8 },
  afterLabel: { color: "rgba(255,255,255,0.4)", fontWeight: "800", letterSpacing: 1 },
  block: { marginTop: 12 },
  chip: { alignItems: "center", borderRadius: radius.sm, borderWidth: 1, columnGap: 6, flexDirection: "row", flexShrink: 0, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  clock: { marginTop: 8 },
  confirm: { backgroundColor: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)", borderRadius: radius.sm, borderWidth: 1, gap: 8, marginTop: 10, padding: 10 },
  confirmText: { color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 18 },
  dot: { backgroundColor: roles.live, borderRadius: 4, height: 7, width: 7 },
  empty: { color: "rgba(255,255,255,0.45)", fontSize: 14, marginTop: 12 },
  eyebrow: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  header: { alignItems: "center", columnGap: 8, flexDirection: "row", justifyContent: "space-between" },
  hintBox: { backgroundColor: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.sm, borderWidth: 1, color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 8, paddingHorizontal: 10, paddingVertical: 8 },
  line: { color: "rgba(255,255,255,0.6)", flexShrink: 1, fontSize: 12 },
  lineCalled: { color: roles.brand },
  lineRow: { alignItems: "flex-start", columnGap: 6, flexDirection: "row", marginTop: 4 },
  name: { color: "#FFFFFF", flexShrink: 1, fontSize: 14, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  next: { backgroundColor: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.1)", borderRadius: radius.sm, borderWidth: 1, marginTop: 12, padding: 10 },
  nextCalled: { backgroundColor: "rgba(41,182,232,0.05)", borderColor: "rgba(41,182,232,0.4)" },
  quiet: { color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 8 },
  tile: { backgroundColor: surfaces.s1, borderColor: "rgba(255,255,255,0.1)", borderRadius: radius.md, borderWidth: 1, padding: 12 },
  tileBroken: { borderColor: "rgba(255,159,67,0.4)" },
  tool: { flex: 1 },
  toolRow: { columnGap: 8, flexDirection: "row" },
  tools: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, gap: 10, marginTop: 12, paddingTop: 12 },
  warnBox: { backgroundColor: "rgba(255,159,67,0.05)", borderColor: "rgba(255,159,67,0.3)", color: roles.warn },
  what: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
  who: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
});
