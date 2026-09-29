import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Line } from "react-native-svg";
import { EXTENT, buildPlan, planLines } from "./webPlan";

// Ein kleines Netz in einer oberen Innenecke einer Karte (A4, #718 - wie H12 im Web): dieselben Fäden wie das große
// Netz, nur klein (Radius 22–30) und blasser, still, nie klickbar; die Karte darunter bleibt, wie sie ist.

export function CornerWeb({ side, seed, radius }: { side: "tl" | "tr"; seed: number; radius: number }) {
  const plan = useMemo(() => buildPlan(seed), [seed]);
  const mirror = side === "tr";
  const lines = useMemo(() => planLines(plan, radius, mirror), [plan, radius, mirror]);
  const width = Math.round(EXTENT.x * radius);
  const height = Math.round(EXTENT.y * radius);
  return (
    <View pointerEvents="none" style={[styles.web, side === "tl" ? { left: 0 } : { right: 0 }, { width, height }]} testID="halloween-corner-web" data-side={side}>
      <Svg width={width} height={height}>
        {lines.map((line, index) => (
          <Line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={line.kind === "spiral" ? "rgba(170,225,240,0.36)" : "rgba(170,225,240,0.52)"} strokeWidth={line.kind === "spiral" ? 0.55 : 0.8} strokeLinecap="round" />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  web: { position: "absolute", top: 0, opacity: 0.75 },
});
