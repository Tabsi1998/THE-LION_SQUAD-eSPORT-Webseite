import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { WRITE_PAUSE_LABEL, useWritePause } from "../lib/writePause";
import { colors, motion, roles } from "../theme";
import { useReduceMotion } from "./motion";
import { Muted } from "./Text";

// Schreibpause fürs Backup (#1009, App: #2173): die schmale Leiste oben in jedem Screen, solange der Server Speichern kurz anhält -
// „Kurze Wartung … gleich wieder möglich“. Sie verschwindet nach der Zeit, die der Server nennt, von selbst. Wie die Offline-Leiste,
// aber in Lionsquad-Blau: nichts ist kaputt, es dauert nur einen Moment.
// Bewegung (Detail-Runde): Sie gleitet leise von oben herein (6 Punkte, 240 ms) und blendet beim Gehen aus - nur Verschieben und
// Deckkraft. „Bewegung reduzieren“: Sie steht sofort da und geht sofort.

const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

export function WritePauseBar() {
  const { active } = useWritePause();
  const reduce = useReduceMotion();
  // Beim Gehen bleibt die Leiste stehen, bis sie ausgeblendet ist.
  const [shown, setShown] = useState(active);
  const level = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    if (active) {
      setShown(true);
      level.value = reduce ? 1 : withTiming(1, { duration: motion.mid, easing: ease });
      return;
    }
    if (reduce) {
      level.value = 0;
      setShown(false);
      return;
    }
    level.value = withTiming(0, { duration: motion.fast, easing: ease }, (finished) => {
      if (finished) runOnJS(setShown)(false);
    });
  }, [active, level, reduce]);

  const style = useAnimatedStyle(() => ({ opacity: level.value, transform: [{ translateY: (1 - level.value) * -6 }] }));
  if (!shown && !active) return null;
  return (
    <Animated.View style={[styles.bar, style]} testID="write-pause-bar" accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={WRITE_PAUSE_LABEL}>
      <View style={styles.icon}><Ionicons name="time-outline" size={15} color={roles.brand} /></View>
      <Muted style={styles.text} numberOfLines={2}>{WRITE_PAUSE_LABEL}</Muted>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.1)",
    borderBottomColor: "rgba(41, 182, 232, 0.35)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  icon: { alignItems: "center", justifyContent: "center" },
  text: { color: colors.white, flex: 1, fontWeight: "800" },
});
