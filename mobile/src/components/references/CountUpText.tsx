import React, { useEffect, useMemo } from "react";
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { COUNT_UP_MS, countFrame, countShape } from "../../lib/referenceRound";

// Zeiten zählen hoch (#1950, #1974), wie im Web (components/tls/motion/CountUp.jsx): ruhig auslaufend in 900 ms, je Zeile
// leicht versetzt, auf dem UI-Thread (Reanimated) - der Text wechselt Bild für Bild in derselben Form („00:00,000“ bis
// „31:55,056“), die Ziffern mit fester Breite. Neu gezählt wird beim Öffnen und bei jedem Reiterwechsel (`playKey`),
// nicht beim stillen Nachladen. Wörter („+1 Runde“, „Ausfall“), „–“ und Null stehen sofort da; mit „Bewegung
// reduzieren“ alles. Vorleser hören nur den Endwert.

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

export function CountUpText({ text, playKey, delay = 0, style, testID }: {
  text: string;
  /** Ändert sich der Wert (Runde, Reiter), zählt die Zeit neu hoch. */
  playKey: string;
  delay?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const reduce = useReducedMotion();
  const shape = useMemo(() => countShape(text), [text]);
  const animate = Boolean(shape) && !reduce;
  // Beginnt bei null - so blitzt der Endwert vor dem Zählen nie auf.
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      return undefined;
    }
    progress.value = 0;
    progress.value = withDelay(Math.max(0, delay), withTiming(1, { duration: COUNT_UP_MS, easing: Easing.linear }));
    return () => cancelAnimation(progress);
    // Nur beim Öffnen und Reiterwechsel - ein neuer Wert beim Nachladen steht sofort da.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, animate]);

  const animatedProps = useAnimatedProps(() => ({ text: countFrame(shape, progress.value) }) as unknown as Partial<React.ComponentProps<typeof TextInput>>);

  if (!animate) {
    return <Text style={[styles.text, style]} testID={testID}>{text}</Text>;
  }
  return (
    <View accessible accessibilityLabel={text} testID={testID}>
      <AnimatedInput
        editable={false}
        pointerEvents="none"
        underlineColorAndroid="transparent"
        defaultValue={countFrame(shape, 0)}
        animatedProps={animatedProps}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.text, styles.input, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontVariant: ["tabular-nums"] },
  input: { includeFontPadding: false, margin: 0, paddingBottom: 0, paddingHorizontal: 0, paddingTop: 0 },
});
