import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { clockLabel, matchClock, serverNow, type ClockTone, type MatchClockInfo } from "../../lib/matchClock";
import { useSeason } from "../../seasons/SeasonProvider";
import { colors, motion, roles } from "../../theme";
import { glowSequence, useReduceMotion } from "../motion";

// Spielzeit-Uhr in der App (#1167, #2393): „12:34 / 30 Min.“ mit Balken - dieselbe Rechnung wie im Web (lib/matchClock)
// und dieselben Farben (Fabians Auswahl vom 07.10., „Jede Farbe hat eine Aufgabe“): Rot gehört allein „läuft“, der Balken
// ist ruhig in der Markenfarbe; ab 80 % wird die Uhr orange („knapp“), ab 100 % steht die Zeit orange gefüllt mit dem
// Warn-Symbol („Zeit überschritten“). Ohne Dauer nur die laufende Zeit. Gezählt wird nach der Serverzeit (Abstand aus der
// Antwort, sonst aus dem Saison-Kontext). In der Turnierpause steht die Uhr („Pause“).
// Detail-Runde (nur transform und opacity): Die orange Füllung liegt über dem Balken und blendet weich ein, die Farbe der
// Zeit wechselt über übereinanderliegende Schriften, die sich überblenden - kein Sprung. Beim Wechsel leuchtet die Spur
// einmal auf, das Warn-Symbol wächst klein herein. Mit „Bewegung reduzieren“ springen die Zustände und der Balken
// springt minutenweise.

const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);
const OVER_TEXT = "#0C0C0C";

/** Die Uhr eines Spiels nach der Serverzeit, jede Sekunde neu - steht still, solange die Pause läuft. */
export function useMatchClock(
  startedAt: string | null | undefined,
  durationMinutes: number | null | undefined,
  { pausedAt = null, pausedSeconds = 0, offset = null }: { pausedAt?: string | null; pausedSeconds?: number | null; offset?: number | null } = {},
): MatchClockInfo | null {
  const { serverOffset } = useSeason();
  const reduce = useReduceMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || pausedAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, pausedAt]);
  return matchClock(startedAt, durationMinutes, serverNow(offset ?? serverOffset, now), { stepped: reduce, pausedAt, pausedSeconds });
}

type Levels = { warn: SharedValue<number>; over: SharedValue<number>; flare: SharedValue<number>; flareTone: "warn" | "over" | ""; animate: boolean };

/** Wie weit die Uhr orange ist (`warn`) bzw. orange gefüllt (`over`) - weich, außer beim ersten Zeichnen und mit „Bewegung reduzieren“. */
function useToneLevels(tone: ClockTone, reduce: boolean): Levels {
  const warnTarget = tone === "warn" || tone === "over" ? 1 : 0;
  const overTarget = tone === "over" ? 1 : 0;
  const warn = useSharedValue(warnTarget);
  const over = useSharedValue(overTarget);
  const flare = useSharedValue(0);
  const first = useRef(true);
  const [flareTone, setFlareTone] = useState<"warn" | "over" | "">("");
  useEffect(() => {
    if (first.current || reduce) {
      first.current = false;
      warn.value = warnTarget;
      over.value = overTarget;
      return;
    }
    warn.value = withTiming(warnTarget, { duration: motion.slow, easing: ease });
    over.value = withTiming(overTarget, { duration: motion.mid, easing: ease });
    if (warnTarget) {
      // Einmal aufleuchten - der Wechsel von „knapp“ zu „überschritten“ leuchtet erneut.
      setFlareTone(overTarget ? "over" : "warn");
      flare.value = 0;
      flare.value = glowSequence();
    }
    // Nur ein neuer Zustand startet den Wechsel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tone, reduce]);
  return { warn, over, flare, flareTone, animate: !reduce && !first.current };
}

/** Das Warn-Symbol: wächst beim Erscheinen klein herein (nur transform/opacity). */
function WarnIcon({ size, color, animate, testID }: { size: number; color: string; animate: boolean; testID?: string }) {
  const [plan] = useState(animate);
  const shown = useSharedValue(plan ? 0 : 1);
  useEffect(() => {
    if (plan) shown.value = withTiming(1, { duration: motion.mid, easing: ease });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: 0.6 + 0.4 * shown.value }] }));
  return (
    <Animated.View style={style} testID={testID}>
      <Ionicons name="warning" size={size} color={color} />
    </Animated.View>
  );
}

/**
 * Die Zeit selbst: ruhig in der Farbe der Zeile, knapp orange, überschritten dunkel auf orange mit Warn-Symbol. Die drei
 * Farben liegen übereinander und blenden sich über - die Füllung kommt ohne Sprung dazu (feste Innenkante).
 */
function ClockTime({ info, levels, textStyle, baseColor, testID }: { info: MatchClockInfo; levels: Levels; textStyle: StyleProp<TextStyle>; baseColor: string; testID?: string }) {
  const fill = useAnimatedStyle(() => ({ opacity: levels.over.value }));
  const base = useAnimatedStyle(() => ({ opacity: 1 - levels.warn.value }));
  const warn = useAnimatedStyle(() => ({ opacity: Math.max(0, levels.warn.value - levels.over.value) }));
  const over = useAnimatedStyle(() => ({ opacity: levels.over.value }));
  const size = Math.round(((StyleSheet.flatten(textStyle)?.fontSize as number) || 15) * 0.8);
  return (
    <View style={styles.time}>
      {info.tone === "over" ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fill, fill]} /> : null}
      {info.tone === "over" ? <WarnIcon size={size} color={OVER_TEXT} animate={levels.animate} testID={testID ? `${testID}-warn` : undefined} /> : null}
      <View>
        <Animated.Text style={[textStyle, styles.tabular, { color: baseColor }, base]} maxFontSizeMultiplier={1.3} testID={testID ? `${testID}-time` : undefined}>{info.text}</Animated.Text>
        {info.tone === "warn" || info.tone === "over" ? (
          <Animated.Text style={[textStyle, styles.tabular, styles.layer, { color: roles.warn }, warn]} maxFontSizeMultiplier={1.3} accessible={false} importantForAccessibility="no">{info.text}</Animated.Text>
        ) : null}
        {info.tone === "over" ? (
          <Animated.Text style={[textStyle, styles.tabular, styles.layer, { color: OVER_TEXT }, over]} maxFontSizeMultiplier={1.3} accessible={false} importantForAccessibility="no">{info.text}</Animated.Text>
        ) : null}
      </View>
    </View>
  );
}

/** Die Uhr mit Balken - für die Stationen im Cockpit (`md`) und die Liste „läuft“ der Turnierleitung (`sm`). */
export function MatchClock({ startedAt, durationMinutes, pausedAt = null, pausedSeconds = 0, offset = null, size = "md", style, testID = "match-clock" }: {
  startedAt?: string | null;
  durationMinutes?: number | null;
  pausedAt?: string | null;
  pausedSeconds?: number | null;
  offset?: number | null;
  size?: "md" | "sm";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const info = useMatchClock(startedAt, durationMinutes, { pausedAt, pausedSeconds, offset });
  const reduce = useReduceMotion();
  const levels = useToneLevels(info?.tone || "none", reduce);
  const warnFill = useAnimatedStyle(() => ({ opacity: levels.warn.value }));
  const flare = useAnimatedStyle(() => ({ opacity: levels.flare.value }));
  if (!info) return null;
  const small = size === "sm";
  return (
    <View style={style} accessible accessibilityRole="timer" accessibilityLabel={clockLabel(info)} testID={testID}>
      <View style={styles.row}>
        <ClockTime info={info} levels={levels} textStyle={small ? styles.timeSmall : styles.timeLarge} baseColor={colors.white} testID={testID} />
        {info.limit ? <Text style={[styles.limit, small && styles.limitSmall]} maxFontSizeMultiplier={1.3}>/ {info.limit}</Text> : null}
        {info.paused ? <Text style={[styles.paused, small && styles.limitSmall]} maxFontSizeMultiplier={1.3} testID={`${testID}-paused`}>PAUSE</Text> : null}
        {info.tone === "over" && info.overMinutes ? <Text style={[styles.overMinutes, small && styles.limitSmall]} maxFontSizeMultiplier={1.3}>+{info.overMinutes} Min.</Text> : null}
      </View>
      {info.ratio !== null ? (
        <View style={[styles.track, small && styles.trackSmall]}>
          <View style={[styles.bar, { transform: [{ scaleX: info.ratio }] }]} testID={`${testID}-bar`}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.barWarn, warnFill]} />
          </View>
          {levels.flareTone ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, levels.flareTone === "over" ? styles.flareOver : styles.flareWarn, flare]} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Die Uhr in einer Textzeile (Turnierbaum): nur die Zeit, ohne Balken - dieselbe Rechnung und dieselben Farben. Ruhig
 * (und ohne Dauer) bleibt sie in der Farbe ihrer Zeile - rot heißt dort „läuft“.
 */
export function InlineMatchClock({ startedAt, durationMinutes = null, pausedAt = null, pausedSeconds = 0, style, testID }: {
  startedAt?: string | null;
  durationMinutes?: number | null;
  pausedAt?: string | null;
  pausedSeconds?: number | null;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const info = useMatchClock(startedAt, durationMinutes, { pausedAt, pausedSeconds });
  const reduce = useReduceMotion();
  const levels = useToneLevels(info?.tone || "none", reduce);
  if (!info) return null;
  const color = (StyleSheet.flatten(style)?.color as string) || colors.white;
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={clockLabel(info)} testID={testID}>
      <ClockTime info={info} levels={levels} textStyle={style} baseColor={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: roles.brand, borderRadius: 999, height: "100%", overflow: "hidden", transformOrigin: "left center", width: "100%" },
  barWarn: { backgroundColor: roles.warn },
  fill: { backgroundColor: roles.warn, borderRadius: 3 },
  flareOver: { backgroundColor: "rgba(255,255,255,0.5)" },
  flareWarn: { backgroundColor: "rgba(255,159,67,0.55)" },
  layer: { left: 0, position: "absolute", top: 0 },
  limit: { color: "rgba(255,255,255,0.55)", fontSize: 12 },
  limitSmall: { fontSize: 11 },
  overMinutes: { color: roles.warn, fontSize: 12, fontWeight: "800", marginLeft: "auto" },
  paused: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  row: { alignItems: "baseline", columnGap: 8, flexDirection: "row", flexWrap: "wrap" },
  tabular: { fontVariant: ["tabular-nums"] },
  time: { alignItems: "center", borderRadius: 3, columnGap: 3, flexDirection: "row", marginLeft: -4, paddingHorizontal: 4 },
  timeLarge: { fontSize: 24, fontWeight: "800" },
  timeSmall: { fontSize: 14, fontWeight: "800" },
  track: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999, height: 4, marginTop: 6, overflow: "hidden" },
  trackSmall: { height: 3, marginTop: 4 },
});
