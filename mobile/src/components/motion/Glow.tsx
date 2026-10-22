import React, { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { glowTones, micro, motion } from "../../theme";
import { useReduceMotion } from "./useReduceMotion";

// Baustein „Aufleuchten“ (#1969, vereint GlowOnce aus #1974): ein Abzeichen oder neuer Wert leuchtet einmal kurz auf -
// Pole, Bestzeit, neuer Platz. Wie `.tls-glow` im Web: in 840 ms (MICRO.glow) blendet ein Schein in der Farbe der Rolle
// auf (35 %) und wieder aus. Die Ebene liegt über ihrem Eltern-Element (absolut, fängt keine Tipps ab) - das Element
// darunter braucht dafür nichts außer seinem Platz.
// - `active`: leuchtet beim ersten Zeichnen (etwa am Ende des Hochzählens, versetzt mit `delay`).
// - `trigger`: leuchtet bei jeder Änderung danach (Reiterwechsel, Live-Nachladen), nie beim ersten Zeichnen.
// - `tone`: brand (Vorgabe), honor, ok, pole, fastest - oder eine eigene Farbe `color` mit eigener Stärke `peak`.
// Bewegt wird nur die Deckkraft; mit „Bewegung reduzieren“ nichts.

export type GlowTone = keyof typeof glowTones;

const RISE = 0.35;
export const GLOW_IN_MS = Math.round(micro.glow * RISE);
export const GLOW_OUT_MS = micro.glow - GLOW_IN_MS;
const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

/** Die Folge fürs einmalige Aufleuchten: 0 → 1 → 0 in MICRO.glow, nach `delay`. */
export function glowSequence(delay = 0) {
  return withDelay(Math.max(0, delay), withSequence(
    withTiming(1, { duration: GLOW_IN_MS, easing: ease }),
    withTiming(0, { duration: GLOW_OUT_MS, easing: ease }),
  ));
}

export function Glow({ active = false, trigger, tone = "brand", color, peak = 0.16, delay = 0, radius = 6, testID }: {
  active?: boolean;
  trigger?: unknown;
  tone?: GlowTone;
  color?: string;
  peak?: number;
  delay?: number;
  radius?: number;
  testID?: string;
}) {
  const reduce = useReduceMotion();
  const level = useSharedValue(0);
  const first = useRef(true);
  const still = useRef(reduce);
  still.current = reduce;

  useEffect(() => {
    const opening = first.current;
    first.current = false;
    if (still.current || (opening && !active)) return undefined;
    level.value = 0;
    level.value = glowSequence(delay);
    return () => cancelAnimation(level);
    // Nur das erste Zeichnen und ein neuer `trigger` lassen leuchten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const style = useAnimatedStyle(() => ({ opacity: level.value * peak }));
  if (reduce) return null;
  return (
    <Animated.View
      pointerEvents="none"
      testID={testID}
      style={[StyleSheet.absoluteFill, { backgroundColor: color || glowTones[tone] || glowTones.brand, borderRadius: radius }, style]}
    />
  );
}
