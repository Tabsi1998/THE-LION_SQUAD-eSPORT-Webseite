import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { motionEasing } from "../../lib/motion";
import { pulseTones } from "../../theme";
import { useReduceMotion } from "./useReduceMotion";

// Puls (#1969, wie `.tls-run-pulse` im Web): ein Punkt mit leisem Ring, der alle zwei Sekunden ausläuft - „heute steht
// etwas an“ bzw. „läuft gerade“. Die Farbe kommt aus den Puls-Varianten: honor (Gold, Vorgabe), brand (Cyan), live
// (Rot, nur „läuft gerade“), ok (Grün). Bewegt wird nur Deckkraft und Größe des Rings; mit „Bewegung reduzieren“ steht
// der Punkt still.

export type PulseTone = keyof typeof pulseTones;

export function Pulse({ tone = "honor", size = 8, testID = "reference-pulse" }: { tone?: PulseTone; size?: number; testID?: string }) {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 2000, easing: motionEasing, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  const color = pulseTones[tone] || pulseTones.honor;
  const dot = { backgroundColor: color, borderRadius: size / 2, height: size, width: size };
  return (
    <View style={[styles.wrap, { height: size, width: size }]} testID={testID}>
      {reduce ? null : (
        <Animated.View
          style={[styles.halo, dot, {
            opacity: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 3, 3] }) }],
          }]}
        />
      )}
      <View style={dot} testID={`${testID}-dot`} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute" },
});
