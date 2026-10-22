import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, { Easing, cancelAnimation, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { COUNT_UP_MS, countFrame, countShape, countStart, type CountValue } from "../../lib/countUp";
import { glowTones } from "../../theme";
import { textStyles } from "../Text";
import { glowSequence, type GlowTone } from "./Glow";
import { useReduceMotion } from "./useReduceMotion";

// Baustein „Hochzählen“ (#1950, #1974; der eine für die ganze App, #1969 - wie CountUp im Web): eine Zeit, ein Abstand
// oder eine Zahl läuft beim ersten Anzeigen von null - oder vom alten Wert `from` - auf den Wert: ruhig auslaufend in
// 900 ms (MICRO.count), in der Form des Endwerts und mit fester Ziffernbreite. Die Zwischenstände rechnet Reanimated auf
// dem UI-Thread; am Ende steht der Endwert als gewöhnlicher Text da.
// - `delay` versetzt den Start (etwa 25 ms je Zeile, `countDelay`), `playKey` spielt neu ab (Reiterwechsel).
// - Live-Nachladen: ein neuer Wert steht sofort da und leuchtet einmal kurz auf (`flash`, Farbe `tone`) - es zählt nie
//   neu und flackert nicht.
// - Texte, die nicht zählen („+2 Runden“, „Ausfall“, „–“), Null, `play={false}` und „Bewegung reduzieren“: sofort der
//   Endwert. Vorleser hören nur den Endwert. `onDone` meldet das Ende (etwa für ein Aufleuchten daneben).

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

type Props = {
  /** Text vom Server („1:24,587“, „+0,412“, „35“) oder eine Zahl. */
  value: CountValue;
  /** Zahl mit Tausenderpunkt („1.234“). */
  grouped?: boolean;
  /** Alter Wert, von dem aus gezählt wird. */
  from?: CountValue;
  /** Ändert sich der Wert (Runde, Reiter), zählt es neu hoch. */
  playKey?: string | number;
  delay?: number;
  play?: boolean;
  /** Ein neuer Wert beim Nachladen leuchtet kurz auf. */
  flash?: boolean;
  tone?: GlowTone;
  /** Grundschrift wie Body/Muted/Heading/Title. */
  variant?: keyof typeof textStyles;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  numberOfLines?: number;
  /** Für schmale Kacheln: der fertige Wert darf kleiner werden (wie bei Text). */
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
  onDone?: () => void;
  testID?: string;
};

function rgba(hex: string, alpha: number): string {
  "worklet";
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function CountUp({
  value, grouped = false, from, playKey = "", delay = 0, play = true, flash = true, tone = "brand", variant = "body",
  style, containerStyle, numberOfLines, adjustsFontSizeToFit, minimumFontScale, onDone, testID,
}: Props) {
  const reduce = useReduceMotion();
  const shape = useMemo(() => countShape(value, grouped), [value, grouped]);
  const text = shape ? shape.text : value === null || value === undefined ? "" : String(value);
  const animate = Boolean(shape) && play && !reduce;
  const key = String(playKey);
  // Für welchen `playKey` das Zählen fertig ist. Ein neuer `playKey` zählt schon beim ersten Zeichnen - kein Aufblitzen
  // des Endwerts vor dem Start. Ein Wert, der (noch) nicht zählt - etwa vor dem Laden -, darf später noch zählen.
  const [doneKey, setDoneKey] = useState<string | null>(() => (shape && !animate ? key : null));
  const counting = animate && doneKey !== key;
  const start = useMemo(() => countStart(shape, from), [shape, from]);
  const progress = useSharedValue(counting ? 0 : 1);
  const live = useRef(onDone);
  live.current = onDone;

  const finish = useCallback((finishedKey: string) => {
    setDoneKey(finishedKey);
    live.current?.();
  }, []);

  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      if (shape) setDoneKey(key);
      return undefined;
    }
    progress.value = 0;
    progress.value = withDelay(Math.max(0, delay), withTiming(1, { duration: COUNT_UP_MS, easing: Easing.linear }, (finished) => {
      "worklet";
      if (finished) runOnJS(finish)(key);
    }));
    return () => cancelAnimation(progress);
    // Nur beim ersten Anzeigen und bei einem neuen `playKey` - ein neuer Wert beim Nachladen zählt nicht neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, animate]);

  // Live-Nachladen: ein geänderter Wert nach dem Zählen leuchtet einmal kurz auf.
  const glow = useSharedValue(0);
  const lastText = useRef(text);
  useEffect(() => {
    const before = lastText.current;
    lastText.current = text;
    if (!flash || counting || reduce || !before || !text || before === text) return;
    glow.value = 0;
    glow.value = glowSequence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const glowColor = glowTones[tone] || glowTones.brand;
  const flashStyle = useAnimatedStyle(() => (glow.value > 0 ? { backgroundColor: rgba(glowColor, glow.value * 0.22) } : { backgroundColor: "transparent" }));
  const animatedProps = useAnimatedProps(() => ({ text: countFrame(shape, progress.value, start) }) as unknown as Partial<React.ComponentProps<typeof TextInput>>);

  if (!counting) {
    return (
      <Animated.Text style={[textStyles[variant], styles.text, style, flashStyle]} numberOfLines={numberOfLines} adjustsFontSizeToFit={adjustsFontSizeToFit} minimumFontScale={minimumFontScale} testID={testID}>
        {text}
      </Animated.Text>
    );
  }
  return (
    <View accessible accessibilityLabel={text} testID={testID} style={containerStyle}>
      <AnimatedInput
        editable={false}
        pointerEvents="none"
        underlineColorAndroid="transparent"
        defaultValue={countFrame(shape, 0, start)}
        animatedProps={animatedProps}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[textStyles[variant], styles.text, styles.input, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Feste Ziffernbreite; ohne Schriftrand, damit Zählen und Endwert genau gleich hoch stehen.
  text: { fontVariant: ["tabular-nums"], includeFontPadding: false },
  input: { margin: 0, paddingBottom: 0, paddingHorizontal: 0, paddingTop: 0 },
});
