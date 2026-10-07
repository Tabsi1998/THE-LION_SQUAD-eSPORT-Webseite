import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Line, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { REST_MS, createRest } from "../cardLift";
import { easeDegrees, easeFrames } from "../frames";
import { useCardLift } from "../useCardLift";
import { BAND_HEIGHT, COLORS, GLOW, glowRadius, wirePath, type Bulb, type BulbColor, type ChainLayout } from "./lights";
import { SWING, blinkFrames, swingPlan, type SwingPlan } from "./swing";

// Die Lichterkette in der App (S11, #642): dasselbe Bild wie im Web (LightChain.jsx) - Draht, Nägel, Fassungen als
// ein stilles Bild; jedes Lämpchen als zwei kleine Ebenen (Schein unter dem Draht, Kolben darüber) im selben Takt.
// Bewegt wird nur die Deckkraft von Kästen, die genau auf dem Lämpchen sitzen - die Bauweise, die auf Android sauber
// läuft (siehe Kranz). Jede Runde läuft als native Schleife, ohne JavaScript je Bild. Der Wind lässt die ganze Kette
// minimal schwingen. Nie klickbar. Nachschwingen (Jahreszeiten IV, #1091, wie im Web): wird die Karte angetippt, an der
// die Kette hängt, hängt der Draht kurz tiefer durch und federt zweimal nach (eine Ebene, deren Mitte auf der
// Nagellinie liegt, wird gestaucht - Android dreht und staucht Ansichten um ihre Mitte), die Lämpchen ziehen mit und
// pendeln, ein Licht flackert einmal (swing.ts).

/** Wie hoch die Ebene ist: das Band plus der Schein der untersten Lämpchen. */
export const LAYER_HEIGHT = BAND_HEIGHT + GLOW;
export const SWAY_MS = 7000;
export const SWAY_PX = 1.2;
export const FLICKER_MS = 11000;

/** Seltenes Flackern wie im Web: ein kurzer doppelter Aussetzer gegen Ende einer Runde von elf Sekunden. */
export function flickerCurve(brightness: number): { inputRange: number[]; outputRange: number[] } {
  return { inputRange: [0, 0.88, 0.9, 0.92, 0.94, 0.96, 1], outputRange: [brightness, brightness, 0.25, brightness, 0.4, brightness, brightness] };
}

/**
 * Eine Runde von `low` über `high` zurück zu `low` als Kosinus - wie `ease-in-out` hin und zurück im Web, aber als eine
 * gleichmäßige Zeit von 0 bis 1, damit die Schleife ganz nativ laufen kann.
 */
export function pulseCurve(low: number, high: number, steps = 8): { inputRange: number[]; outputRange: number[] } {
  const inputRange = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  return { inputRange, outputRange: inputRange.map((t) => Math.round((low + ((high - low) * (1 - Math.cos(2 * Math.PI * t))) / 2) * 1000) / 1000) };
}

/** glimmer: Glimmen und Wind; still: ruhig leuchtend (Screen nicht im Blick); subtle: „dezent“ - ruhig, etwas gedämpft. */
export type ChainMode = "glimmer" | "still" | "subtle";

/** Deckkraft von Schein und Kolben in Ruhe - wie die Grundwerte im Web (ohne Animation bzw. „dezent“). */
export function restingOpacity(bulb: Pick<Bulb, "brightness">, mode: ChainMode): { glow: number; body: number } {
  return mode === "subtle" ? { glow: 0.9, body: 0.9 } : { glow: Math.round(bulb.brightness * 0.8 * 100) / 100, body: bulb.brightness };
}

/**
 * Wann ein Lämpchen mit seiner Runde beginnt (ms): im Web startet das Glimmen mit negativem Versatz mitten in der
 * Runde - hier wartet es, bis die Runde dort wieder anfängt; flackernde Lämpchen warten ihren eigenen Versatz.
 */
export function bulbStartDelay(bulb: Pick<Bulb, "flicker" | "flickerDelay" | "glowDuration" | "glowDelay">): number {
  if (bulb.flicker) return Math.round(bulb.flickerDelay * 1000);
  const cycle = Math.max(1, Math.round(bulb.glowDuration * 1000));
  return (cycle - (Math.round(Math.abs(bulb.glowDelay) * 1000) % cycle)) % cycle;
}

/** Ein runder Schein in einer Farbe - auch für die Lichterfolge der Grußkarte. */
export function GlowDot({ radius, color, id }: { radius: number; color: BulbColor; id: string }) {
  const hex = COLORS[color];
  return (
    <Svg width={radius * 2} height={radius * 2} viewBox={`${-radius} ${-radius} ${radius * 2} ${radius * 2}`}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={hex} stopOpacity={0.55} />
          <Stop offset="0.5" stopColor={hex} stopOpacity={0.16} />
          <Stop offset="1" stopColor={hex} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={0} cy={0} r={radius} fill={`url(#${id})`} />
    </Svg>
  );
}

/** Ein Takt je Lämpchen, für Schein und Kolben gemeinsam: Glimmen in seiner Dauer oder alle elf Sekunden ein Flackern. */
function useBulbPulses(bulbs: Bulb[], mode: ChainMode): Animated.Value[] {
  const pulses = useMemo(() => bulbs.map(() => new Animated.Value(0)), [bulbs]);
  useEffect(() => {
    if (mode !== "glimmer") {
      pulses.forEach((pulse) => {
        pulse.stopAnimation();
        pulse.setValue(0);
      });
      return undefined;
    }
    const handles: Array<ReturnType<typeof setTimeout>> = [];
    const animations = bulbs.map((bulb, index) => {
      const duration = bulb.flicker ? FLICKER_MS : Math.max(1, Math.round(bulb.glowDuration * 1000));
      const animation = Animated.loop(Animated.timing(pulses[index], { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
      handles.push(setTimeout(() => animation.start(), bulbStartDelay(bulb)));
      return animation;
    });
    return () => {
      handles.forEach((handle) => clearTimeout(handle));
      animations.forEach((animation) => animation.stop());
    };
  }, [bulbs, mode, pulses]);
  return pulses;
}

function opacityOf(bulb: Bulb, mode: ChainMode, pulse: Animated.Value, layer: "glow" | "body"): number | Animated.AnimatedInterpolation<number> {
  if (mode !== "glimmer") return restingOpacity(bulb, mode)[layer];
  if (bulb.flicker) return pulse.interpolate(flickerCurve(bulb.brightness));
  return pulse.interpolate(layer === "glow" ? pulseCurve(bulb.brightness * 0.55, bulb.brightness * 0.95) : pulseCurve(bulb.brightness * 0.85, 1));
}

type Opacity = number | Animated.AnimatedInterpolation<number> | Animated.AnimatedMultiplication<number>;
type Motion = { translateY: Animated.AnimatedInterpolation<number>; rotate: Animated.AnimatedInterpolation<string> } | null;

function BulbGlow({ bulb, opacity, motion = null }: { bulb: Bulb; opacity: Opacity; motion?: Motion }) {
  const r = glowRadius(bulb);
  return (
    <Animated.View pointerEvents="none" style={[styles.layer, { left: bulb.x - r, top: bulb.y - r, width: r * 2, height: r * 2, opacity }, motion ? { transform: [{ translateY: motion.translateY }] } : null]}>
      <GlowDot radius={r} color={bulb.color} id={`xmasGlow${bulb.index}`} />
    </Animated.View>
  );
}

function BulbBody({ bulb, opacity, motion = null, blink = false }: { bulb: Bulb; opacity: Opacity; motion?: Motion; blink?: boolean }) {
  const r = bulb.radius;
  const box = r + 1;
  return (
    <Animated.View pointerEvents="none" style={[styles.layer, { left: bulb.x - box, top: bulb.y - box, width: box * 2, height: box * 2, opacity }, motion ? { transform: [{ translateY: motion.translateY }, { rotate: motion.rotate }] } : null]} testID="christmas-bulb" data-blink={blink ? "1" : undefined}>
      <Svg width={box * 2} height={box * 2} viewBox={`${-box} ${-box} ${box * 2} ${box * 2}`}>
        <Ellipse cx={0} cy={0} rx={r * 0.85} ry={r} fill={COLORS[bulb.color]} />
        <Ellipse cx={-r * 0.3} cy={-r * 0.35} rx={r * 0.28} ry={r * 0.4} fill="rgba(255, 255, 255, 0.55)" />
      </Svg>
    </Animated.View>
  );
}

/** Draht (mit feinem Glanz), Nägel, Stiele und Fassungen - ein stilles Bild. */
function Wire({ layout }: { layout: ChainLayout }) {
  const shine = useMemo(() => wirePath(layout.segments, 0.4), [layout.segments]);
  return (
    <Svg width={layout.width} height={LAYER_HEIGHT} viewBox={`0 0 ${layout.width} ${LAYER_HEIGHT}`} style={styles.layer}>
      <Path d={layout.wire} fill="none" stroke="#2f2f2f" strokeWidth={1.2} strokeLinecap="round" />
      <Path d={shine} fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth={0.5} strokeLinecap="round" />
      {layout.nails.map((x, index) => <Circle key={index} cx={x} cy={1.2} r={1.3} fill="#8a8a8a" />)}
      {layout.bulbs.map((bulb) => (
        <G key={bulb.index}>
          <Line x1={bulb.x} y1={bulb.wire} x2={bulb.x} y2={bulb.y - bulb.radius} stroke="#3b3b3b" strokeWidth={1.1} strokeLinecap="round" />
          <Rect x={bulb.x - 1.1} y={bulb.y - bulb.radius - 1.6} width={2.2} height={1.8} rx={0.4} fill="#2a2a2a" />
        </G>
      ))}
    </Svg>
  );
}

/** Ein Nachschwingen (#1091): der Plan aus swing.ts und der Fortschritt von 0 bis 1 (nativer Treiber). */
export type ChainSwing = { n: number; plan: SwingPlan; progress: Animated.Value };

/** So lange ruht eine Karte nach dem Nachschwingen ihrer Kette (kleine Reaktion, wie im Web). */
const swingRest = createRest(REST_MS.small);

/** Nur für Tests: die Ruhezeiten vergessen. */
export function resetChainSwing() {
  swingRest.clear();
}

/**
 * Nachschwingen (#1091): wird die Karte `cardKey` angetippt (Karten-Signal), schwingt ihre Kette einmal nach -
 * höchstens alle zehn Sekunden je Karte, nichts mit „Bewegung reduzieren“ (dann gibt es kein Signal).
 */
export function useChainSwing(cardKey: string | null, layout: ChainLayout | null): ChainSwing | null {
  const progress = useRef(new Animated.Value(0)).current;
  const [swing, setSwing] = useState<ChainSwing | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useCardLift((detail) => {
    const current = layoutRef.current;
    if (!cardKey || detail.key !== cardKey || !current || !current.bulbs.length || !swingRest.take(cardKey)) return;
    const n = Date.now();
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: SWING.ms, easing: Easing.linear, useNativeDriver: true }).start();
    setSwing({ n, plan: swingPlan(current.bulbs, `${cardKey}:${n}`), progress });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setSwing(null);
    }, SWING.ms + 60);
  }, Boolean(cardKey && layout && layout.bulbs.length));
  return swing;
}

const SWING_INPUT = SWING.keys.map(([t]) => t);

/** Wie ein Lämpchen beim Nachschwingen mitzieht und pendelt. */
function bulbMotion(swing: ChainSwing | null, index: number): Motion {
  const entry = swing ? swing.plan.bulbs.find((item) => item.index === index) : null;
  if (!swing || !entry) return null;
  return {
    translateY: swing.progress.interpolate(easeFrames(SWING_INPUT, SWING.keys.map(([, v]) => v * entry.h))),
    rotate: swing.progress.interpolate(easeDegrees(SWING_INPUT, SWING.keys.map(([, v]) => Math.round((v / SWING.keys[1][1]) * entry.tilt * 1000) / 1000))),
  };
}

/** Das eine Licht flackert: seine Helligkeit mal einen Faktor, der kurz zweimal einbricht. */
function blinked(opacity: Opacity, swing: ChainSwing | null, index: number): Opacity {
  if (!swing || swing.plan.blink !== index) return opacity;
  const frames = blinkFrames();
  if (typeof opacity === "number") return swing.progress.interpolate({ inputRange: frames.inputRange, outputRange: frames.outputRange.map((value) => Math.round(value * opacity * 1000) / 1000) });
  return Animated.multiply(opacity, swing.progress.interpolate(frames));
}

/**
 * Die Kette über ihre Breite: Schein, Draht, Kolben. `wind` (Faktor aus dem Wetter, sonst 0,6) lässt sie in sieben
 * Sekunden um höchstens 1,2 Punkte je Windstärke hin- und herschwingen - nur, solange sie glimmt. `swing`: sie schwingt
 * gerade nach (#1091).
 */
export function LightChain({ layout, mode, wind = 0.6, swing = null }: { layout: ChainLayout; mode: ChainMode; wind?: number; swing?: ChainSwing | null }) {
  const pulses = useBulbPulses(layout.bulbs, mode);
  const sway = useRef(new Animated.Value(0.25)).current;
  const amplitude = SWAY_PX * Math.max(0, Math.min(2, Number.isFinite(wind) ? wind : 0.6));
  useEffect(() => {
    if (mode !== "glimmer" || amplitude <= 0) {
      sway.stopAnimation();
      sway.setValue(0.25);
      return undefined;
    }
    sway.setValue(0);
    const animation = Animated.loop(Animated.timing(sway, { toValue: 1, duration: SWAY_MS, easing: Easing.linear, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [mode, amplitude, sway]);
  // Von links über rechts zurück nach links - in Ruhe (0,25) steht die Kette in der Mitte.
  const translateX = sway.interpolate(pulseCurve(-amplitude, amplitude));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.chain, { width: layout.width, opacity: mode === "subtle" ? 0.9 : 1, transform: [{ translateX }] }]}
      testID="christmas-lights"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {layout.bulbs.map((bulb, index) => <BulbGlow key={`glow-${bulb.index}`} bulb={bulb} opacity={blinked(opacityOf(bulb, mode, pulses[index], "glow"), swing, bulb.index)} motion={bulbMotion(swing, bulb.index)} />)}
      {swing ? (
        // Der Draht federt um die Nagellinie (y = 1): die Ebene ist doppelt so hoch und steht mit ihrer Mitte darauf.
        <Animated.View pointerEvents="none" style={[styles.sag, { width: layout.width, transform: [{ scaleY: swing.progress.interpolate(easeFrames(SWING_INPUT, SWING.keys.map(([, v]) => 1 + v))) }] }]} testID="christmas-chain-swing">
          <View style={[styles.sagWire, { width: layout.width }]}>
            <Wire layout={layout} />
          </View>
        </Animated.View>
      ) : <Wire layout={layout} />}
      {layout.bulbs.map((bulb, index) => <BulbBody key={`body-${bulb.index}`} bulb={bulb} opacity={blinked(opacityOf(bulb, mode, pulses[index], "body"), swing, bulb.index)} motion={bulbMotion(swing, bulb.index)} blink={Boolean(swing && swing.plan.blink === bulb.index)} />)}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chain: { height: LAYER_HEIGHT },
  layer: { position: "absolute", left: 0, top: 0 },
  // Mitte auf der Nagellinie (y = 1): oben LAYER_HEIGHT darüber, unten der Draht.
  sag: { position: "absolute", left: 0, top: 1 - LAYER_HEIGHT, height: LAYER_HEIGHT * 2 },
  sagWire: { position: "absolute", left: 0, top: LAYER_HEIGHT - 1, height: LAYER_HEIGHT },
});
