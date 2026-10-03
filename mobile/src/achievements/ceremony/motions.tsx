import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

/** Strahlen wie im Web (Kegel-Verlauf): schmale Keile von 8° alle 22,5°, in einem SVG - nichts überlagert sich. */
export function beamPath(radius = 260, count = 16, wedge = 8): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const from = ((i * 360) / count - wedge / 2) * (Math.PI / 180);
    const to = ((i * 360) / count + wedge / 2) * (Math.PI / 180);
    parts.push(`M 0 0 L ${(Math.cos(from) * radius).toFixed(1)} ${(Math.sin(from) * radius).toFixed(1)} L ${(Math.cos(to) * radius).toFixed(1)} ${(Math.sin(to) * radius).toFixed(1)} Z`);
  }
  return parts.join(" ");
}
const BEAMS = beamPath();

// Erfolge II (E13, #623): elf Auftritte - wie das Abzeichen auf die Bühne kommt, je Kategorie einer, wie im
// Web (motions.jsx): Einschlag, Pokalhebung, Vorbeifahrt, Kalenderblätter, zwei Hälften, Sprechblasen, „LIVE“,
// Karte, Fahne, Vorhang, Rauch. Jede Bewegung bekommt das fertige Abzeichen und den Akzent und zeichnet nur
// die Kulisse und die Bewegung drumherum. Bei „Bewegung reduzieren“ blendet nur das Abzeichen ein.

const SPRING = { stiffness: 260, damping: 18 };

type MotionProps = { badge: React.ReactNode; accent: string };

/** Ein Wert, der beim Erscheinen von `from` zu seinem Ablauf startet. */
function useEnter(from: number, run: (value: SharedValue<number>) => void) {
  const value = useSharedValue(from);
  useEffect(() => {
    run(value);
    // Der Ablauf läuft genau einmal beim Erscheinen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

/** Spielen: Einschlag von oben mit Bodenwelle und Staub. */
function Impact({ badge, accent }: MotionProps) {
  const y = useEnter(-260, (v) => { v.value = withDelay(100, withSpring(0, { stiffness: 420, damping: 16 })); });
  const scale = useEnter(1.25, (v) => { v.value = withDelay(100, withSpring(1, { stiffness: 420, damping: 16 })); });
  const rot = useEnter(-8, (v) => { v.value = withDelay(100, withSpring(0, { stiffness: 420, damping: 16 })); });
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { scale: scale.value }, { rotate: `${rot.value}deg` }] }));
  return (
    <>
      <Wave delay={380} accent={accent} />
      <Wave delay={550} accent={accent} />
      {[-70, -40, 40, 70].map((x, i) => <Dust key={x} x={x} lift={-12 - i * 4} delay={400 + i * 30} />)}
      <Animated.View style={[styles.front, badgeStyle]}>{badge}</Animated.View>
    </>
  );
}

function Wave({ delay, accent }: { delay: number; accent: string }) {
  const t = useEnter(0, (v) => { v.value = withDelay(delay, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) })); });
  const style = useAnimatedStyle(() => ({ opacity: t.value === 0 ? 0 : 0.9 * (1 - t.value), transform: [{ scaleX: 0.4 + 5.6 * t.value }, { scaleY: 0.4 + 5.6 * t.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.wave, { borderColor: accent }, style]} />;
}

function Dust({ x, lift, delay }: { x: number; lift: number; delay: number }) {
  const t = useEnter(0, (v) => { v.value = withDelay(delay, withTiming(1, { duration: 800 })); });
  const style = useAnimatedStyle(() => ({ opacity: t.value < 0.5 ? t.value * 1.6 : (1 - t.value) * 1.6, transform: [{ translateX: x * t.value }, { translateY: lift * t.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.dust, style]} />;
}

/** Turnier: Pokalhebung - von unten hoch, kurz über die Mitte, dann setzen; dahinter drehen Strahlen. */
function Lift({ badge, accent }: MotionProps) {
  const y = useEnter(200, (v) => { v.value = withDelay(100, withSequence(withTiming(-26, { duration: 700, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 400 }))); });
  const scale = useEnter(0.6, (v) => { v.value = withDelay(100, withSequence(withTiming(1.08, { duration: 700 }), withTiming(1, { duration: 400 }))); });
  const opacity = useEnter(0, (v) => { v.value = withDelay(100, withTiming(1, { duration: 300 })); });
  const spin = useEnter(0, (v) => { v.value = withRepeat(withTiming(360, { duration: 16000, easing: Easing.linear }), -1, false); });
  const badgeStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }, { scale: scale.value }] }));
  const beamStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.beams, beamStyle]} testID="ceremony-beams">
        <Svg width={520} height={520} viewBox="-260 -260 520 520">
          <Path d={BEAMS} fill={accent} fillOpacity={0.1} />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.front, badgeStyle]}>{badge}</Animated.View>
    </>
  );
}

/** Fast Lap: Vorbeifahrt - von links mit Bremsspur und Geschwindigkeitslinien, dann Halt in der Mitte. */
function Driveby({ badge, accent }: MotionProps) {
  const x = useEnter(-420, (v) => { v.value = withDelay(100, withSequence(withTiming(30, { duration: 560, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 190 }))); });
  const rot = useEnter(-6, (v) => { v.value = withDelay(100, withSequence(withTiming(3, { duration: 560 }), withTiming(0, { duration: 190 }))); });
  const skid = useEnter(0, (v) => { v.value = withDelay(350, withTiming(1, { duration: 400 })); });
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { rotate: `${rot.value}deg` }] }));
  const skidStyle = useAnimatedStyle(() => ({ opacity: 0.8 * skid.value, width: `${50 * skid.value}%` }));
  return (
    <>
      {[30, 46, 62].map((top, i) => <SpeedLine key={top} top={top} delay={50 + i * 70} accent={accent} />)}
      <Animated.View pointerEvents="none" style={[styles.skid, skidStyle]} />
      <Animated.View style={[styles.front, badgeStyle]}>{badge}</Animated.View>
    </>
  );
}

function SpeedLine({ top, delay, accent }: { top: number; delay: number; accent: string }) {
  const t = useEnter(0, (v) => { v.value = withDelay(delay, withTiming(1, { duration: 600 })); });
  const style = useAnimatedStyle(() => ({ opacity: t.value < 0.5 ? t.value * 1.6 : (1 - t.value) * 1.6, transform: [{ translateX: -260 + 620 * t.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.speedline, { top: `${top}%`, backgroundColor: accent }, style]} />;
}

/** Saison: drei Kalenderblätter blättern um, dann das Abzeichen. */
function Flip({ badge, accent }: MotionProps) {
  const scale = useEnter(0.4, (v) => { v.value = withDelay(1050, withSpring(1, SPRING)); });
  const opacity = useEnter(0, (v) => { v.value = withDelay(1050, withTiming(1, { duration: 250 })); });
  const tilt = useEnter(60, (v) => { v.value = withDelay(1050, withSpring(0, SPRING)); });
  const badgeStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ perspective: 600 }, { rotateX: `${tilt.value}deg` }, { scale: scale.value }] }));
  return (
    <>
      {[0, 1, 2].map((i) => <Page key={i} index={i} accent={accent} />)}
      <Animated.View style={[styles.front, badgeStyle]}>{badge}</Animated.View>
    </>
  );
}

function Page({ index, accent }: { index: number; accent: string }) {
  const t = useEnter(0, (v) => { v.value = withDelay(150 + index * 280, withTiming(1, { duration: 550, easing: Easing.in(Easing.quad) })); });
  const style = useAnimatedStyle(() => ({ opacity: 1 - t.value, transform: [{ perspective: 600 }, { translateY: -52 }, { rotateX: `${-180 * t.value}deg` }, { translateY: 52 }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.page, { zIndex: 3 - index, marginLeft: index * 4, marginTop: index * 4 }, style]}>
      <View style={[styles.pageHead, { backgroundColor: accent }]} />
    </Animated.View>
  );
}

/** Team: zwei Hälften schieben sich zusammen, das Abzeichen wächst aus der Naht. */
function Merge({ badge, accent }: MotionProps) {
  const scale = useEnter(0, (v) => { v.value = withDelay(750, withSpring(1, SPRING)); });
  const badgeStyle = useAnimatedStyle(() => ({ opacity: scale.value > 0.01 ? 1 : 0, transform: [{ scale: scale.value }] }));
  return (
    <>
      <Half side="left" accent={accent} />
      <Half side="right" accent={accent} />
      <Animated.View style={[styles.front, badgeStyle]}>{badge}</Animated.View>
    </>
  );
}

function Half({ side, accent }: { side: "left" | "right"; accent: string }) {
  const t = useEnter(0, (v) => { v.value = withTiming(1, { duration: 1100 }); });
  const from = side === "left" ? -220 : 220;
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.4 ? t.value / 0.4 : t.value > 0.8 ? (1 - t.value) / 0.2 : 1,
    transform: [{ translateX: from * Math.max(0, 1 - t.value / 0.6) }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.half, side === "left" ? styles.halfLeft : styles.halfRight, { borderColor: accent, backgroundColor: `${accent}4D` }, style]} />;
}

/** Community: Sprechblasen sammeln sich von unten zum Abzeichen. */
const BUBBLES = ["GG", "nice", "wp", "gl hf", "❤", "lol"];
function Bubbles({ badge, accent }: MotionProps) {
  const scale = useEnter(0.3, (v) => { v.value = withDelay(850, withSpring(1, SPRING)); });
  const opacity = useEnter(0, (v) => { v.value = withDelay(850, withTiming(1, { duration: 250 })); });
  const badgeStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return (
    <>
      {BUBBLES.map((text, i) => <Bubble key={text} text={text} index={i} accent={accent} />)}
      <Animated.View style={[styles.front, badgeStyle]}>{badge}</Animated.View>
    </>
  );
}

function Bubble({ text, index, accent }: { text: string; index: number; accent: string }) {
  const t = useEnter(0, (v) => { v.value = withDelay(50 + index * 100, withTiming(1, { duration: 1100 })); });
  const rise = -90 - (index % 3) * 20;
  const drift = (index - 2.5) * -18;
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.5 ? t.value * 2 : (1 - t.value) * 2,
    transform: [{ translateY: 40 + (rise - 40) * t.value }, { translateX: drift * t.value }, { scale: 0.7 + 0.3 * Math.sin(Math.PI * t.value) }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.bubble, { left: `${10 + index * 14}%`, borderColor: `${accent}99`, backgroundColor: `${accent}40` }, style]}>
      <Text style={styles.bubbleText}>{text}</Text>
    </Animated.View>
  );
}

/** Streaming: „LIVE“-Schild und Scanlines, das Abzeichen schaltet sich wie ein Bild auf. */
function Live({ badge }: MotionProps) {
  const t = useEnter(0, (v) => { v.value = withDelay(300, withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) })); });
  const blink = useEnter(1, (v) => { v.value = withRepeat(withSequence(withTiming(1, { duration: 600 }), withTiming(0.35, { duration: 0 }), withTiming(0.35, { duration: 600 }), withTiming(1, { duration: 0 })), -1, false); });
  const badgeStyle = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ scaleY: 0.02 + 0.98 * t.value }, { scaleX: 1.4 - 0.4 * t.value }] }));
  const tagStyle = useAnimatedStyle(() => ({ opacity: blink.value }));
  return (
    <>
      <View pointerEvents="none" style={styles.scanlines}>
        {Array.from({ length: 40 }, (_, i) => <View key={i} style={styles.scanline} />)}
      </View>
      <Animated.View pointerEvents="none" style={[styles.liveTag, tagStyle]}>
        <Text style={styles.liveText}>LIVE</Text>
      </Animated.View>
      <Animated.View style={[styles.front, badgeStyle]}>{badge}</Animated.View>
    </>
  );
}

/** Profil: eine Karte zeichnet sich, die Zeilen füllen sich, das Abzeichen rutscht in den Avatar-Platz. */
function Card({ badge, accent }: MotionProps) {
  const frame = useEnter(0, (v) => { v.value = withTiming(1, { duration: 400 }); });
  const x = useEnter(-120, (v) => { v.value = withDelay(300, withSpring(0, SPRING)); });
  const opacity = useEnter(0, (v) => { v.value = withDelay(300, withTiming(1, { duration: 250 })); });
  const frameStyle = useAnimatedStyle(() => ({ opacity: frame.value, transform: [{ scale: 0.9 + 0.1 * frame.value }] }));
  const badgeStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: x.value - 62 }] }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.cardFrame, { borderColor: `${accent}99` }, frameStyle]}>
        {[0, 1, 2].map((i) => <CardLine key={i} index={i} accent={accent} />)}
      </Animated.View>
      <Animated.View style={[styles.front, badgeStyle]}>{badge}</Animated.View>
    </>
  );
}

function CardLine({ index, accent }: { index: number; accent: string }) {
  const t = useEnter(0, (v) => { v.value = withDelay(450 + index * 150, withTiming(1, { duration: 350 })); });
  const full = 112 - index * 24;
  const style = useAnimatedStyle(() => ({ width: full * t.value }));
  return <Animated.View style={[styles.cardLine, { top: 46 + index * 22, backgroundColor: `${accent}73` }, style]} />;
}

/** Verein: die Fahne mit dem Abzeichen schwingt von oben herein. */
function Banner({ badge }: MotionProps) {
  const swing = useEnter(-95, (v) => { v.value = withSequence(withTiming(12, { duration: 550, easing: Easing.out(Easing.quad) }), withTiming(-6, { duration: 330 }), withTiming(0, { duration: 220 })); });
  const opacity = useEnter(0, (v) => { v.value = withTiming(1, { duration: 300 }); });
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ perspective: 800 }, { translateY: -110 }, { rotateX: `${swing.value}deg` }, { translateY: 110 }] }));
  return (
    <Animated.View style={[styles.bannerHolder, style]}>
      <View pointerEvents="none" style={styles.flag}>
        <View style={styles.flagTip} />
      </View>
      <View style={styles.bannerBadge}>{badge}</View>
    </Animated.View>
  );
}

/** Besonders: Vorhang und Scheinwerfer. */
function Curtain({ badge, accent }: MotionProps) {
  const open = useEnter(0, (v) => { v.value = withDelay(250, withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) })); });
  const scale = useEnter(0.7, (v) => { v.value = withDelay(600, withSpring(1, SPRING)); });
  const opacity = useEnter(0, (v) => { v.value = withDelay(600, withTiming(1, { duration: 300 })); });
  const sway = useEnter(-3, (v) => { v.value = withRepeat(withTiming(3, { duration: 3000, easing: Easing.inOut(Easing.quad) }), -1, true); });
  const badgeStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  const curtainStyle = useAnimatedStyle(() => ({ width: `${52 - 50 * open.value}%` }));
  const spotStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${sway.value}deg` }] }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.spot, spotStyle]}>
        <View style={[styles.spotCone, { backgroundColor: `${accent}26` }]} />
        <View style={[styles.spotCore, { backgroundColor: `${accent}33` }]} />
      </Animated.View>
      <Animated.View style={[styles.mid, badgeStyle]}>{badge}</Animated.View>
      <Animated.View pointerEvents="none" style={[styles.curtain, styles.curtainLeft, curtainStyle]}><CurtainFolds /></Animated.View>
      <Animated.View pointerEvents="none" style={[styles.curtain, styles.curtainRight, curtainStyle]}><CurtainFolds /></Animated.View>
    </>
  );
}

function CurtainFolds() {
  return (
    <View style={styles.folds}>
      {Array.from({ length: 10 }, (_, i) => <View key={i} style={[styles.fold, { backgroundColor: i % 2 ? "#8A1912" : "#6B0F0A" }]} />)}
    </View>
  );
}

/** Geheim: Enthüllung aus Rauch, das Fragezeichen dreht sich weg. */
function Smoke({ badge }: MotionProps) {
  const reveal = useEnter(0, (v) => { v.value = withDelay(800, withTiming(1, { duration: 900 })); });
  const turn = useEnter(0, (v) => { v.value = withDelay(500, withTiming(1, { duration: 600 })); });
  const badgeStyle = useAnimatedStyle(() => ({ opacity: reveal.value, transform: [{ scale: 0.85 + 0.15 * reveal.value }] }));
  const questionStyle = useAnimatedStyle(() => ({ opacity: 1 - turn.value, transform: [{ perspective: 400 }, { rotateY: `${90 * turn.value}deg` }] }));
  return (
    <>
      {[[-70, 10, 120], [40, -20, 150], [-10, 30, 170], [70, 20, 110]].map(([x, y, size], i) => <Puff key={i} x={x} y={y} size={size} index={i} />)}
      <Animated.View style={[styles.mid, badgeStyle]}>{badge}</Animated.View>
      <Animated.View pointerEvents="none" style={[styles.overlay, questionStyle]}>
        <Text style={styles.question}>?</Text>
      </Animated.View>
    </>
  );
}

function Puff({ x, y, size, index }: { x: number; y: number; size: number; index: number }) {
  const t = useEnter(0, (v) => { v.value = withDelay(200 + index * 100, withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) })); });
  const style = useAnimatedStyle(() => ({
    opacity: 0.9 * (1 - t.value),
    transform: [{ translateX: x + (index - 1.5) * 40 * t.value }, { translateY: y - 60 * t.value }, { scale: 0.6 + 1.3 * t.value }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.puff, { width: size, height: size, borderRadius: size / 2, marginLeft: -size / 2, marginTop: -size / 2 }, style]}>
      <View style={[styles.puffCore, { borderRadius: size / 2 }]} />
    </Animated.View>
  );
}

/** Nur Einblenden - bei „Bewegung reduzieren“. */
function Fade({ badge }: MotionProps) {
  const opacity = useEnter(0, (v) => { v.value = withTiming(1, { duration: 400 }); });
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.front, style]}>{badge}</Animated.View>;
}

export const MOTION_COMPONENTS: Record<string, (props: MotionProps) => React.ReactElement> = {
  impact: Impact, lift: Lift, driveby: Driveby, flip: Flip, merge: Merge, bubbles: Bubbles, live: Live, card: Card, banner: Banner, curtain: Curtain, smoke: Smoke,
};

export function Motion({ motion, badge, accent, reduced = false }: { motion: string; badge: React.ReactNode; accent: string; reduced?: boolean }) {
  const Component = reduced ? Fade : MOTION_COMPONENTS[motion] || Impact;
  return (
    <View style={styles.stage} testID={`ceremony-motion-${reduced ? "fade" : MOTION_COMPONENTS[motion] ? motion : "impact"}`}>
      <Component badge={badge} accent={accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  front: { zIndex: 2 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", zIndex: 2 },
  mid: { zIndex: 1 },
  wave: { position: "absolute", bottom: "14%", width: 40, height: 14, borderRadius: 20, borderWidth: 2 },
  dust: { position: "absolute", bottom: "18%", width: 12, height: 12, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.25)" },
  beams: { position: "absolute", width: 520, height: 520 },
  skid: { position: "absolute", bottom: "22%", left: "8%", height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.28)", transform: [{ skewX: "-30deg" }] },
  speedline: { position: "absolute", left: 0, width: "40%", height: 2, borderRadius: 1 },
  page: { position: "absolute", width: 88, height: 104, borderRadius: 4, backgroundColor: "#ECECEC", overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 8, elevation: 6 },
  pageHead: { height: 16 },
  half: { position: "absolute", width: 80, height: 160, borderWidth: 1 },
  halfLeft: { right: "50%", borderTopLeftRadius: 80, borderBottomLeftRadius: 80 },
  halfRight: { left: "50%", borderTopRightRadius: 80, borderBottomRightRadius: 80 },
  bubble: { position: "absolute", bottom: "8%", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  bubbleText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  scanlines: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "space-between", opacity: 0.6 },
  scanline: { height: 1, backgroundColor: "rgba(255,255,255,0.05)" },
  liveTag: { position: "absolute", top: 14, alignSelf: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2, backgroundColor: "#FF3B30" },
  liveText: { color: "#fff", fontSize: 10, fontWeight: "900", letterSpacing: 3 },
  cardFrame: { position: "absolute", width: 256, height: 144, borderWidth: 1, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.02)" },
  cardLine: { position: "absolute", left: 120, height: 6, borderRadius: 3 },
  bannerHolder: { alignItems: "center", justifyContent: "flex-start", zIndex: 2 },
  flag: { position: "absolute", top: -30, width: 176, height: 150, backgroundColor: "#9A140C", borderTopLeftRadius: 2, borderTopRightRadius: 2, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 12, elevation: 8 },
  flagTip: { position: "absolute", bottom: -40, left: 0, width: 0, height: 0, borderLeftWidth: 88, borderRightWidth: 88, borderTopWidth: 40, borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: "#9A140C" },
  bannerBadge: { paddingTop: 6 },
  spot: { position: "absolute", top: -40, width: "70%", height: "140%", alignItems: "center" },
  spotCone: { width: "100%", height: "100%", borderBottomLeftRadius: 999, borderBottomRightRadius: 999 },
  spotCore: { position: "absolute", top: "35%", width: "55%", height: "45%", borderRadius: 999 },
  curtain: { position: "absolute", top: 0, bottom: 0, zIndex: 3, overflow: "hidden" },
  curtainLeft: { left: 0 },
  curtainRight: { right: 0 },
  folds: { flex: 1, flexDirection: "row" },
  fold: { flex: 1 },
  question: { color: "#C084FC", fontSize: 64, fontWeight: "900" },
  puff: { position: "absolute", left: "50%", top: "50%", overflow: "hidden" },
  puffCore: { flex: 1, backgroundColor: "rgba(168,85,247,0.30)" },
});
