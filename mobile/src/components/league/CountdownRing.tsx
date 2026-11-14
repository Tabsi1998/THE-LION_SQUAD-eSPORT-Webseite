import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { motion } from "../../theme";
import { roles } from "../../theme";
import { useReduceMotion } from "../motion";

// Countdown-Ring für Check-in und Map-Veto (#2173, wie der Ring im Web): der Rest als Kreisbogen, daneben die Zeit in großen Ziffern.
// Der Bogen folgt der Sekunde (der Bildschirm zeichnet einmal je Sekunde), die letzten Sekunden (`urgent`) stehen rot mit Sanduhr-Wort
// und der Ring atmet ruhig - nur `transform`, mit „Bewegung reduzieren“ steht er still. Lesbar ohne Farbe: das Wort „gleich vorbei“.

const SIZE = 64;
const STROKE = 6;
const R = (SIZE - STROKE) / 2;
const LENGTH = 2 * Math.PI * R;
const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

export function CountdownRing({ share, text, label, urgent = false, tone = roles.brand, testID }: {
  share: number;
  text: string;
  label?: string;
  urgent?: boolean;
  tone?: string;
  testID?: string;
}) {
  const reduce = useReduceMotion();
  const breath = useSharedValue(1);
  useEffect(() => {
    if (!urgent || reduce) {
      cancelAnimation(breath);
      breath.value = 1;
      return undefined;
    }
    breath.value = withRepeat(withSequence(withTiming(1.06, { duration: motion.slow, easing: ease }), withTiming(1, { duration: motion.slow, easing: ease })), -1);
    return () => cancelAnimation(breath);
  }, [breath, reduce, urgent]);
  const breathing = useAnimatedStyle(() => ({ transform: [{ scale: breath.value }] }));
  const color = urgent ? roles.live : tone;
  const offset = LENGTH * (1 - Math.min(1, Math.max(0, share)));
  return (
    <View style={styles.row} testID={testID}>
      <Animated.View style={breathing}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={STROKE} />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${LENGTH} ${LENGTH}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
      </Animated.View>
      <View style={styles.text}>
        {label ? <Text style={styles.label}>{urgent ? "gleich vorbei" : label}</Text> : null}
        <Text style={[styles.time, urgent && styles.urgent]} testID={testID ? `${testID}-text` : undefined} maxFontSizeMultiplier={1.3}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 10 },
  text: { alignItems: "flex-end" },
  label: { color: roles.quiet, fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  time: { color: "#FFFFFF", fontSize: 28, fontVariant: ["tabular-nums"], fontWeight: "900" },
  urgent: { color: roles.live },
});
