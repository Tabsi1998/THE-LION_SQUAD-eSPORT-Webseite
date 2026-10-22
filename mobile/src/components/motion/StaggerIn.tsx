import React, { useEffect, useRef, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { micro, motion } from "../../theme";
import { useReduceMotion } from "./useReduceMotion";

// Baustein „gestaffelt erscheinen“ (#1969, wie StaggerIn im Web): die Einträge einer Liste steigen beim ersten Zeichnen
// nacheinander leise auf - je 50 ms (MICRO.stagger), 8 Punkte, 420 ms, nur Verschieben und Deckkraft. Nur die ersten
// zwölf (MICRO.staggerMax) staffeln, der Rest steht sofort. Danach ist Ruhe: Einträge, die beim Live-Nachladen dazukommen,
// stehen ohne Bewegung da. „Bewegung reduzieren“ und `play={false}`: sofort.
// Jedes Kind bekommt eine eigene Hülle (Animated.View) - Kinder, die `flex` brauchen, geben es der Hülle über `itemStyle`.

const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

/** Versatz des Eintrags an Stelle `index` - oder null, wenn er nicht staffelt (ab dem dreizehnten). */
export function staggerInDelay(index: number): number | null {
  if (index < 0 || index >= micro.staggerMax) return null;
  return index * micro.stagger;
}

function StaggerItem({ delay, style, children }: { delay: number | null; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  // Beim ersten Zeichnen festgelegt: ob der Eintrag aufsteigt - spätere Änderungen beginnen nichts von vorn.
  const [plan] = useState(() => delay);
  const shown = useSharedValue(plan === null ? 1 : 0);
  useEffect(() => {
    if (plan === null) return;
    shown.value = withDelay(plan, withTiming(1, { duration: motion.slow, easing: ease }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const animated = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 8 }] }));
  if (plan === null) return <View style={style}>{children}</View>;
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

export function StaggerIn({ children, play = true, style, itemStyle, testID }: {
  children: React.ReactNode;
  play?: boolean;
  style?: StyleProp<ViewStyle>;
  itemStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const reduce = useReduceMotion();
  // Nur was beim ersten Zeichnen da ist, staffelt.
  const opening = useRef(true);
  useEffect(() => {
    opening.current = false;
  }, []);
  const staggers = opening.current && play && !reduce;
  let index = -1;
  return (
    <View style={style} testID={testID}>
      {React.Children.map(children, (child) => {
        if (child === null || child === undefined || typeof child === "boolean") return child;
        index += 1;
        return <StaggerItem delay={staggers ? staggerInDelay(index) : null} style={itemStyle}>{child}</StaggerItem>;
      })}
    </View>
  );
}
