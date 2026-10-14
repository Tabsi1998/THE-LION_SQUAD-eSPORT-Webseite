import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { flashStyle } from "./motion";

// Bewegung im Turnierbaum mit Liebe zum Detail (#1563, Fabian 14.10.): federnd wie der Rest der App (Federn der
// Erfolgs-Zeremonie), nur transform und opacity, alles auf dem UI-Thread (Reanimated, kein setState je Bild).
// - SpringIn: wer weiterkommt, gleitet von links in seine Zeile (gestaffelt), dazu ein kurzes Aufleuchten.
// - PopIn: Platzziffern springen leicht auf, nacheinander.
// - CountUp: Spielstände zählen hoch.
// - PressScale: leichtes Eindrücken beim Tippen auf Namen und Karten.
// „Bewegung reduzieren“: alles steht sofort am Ende, nur das Eindrücken bleibt (es ist Rückmeldung, keine Bewegung).

const SPRING = { stiffness: 260, damping: 20 };
const POP_SPRING = { stiffness: 420, damping: 16 };

export function SpringIn({ delay, reduce, style, children }: { delay: number; reduce: boolean; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const progress = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      progress.set(1);
      return undefined;
    }
    progress.set(withDelay(delay, withSpring(1, SPRING)));
    return () => cancelAnimation(progress);
    // Einmal je Einhängen - der Schlüssel des Ereignisses hängt die Zeile neu ein.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.get() * 1.5),
    transform: [{ translateX: (1 - progress.get()) * -18 }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

export function PopIn({ delay, reduce, children }: { delay: number; reduce: boolean; children: React.ReactNode }) {
  const progress = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      progress.set(1);
      return undefined;
    }
    progress.set(withDelay(delay, withSpring(1, POP_SPRING)));
    return () => cancelAnimation(progress);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.get() * 2),
    transform: [{ scale: 0.6 + 0.4 * progress.get() }],
  }));
  return <Animated.View style={animated}>{children}</Animated.View>;
}

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

/** Ein Spielstand zählt hoch (0 → 3) - nur ganze Zahlen; sonst springt er nur auf. */
export function CountUp({ value, delay, reduce, style }: { value: string; delay: number; reduce: boolean; style: StyleProp<TextStyle> }) {
  const target = /^\d{1,4}$/.test(value) ? Number(value) : NaN;
  const count = useSharedValue(Number.isFinite(target) && !reduce ? 0 : target || 0);
  useEffect(() => {
    if (!Number.isFinite(target) || reduce) return undefined;
    count.set(withDelay(delay, withTiming(target, { duration: Math.min(520, 180 + target * 60), easing: Easing.out(Easing.cubic) })));
    return () => cancelAnimation(count);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animatedProps = useAnimatedProps(() => ({ text: String(Math.round(count.get())), defaultValue: String(Math.round(count.get())) }) as never);
  if (!Number.isFinite(target) || reduce) return <Animated.Text style={style}>{value}</Animated.Text>;
  return (
    <AnimatedInput
      editable={false}
      accessible={false}
      importantForAccessibility="no"
      underlineColorAndroid="transparent"
      defaultValue={value}
      value={undefined}
      style={[style, styles.input]}
      animatedProps={animatedProps}
    />
  );
}

/** Kurzes Aufleuchten über einer Zeile oder Karte (frisches Ergebnis, Weiterkommen). */
export function Flash({ reduce, delay = 0, color }: { reduce: boolean; delay?: number; color: string }) {
  if (reduce) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color }, flashStyle(delay)]} />;
}

/** Leichtes Eindrücken beim Tippen (unter 150 ms, wie die Knöpfe der App). */
export function PressScale({ style, innerStyle, children, ...props }: PressableProps & { style?: StyleProp<ViewStyle>; innerStyle?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      {...props}
      onPressIn={(event) => { setPressed(true); props.onPressIn?.(event); }}
      onPressOut={(event) => { setPressed(false); props.onPressOut?.(event); }}
      style={style}
    >
      <Animated.View style={[innerStyle, { transform: [{ scale: pressed ? 0.97 : 1 }], opacity: pressed ? 0.85 : 1, transitionProperty: ["transform", "opacity"], transitionDuration: 120 }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: { margin: 0, padding: 0 },
});
