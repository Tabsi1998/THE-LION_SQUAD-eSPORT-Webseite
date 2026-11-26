import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { ClipPath, Defs, G, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { crestTier, type CeremonyItem, type LeagueMoment } from "../../lib/leagueMoments";
import { colors, micro, motion, radius, roles, surfaces } from "../../theme";
import { Button } from "../Button";
import { tapFeedback, useReduceMotion } from "../motion";
import { CREST_METALS, CrownArt, CupArt, FIELD_BOX, SHIELD, ShieldArt, crestNumberSize, type CrestMetal } from "./LeagueCrest";
import { CrestBadge } from "./LeagueCrest";
import { RewardMomentList } from "./RewardMomentList";

// Saisonende-Moment in der App (#2584, docs/LIGA.md „F.8 Saisonende-Moment“, Web: components/tls/league/moment/SeasonMoment.jsx und
// seasonMoment.css): Aufstieg, Abstieg oder Meister einmal als ruhige Karte im Stil der Belohnungs-Zeremonie. Texte vom Server.
//
// Detail-Runde - eine Zeitleiste aus den Tokens (theme.motion, micro), nur transform und opacity, alles auf dem UI-Thread:
// 1. Die Karte hebt sich und blendet ein (slow).
// 2. Aufstieg: Das Wappen hebt sich leicht über das Ziel hinaus und setzt sich. Meister: Der goldene Pokal hebt sich. Abstieg: Das
//    Wappen setzt sich ruhig von oben.
// 3. Die Zahl zählt um - Aufstieg: die alte steigt hinaus, die neue kommt von unten und federt leicht nach; Abstieg: ohne Nachfedern,
//    die neue sinkt ein. Wechselt die Stufe (schlicht, doppelter Rand, Krone), blendet die Form mit. Genau dann vibriert es einmal leicht.
// 4. Aufstieg in Liga 1: Die Krone setzt sich mit einem Hauch Nachgeben. Steigt Liga 1 ab, blendet die Krone still aus.
// 5. Aufstieg und Meister: Ein Glanz läuft einmal über Wappen bzw. Pokal, der Schein dahinter leuchtet einmal auf. Abstieg: kein Glanz.
// 6. Die Zeilen folgen gestaffelt (micro.stagger).
// „Bewegung reduzieren“: sofort der Endzustand - nur das Nachher, die neue Form, die Krone; die Vibration kommt gleich.
// Meister mit Belohnungen (Fabian 26.11., A): „Weiter“ zeigt die Belohnungen als zweite Karte in derselben Karte, ohne neues Aufpoppen.

const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);
const CREST = 96;
const UNIT = CREST / 64;

/** Die Zeitleiste in Millisekunden - dieselben Rechnungen wie die Variablen in seasonMoment.css. */
export const MOMENT_TIMELINE = {
  lift: motion.mid,
  count: motion.slow + motion.mid * 2,
  crown: motion.slow * 2 + motion.mid * 2,
  shine: motion.slow * 3 + motion.mid,
  lines: motion.slow * 2,
};
/** Wann die Vibration kommt: beim Zahlenwechsel bzw. wenn der Pokal oben ist. */
export function hapticDelay(outcome: LeagueMoment["outcome"], reduce: boolean): number {
  if (reduce) return 0;
  return outcome === "champion" ? MOMENT_TIMELINE.lift + Math.round(motion.slow * 1.6 * 0.6) : MOMENT_TIMELINE.count;
}

const METAL_OF: Record<LeagueMoment["outcome"], CrestMetal> = { champion: "gold", up: "cyan", down: "calm" };
const EDGE: Record<LeagueMoment["outcome"], string> = { champion: "rgba(255,215,0,0.45)", up: "rgba(41,182,232,0.45)", down: "rgba(148,163,184,0.4)" };
const ACCENT: Record<LeagueMoment["outcome"], string> = { champion: roles.honor, up: roles.brand, down: CREST_METALS.calm.base };

/** Stückweise linear zwischen Stützstellen - für Bewegungen mit Nachfedern (wie die Schlüsselbilder im Web). */
export function track(progress: number, stops: number[], values: number[]): number {
  "worklet";
  if (progress <= stops[0]) return values[0];
  for (let index = 1; index < stops.length; index += 1) {
    if (progress <= stops[index]) {
      const part = (progress - stops[index - 1]) / (stops[index] - stops[index - 1]);
      return values[index - 1] + (values[index] - values[index - 1]) * part;
    }
  }
  return values[values.length - 1];
}

/** Ein Fortschritt 0 → 1 nach `delay` in `duration` - ohne Bewegung gleich 1 (Endzustand). */
function useStep(play: boolean, delay: number, duration: number): SharedValue<number> {
  const value = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (!play) {
      value.value = 1;
      return undefined;
    }
    value.value = withDelay(delay, withTiming(1, { duration, easing: ease }));
    return () => cancelAnimation(value);
    // Einmal beim Erscheinen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);

function CrestNumber({ value, color, testID }: { value: number | null | undefined; color: string; testID: string }) {
  const fontSize = crestNumberSize(value, CREST);
  return (
    <Text allowFontScaling={false} style={[styles.number, { color, fontSize, lineHeight: fontSize * 1.15 }]} testID={testID}>{String(value ?? "")}</Text>
  );
}

/** Das Wappen mit Zahlenwechsel (Aufstieg, Abstieg). Vorher und Nachher liegen übereinander; ohne Bewegung steht nur das Nachher da. */
function MomentCrest({ moment, play }: { moment: LeagueMoment; play: boolean }) {
  const up = moment.outcome === "up";
  const metal = METAL_OF[moment.outcome];
  const paint = CREST_METALS[metal];
  const before = moment.badge_from?.level ?? moment.from?.level ?? null;
  const after = moment.badge_to?.level ?? moment.to?.level ?? null;
  const tierBefore = crestTier(before) || "base";
  const tierAfter = crestTier(after) || "base";
  const changes = before !== after;
  const T = MOMENT_TIMELINE;

  const lift = useStep(play, T.lift, up ? Math.round(motion.slow * 1.5) : motion.slow);
  const out = useStep(play, T.count, up ? motion.mid : motion.slow);
  const into = useStep(play, up ? T.count : T.count + motion.fast, up ? Math.round(motion.slow * 1.5) : motion.slow);
  const shape = useStep(play, T.count, motion.slow);
  const crown = useStep(play, up ? T.crown : T.count, up ? Math.round(motion.slow * 1.3) : motion.slow);
  const shine = useStep(play && up, T.shine, micro.glow);
  const glow = useStep(play && up, T.crown, micro.glow);

  const crestStyle = useAnimatedStyle(() => (up
    ? { opacity: track(lift.value, [0, 0.6, 1], [0, 1, 1]), transform: [{ translateY: track(lift.value, [0, 0.6, 1], [12, -5, 0]) }, { scale: track(lift.value, [0, 0.6, 1], [0.94, 1.03, 1]) }] }
    : { opacity: lift.value, transform: [{ translateY: (1 - lift.value) * -6 }] }));
  const fromNumber = useAnimatedStyle(() => ({ opacity: 1 - out.value, transform: [{ translateY: out.value * (up ? -18 : 12) * UNIT }] }));
  const toNumber = useAnimatedStyle(() => (up
    ? { opacity: track(into.value, [0, 0.55, 1], [0, 1, 1]), transform: [{ translateY: track(into.value, [0, 0.55, 0.8, 1], [18, -3, 1, 0]) * UNIT }] }
    : { opacity: into.value, transform: [{ translateY: (1 - into.value) * -12 * UNIT }] }));
  const fromShape = useAnimatedStyle(() => ({ opacity: 1 - shape.value }));
  const toShape = useAnimatedStyle(() => ({ opacity: shape.value }));
  const crownTo = useAnimatedStyle(() => ({ opacity: track(crown.value, [0, 0.5, 1], [0, 1, 1]), transform: [{ translateY: track(crown.value, [0, 0.7, 1], [-8, 1, 0]) * UNIT }, { scale: track(crown.value, [0, 0.7, 1], [0.9, 1.02, 1]) }] }));
  const crownFrom = useAnimatedStyle(() => ({ opacity: 1 - crown.value }));
  const shineProps = useAnimatedProps(() => ({ x: track(shine.value, [0, 1], [-14, 74]), opacity: track(shine.value, [0, 0.35, 1], [0, 0.5, 0]) }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: track(glow.value, [0, 0.35, 1], [0, 1, 0]) }));

  const field = { left: FIELD_BOX.x * UNIT, top: FIELD_BOX.y * UNIT, width: FIELD_BOX.width * UNIT, height: FIELD_BOX.height * UNIT };
  const numberColor = paint[tierAfter === "base" ? "base" : "light"];
  return (
    <Animated.View style={[styles.crest, crestStyle]} testID="season-moment-crest" data-metal={metal} data-tier={tierAfter}>
      {play && up ? (
        <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id="season-moment-glow" cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={paint.base} stopOpacity={0.5} />
                <Stop offset="1" stopColor={paint.base} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill="url(#season-moment-glow)" />
          </Svg>
        </Animated.View>
      ) : null}
      {play && tierBefore !== tierAfter ? (
        <Animated.View style={[StyleSheet.absoluteFill, fromShape]} testID="season-moment-shield-from"><ShieldArt tier={tierBefore} metal={metal} size={CREST} id="sm-from" /></Animated.View>
      ) : null}
      <Animated.View style={[StyleSheet.absoluteFill, play && tierBefore !== tierAfter ? toShape : null]}><ShieldArt tier={tierAfter} metal={metal} size={CREST} id="sm-to" /></Animated.View>
      {play && up ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="season-moment-shine">
          <Svg width={CREST} height={CREST * 1.25} viewBox="0 0 64 80">
            <Defs><ClipPath id="sm-shine-clip"><Path d={SHIELD} /></ClipPath></Defs>
            <G clipPath="url(#sm-shine-clip)">
              <AnimatedRect animatedProps={shineProps} y={10} width={10} height={76} fill="#FFFFFF" skewX={-18} />
            </G>
          </Svg>
        </View>
      ) : null}
      {/* Die Zahl zählt im Feld des Wappens um - wie ein Zählwerk. Das Feld schneidet ab, was hinaus- oder hereinkommt. */}
      <View style={[styles.field, field]}>
        {play && changes ? <Animated.View style={[styles.numberBox, fromNumber]}><CrestNumber value={before} color={numberColor} testID="season-moment-num-from" /></Animated.View> : null}
        <Animated.View style={[styles.numberBox, play && changes ? toNumber : null]}><CrestNumber value={after} color={numberColor} testID="season-moment-num-to" /></Animated.View>
      </View>
      {play && tierBefore === "top" && tierAfter !== "top" ? (
        <Animated.View style={[StyleSheet.absoluteFill, crownFrom]}><CrownArt metal={metal} size={CREST} id="sm-crown-from" /></Animated.View>
      ) : null}
      {tierAfter === "top" ? (
        <Animated.View style={[StyleSheet.absoluteFill, styles.crownOrigin, play && up ? crownTo : null]} testID="season-moment-crown"><CrownArt metal={metal} size={CREST} id="sm-crown-to" /></Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** Meister: goldener Pokal mit goldenem Abzeichen; der Pokal hebt sich, ein Glanz zieht darüber, der Schein dahinter leuchtet einmal. */
function ChampionStage({ moment, play }: { moment: LeagueMoment; play: boolean }) {
  const T = MOMENT_TIMELINE;
  const cup = useStep(play, T.lift, Math.round(motion.slow * 1.6));
  const halo = useStep(play, T.count, Math.round(micro.glow * 1.4));
  const shine = useStep(play, T.count, micro.glow);
  const badge = useStep(play, T.crown, motion.slow);
  const cupStyle = useAnimatedStyle(() => ({ opacity: track(cup.value, [0, 0.6, 1], [0, 1, 1]), transform: [{ translateY: track(cup.value, [0, 0.6, 1], [14, -4, 0]) }, { scale: track(cup.value, [0, 0.6, 1], [0.94, 1.03, 1]) }] }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: track(halo.value, [0, 0.35, 1], [0, 1, 0]) }));
  const shineProps = useAnimatedProps(() => ({ x: track(shine.value, [0, 1], [-20, 70]), opacity: track(shine.value, [0, 0.35, 1], [0, 0.55, 0]) }));
  const badgeStyle = useAnimatedStyle(() => ({ opacity: badge.value, transform: [{ translateY: (1 - badge.value) * 8 }] }));
  return (
    <View style={styles.trophy} testID="season-moment-trophy">
      <View>
        {play ? (
          <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none">
            <Svg width="100%" height="100%" viewBox="0 0 100 100">
              <Defs>
                <RadialGradient id="season-moment-halo" cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor={roles.honor} stopOpacity={0.45} />
                  <Stop offset="1" stopColor={roles.honor} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect x="0" y="0" width="100" height="100" fill="url(#season-moment-halo)" />
            </Svg>
          </Animated.View>
        ) : null}
        <Animated.View style={cupStyle}>
          <CupArt width={88} id="sm-cup" />
          {play ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="season-moment-shine">
              <Svg width={88} height={99} viewBox="0 0 64 72">
                <Defs><ClipPath id="sm-cup-clip"><Path d="M16 6h32v16a16 16 0 0 1-32 0z" /></ClipPath></Defs>
                <G clipPath="url(#sm-cup-clip)">
                  <AnimatedRect animatedProps={shineProps} y={0} width={12} height={40} fill="#FFFFFF" skewX={-18} />
                </G>
              </Svg>
            </View>
          ) : null}
        </Animated.View>
      </View>
      {moment.badge_to ? (
        <Animated.View style={[styles.trophyBadge, badgeStyle]}>
          <CrestBadge badge={moment.badge_to} size={40} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Eine Zeile der Karte - gestaffelt nach dem Wappen. */
function Line({ index, play, children }: { index: number; play: boolean; children: React.ReactNode }) {
  const shown = useStep(play, MOMENT_TIMELINE.lines + Math.min(index, micro.staggerMax) * micro.stagger, motion.slow);
  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 8 }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

export type SeasonMomentActions = {
  /** Geschlossen - `rewardsShown`: die zweite Karte mit den Belohnungen kam. */
  onClose: (rewardsShown: boolean) => void;
  onNextStep: (moment: LeagueMoment) => void;
  onFinal: (moment: LeagueMoment) => void;
};

/** Die Karte des Moments - im Modal des Zeremonie-Hosts. */
export function SeasonMomentCard({ item, onClose, onNextStep, onFinal }: { item: Extract<CeremonyItem, { kind: "moment" }> } & SeasonMomentActions) {
  const moment = item.moment;
  const reduce = useReduceMotion();
  const play = !reduce;
  const [step, setStep] = useState<"moment" | "rewards">("moment");
  const rewardsShown = useRef(false);
  const shown = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    shown.value = play ? withTiming(1, { duration: motion.slow, easing: ease }) : 1;
    // Leichte Vibration genau dann, wenn die Zahl wechselt bzw. der Pokal oben ist - einmal, nie die einzige Rückmeldung.
    const timer = setTimeout(tapFeedback, hapticDelay(moment.outcome, reduce));
    return () => clearTimeout(timer);
    // Einmal beim Erscheinen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rise = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 12 }, { scale: 0.97 + shown.value * 0.03 }] }));
  const texts = moment.texts || {};
  const rewards = item.rewards;
  const accent = ACCENT[moment.outcome];
  const close = () => onClose(rewardsShown.current);
  const advance = () => {
    if (rewards.length && step === "moment") {
      rewardsShown.current = true;
      setStep("rewards");
      return;
    }
    close();
  };
  const lines = useMemo(() => [
    texts.notice ? <Text key="notice" style={styles.notice} testID="season-moment-notice">{texts.notice}</Text> : null,
    texts.kicker ? <Text key="kicker" style={[styles.kicker, { color: accent }]} testID="season-moment-kicker">{texts.kicker}</Text> : null,
    <Text key="title" style={[styles.title, moment.outcome === "down" ? styles.titleCalm : null]} testID="season-moment-title">{texts.title}</Text>,
    texts.name ? <Text key="name" style={styles.name} testID="season-moment-name">{texts.name}</Text> : null,
    texts.meta ? <Text key="meta" style={styles.meta}>{texts.meta}</Text> : null,
    texts.line ? <Text key="line" style={styles.line} testID="season-moment-line">{texts.line}</Text> : null,
    texts.next ? <Text key="next" style={[styles.next, { color: moment.outcome === "down" ? "rgba(255,255,255,0.7)" : accent }]} testID="season-moment-next">{texts.next}</Text> : null,
  ].filter(Boolean) as React.ReactElement[], [accent, moment.outcome, texts]);
  const next = moment.next_step?.label ? moment.next_step : null;

  return (
    <Animated.View style={[styles.card, { borderColor: EDGE[moment.outcome] }, rise]} accessibilityViewIsModal testID="season-moment" data-outcome={moment.outcome}>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={10} style={styles.close} testID="season-moment-close">
        <Ionicons name="close" size={22} color={colors.white} />
      </Pressable>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} testID="season-moment-scroll">
        {step === "rewards" ? (
          <View style={styles.rewards} testID="season-moment-rewards">
            <Text style={[styles.kicker, { color: roles.honor }]}>{texts.meta}</Text>
            <Text style={styles.title} accessibilityRole="header">{rewards.length === 1 ? "Dazu eure Belohnung" : "Dazu eure Belohnungen"}</Text>
            <RewardMomentList rewards={rewards} />
          </View>
        ) : (
          <>
            {/* Das Wappen mit dem Zahlenwechsel ist Zier - Screenreader hören den ganzen Satz vom Server. */}
            <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {moment.outcome === "champion" ? <ChampionStage moment={moment} play={play} /> : <MomentCrest moment={moment} play={play} />}
            </View>
            <View style={styles.text} accessible accessibilityRole="header" accessibilityLabel={texts.aria || texts.line || texts.title || undefined} testID="season-moment-text">
              {lines.map((line, index) => <Line key={line.key} index={index} play={play}>{line}</Line>)}
            </View>
          </>
        )}
      </ScrollView>
      <View style={styles.actions}>
        {step === "rewards" ? (
          <Button label="Fertig" variant="secondary" arrow={false} onPress={close} testID="season-moment-finish" />
        ) : (
          <>
            {next ? <Button label={String(next.label)} onPress={() => onNextStep(moment)} testID="season-moment-next-step" /> : null}
            {moment.url ? <Button label="Endstand ansehen" variant="secondary" arrow={false} onPress={() => onFinal(moment)} testID="season-moment-final" /> : null}
            <Button label="Weiter" variant="secondary" arrow={false} onPress={advance} testID="season-moment-done" />
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: surfaces.s2, borderRadius: radius.lg, borderWidth: 1, gap: 12, maxHeight: "90%", maxWidth: 440, padding: 18, width: "100%" },
  close: { alignItems: "center", height: 44, justifyContent: "center", position: "absolute", right: 4, top: 4, width: 44, zIndex: 2 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingBottom: 2 },
  stage: { alignItems: "center", marginBottom: 14, marginTop: 8 },
  crest: { height: CREST * 1.25, width: CREST },
  glow: { bottom: "-6%", left: "-10%", position: "absolute", right: "-10%", top: "12%" },
  field: { overflow: "hidden", position: "absolute" },
  numberBox: { alignItems: "center", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  number: { fontWeight: "900", includeFontPadding: false, letterSpacing: -0.4, textAlign: "center" },
  crownOrigin: { transformOrigin: "50% 25.6%" },
  trophy: { alignItems: "flex-end", flexDirection: "row", gap: 12 },
  halo: { height: 112, left: -12, position: "absolute", top: -6, width: 112 },
  trophyBadge: { paddingBottom: 6 },
  text: { alignItems: "center", gap: 2 },
  notice: { alignSelf: "center", borderColor: "rgba(255,255,255,0.18)", borderRadius: 999, borderWidth: 1, color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "700", letterSpacing: 1.3, marginBottom: 8, paddingHorizontal: 10, paddingVertical: 3, textTransform: "uppercase" },
  kicker: { fontSize: 11, fontWeight: "900", letterSpacing: 1.6, textAlign: "center", textTransform: "uppercase" },
  title: { color: colors.white, fontSize: 24, fontWeight: "900", textAlign: "center", textTransform: "uppercase" },
  titleCalm: { fontSize: 20 },
  name: { color: colors.white, fontSize: 16, fontWeight: "800", marginTop: 4, textAlign: "center" },
  meta: { color: "rgba(255,255,255,0.6)", fontSize: 13, textAlign: "center" },
  line: { color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 20, marginTop: 12, textAlign: "center" },
  next: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, marginTop: 6, textAlign: "center", textTransform: "uppercase" },
  rewards: { gap: 10, paddingTop: 8 },
  actions: { gap: 8 },
});
