import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, type StyleProp, type ViewStyle } from "react-native";
import { MOTION, motionEasing, staggerMs } from "../lib/motion";

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

// Dauer und Versatz aus den Bewegungs-Regeln (#1085): wie im Web (240 ms, 70 ms je Stelle, höchstens acht Stufen).
export const FADE_MS = MOTION.mid;

/** Versatz für Listen: die ersten Zeilen bauen sich leicht nacheinander auf, danach nicht mehr. */
export function staggerDelay(index: number): number {
  return staggerMs(index);
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
    const animation = Animated.timing(value, { toValue: 1, duration: FADE_MS, delay, easing: motionEasing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [delay, reduce, trigger, value]);

  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={[style, { opacity: value, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/**
 * Gestaffelte Listen (#1085), wie im Web: jede Zeile blendet beim ersten Erscheinen ein, die ersten Stellen
 * nacheinander. Der Screen merkt sich, welche Zeilen schon zu sehen waren - Live-Aktualisieren, Ziehen zum
 * Aktualisieren, Filter und Suche blenden sie nicht noch einmal ein. „Bewegung reduzieren“ fragt der Screen einmal ab
 * (nicht jede Zeile für sich): wenn die Liste nach dem Laden erscheint, steht die Antwort schon fest.
 */
export type ListEntrance = { reduce: boolean; seen: Set<string> };

export function useListEntrance(): ListEntrance {
  const reduce = useReduceMotion();
  const [seen] = useState(() => new Set<string>());
  return useMemo(() => ({ reduce, seen }), [reduce, seen]);
}

/**
 * Eine Zeile einer gestaffelten Liste. `id` ist je Screen eindeutig (dieselbe Kennung gilt als schon gezeigt), `index`
 * die Stelle in ihrer Liste: Versatz `staggerMs(index)`, höchstens acht Stufen.
 */
export function ListItemFadeIn({ entrance, id, index, children }: { entrance: ListEntrance; id: string; index: number; children: React.ReactNode }) {
  const { reduce, seen } = entrance;
  // Beim ersten Zeichnen festgelegt: ob die Zeile neu ist, und ihr Versatz. Rückt sie später an eine andere Stelle
  // (oben kommt ein Eintrag dazu), beginnt nichts von vorn.
  const [plan] = useState(() => ({ fresh: !reduce && !seen.has(id), delay: staggerMs(index) }));
  const [value] = useState(() => new Animated.Value(plan.fresh ? 0 : 1));
  const settled = useRef(!plan.fresh);

  useEffect(() => {
    seen.add(id);
  }, [id, seen]);

  useEffect(() => {
    if (settled.current || reduce) {
      settled.current = true;
      value.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(value, { toValue: 1, duration: FADE_MS, delay: plan.delay, easing: motionEasing, useNativeDriver: true });
    animation.start(({ finished }) => {
      if (finished) settled.current = true;
    });
    return () => animation.stop();
  }, [plan, reduce, value]);

  const style = useMemo(() => ({ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }), [value]);
  return <Animated.View style={style}>{children}</Animated.View>;
}
