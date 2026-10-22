import * as Haptics from "expo-haptics";
import React, { useCallback } from "react";
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { PRESS_SCALE } from "../../lib/motion";
import { motion } from "../../theme";
import { useReduceMotion } from "./useReduceMotion";

// Baustein „Drücken“ (#1969, wie Press im Web): Karten, Kacheln und Chips, die man antippt, geben beim Drücken leicht
// nach (98 %, 150 ms) und federn beim Loslassen zurück - nur Skalieren, auf dem UI-Thread. `haptic` gibt beim Antippen
// eine leichte Vibration dazu (expo-haptics folgt der Einstellung des Handys). „Bewegung reduzieren“: die Fläche bleibt
// still, die Vibration bleibt (sie ist keine Bewegung auf dem Bildschirm).

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

/** Leichte Vibration beim Antippen - scheitert sie (kein Motor, Test), passiert nichts. */
export function tapFeedback() {
  try {
    void Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
  } catch {
    // ohne Vibration weiter
  }
}

type Props = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
  /** Wie weit die Fläche nachgibt (Vorgabe 0,98). */
  scale?: number;
};

export function Press({ style, haptic = false, scale = PRESS_SCALE, onPressIn, onPressOut, onPress, children, ...rest }: Props) {
  const reduce = useReduceMotion();
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: 1 - (1 - scale) * pressed.value }] }));
  const pressIn = useCallback((event: GestureResponderEvent) => {
    if (!reduce) pressed.value = withTiming(1, { duration: motion.fast, easing: ease });
    onPressIn?.(event);
  }, [onPressIn, pressed, reduce]);
  const pressOut = useCallback((event: GestureResponderEvent) => {
    pressed.value = reduce ? 0 : withTiming(0, { duration: motion.mid, easing: ease });
    onPressOut?.(event);
  }, [onPressOut, pressed, reduce]);
  const press = useCallback((event: GestureResponderEvent) => {
    if (haptic) tapFeedback();
    onPress?.(event);
  }, [haptic, onPress]);
  return (
    <AnimatedPressable {...rest} onPressIn={pressIn} onPressOut={pressOut} onPress={press} style={[style, animated]}>
      {children}
    </AnimatedPressable>
  );
}
