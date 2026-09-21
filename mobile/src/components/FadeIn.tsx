import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

// Sanfte Übergänge (#218): Inhalt blendet kurz ein, statt zu springen. Keine Dauer-Animation,
// und wer am Handy „Bewegung reduzieren“ / „Animationen entfernen“ eingestellt hat, bekommt
// den Inhalt sofort.

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (active) setReduce(Boolean(value)); })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => setReduce(Boolean(value)));
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);
  return reduce;
}

export const FADE_MS = 220;
const STEP_MS = 40;
const MAX_STEPS = 6;

/** Versatz für Listen: die ersten Zeilen bauen sich leicht nacheinander auf, danach nicht mehr. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index), MAX_STEPS) * STEP_MS;
}

export function FadeIn({ children, delay = 0, trigger, style }: {
  children: React.ReactNode;
  delay?: number;
  /** Ändert sich der Wert (z. B. der aktive Reiter), blendet der Inhalt neu ein. */
  trigger?: unknown;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      value.setValue(1);
      return undefined;
    }
    value.setValue(0);
    const animation = Animated.timing(value, { toValue: 1, duration: FADE_MS, delay, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [delay, reduce, trigger, value]);

  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={[style, { opacity: value, transform: [{ translateY }] }]}>{children}</Animated.View>;
}
