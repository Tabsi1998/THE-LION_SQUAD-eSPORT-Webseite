import React, { useCallback, useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import { hashString, mulberry32 } from "../rng";
import { nextGust, windAt, type Gust, type Size, type WindBase } from "../snow/flakes";
import { RAIN_DEPTHS, RAIN_ORDER, advanceDrop, createDrop, driftOf, scrollDrop, type Drop, type RainDepthKey } from "../weather/rain";
import type { ScrollState } from "./scroll";

// Regen über dem Screen (#771): feine, schräge Striche in drei Tiefen, geneigt nach Wind und Böen - dieselbe Rechnung
// wie im Web. Wie das Schneefeld: feste Plätze, die gerade gebrauchten regnen, die übrigen fallen zu Ende; die
// Rechnung je Bild läuft als Worklet auf dem UI-Thread. Jeder Tropfen ist ein dünner Strich, gedreht um seine Mitte.

export type DropCounts = { back: number; mid: number; front: number };
export type DropSlot = { depth: RainDepthKey; rank: number };

export function rainLayout(capacity: DropCounts): DropSlot[] {
  const slots: DropSlot[] = [];
  RAIN_ORDER.forEach((depth) => {
    for (let rank = 0; rank < Math.max(0, capacity[depth] || 0); rank += 1) slots.push({ depth, rank });
  });
  return slots;
}

export function initialDrops(slots: DropSlot[], counts: DropCounts, size: Size, seed: string): Drop[] {
  const rng = mulberry32(hashString(`rain:${seed}`));
  return slots.map((slot) => {
    const drop = createDrop(slot.depth, size, rng, { anywhere: true });
    if (slot.rank >= (counts[slot.depth] || 0)) drop.done = true;
    return drop;
  });
}

/** Ein Schritt für alle Tropfen - die Rechnung des Frame-Callbacks, ohne Reanimated testbar. Liefert den Wind in x. */
export function stepDrops(list: Drop[], slots: DropSlot[], counts: DropCounts, dt: number, t: number, base: WindBase, gust: Gust | null, size: Size, scrolled = 0, random: () => number = Math.random): number {
  "worklet";
  const wind = windAt(t, base, gust);
  for (let i = 0; i < list.length; i += 1) {
    const drop = list[i];
    const slot = slots[i];
    const active = slot.rank < (counts[slot.depth] || 0);
    if (drop.done) {
      if (!active) continue;
      drop.done = false;
      drop.y = -drop.length - random() * 40;
    }
    drop.leaving = !active;
    if (scrolled) scrollDrop(drop, scrolled, size, random);
    advanceDrop(drop, dt, wind, size, random);
  }
  return wind.x;
}

/** Wie schräg der Strich steht (Grad): Drift gegen Fallgeschwindigkeit - der Tropfen zeigt dorthin, woher er kommt. */
export function dropAngle(drop: Pick<Drop, "depth" | "speed">, windX: number): number {
  "worklet";
  const drift = driftOf(drop, { x: windX, y: 0, strength: 0 });
  return (-Math.atan2(drift, drop.speed) * 180) / Math.PI;
}

function DropSprite({ index, drops, windX, drop }: { index: number; drops: SharedValue<Drop[]>; windX: SharedValue<number>; drop: Drop }) {
  const style = useAnimatedStyle(() => {
    const current = drops.value[index];
    if (!current || current.done) return { opacity: 0, transform: [{ translateX: -100 }, { translateY: -100 }, { rotate: "0deg" }] };
    // Der Strich hängt mittig über dem Tropfenkopf: Kasten von y - Länge bis y, gedreht um seine Mitte.
    return { opacity: current.alpha, transform: [{ translateX: current.x - current.width / 2 }, { translateY: current.y - current.length }, { rotate: `${dropAngle(current, windX.value)}deg` }] };
  });
  return <Animated.View style={[styles.drop, { width: drop.width, height: drop.length }, style]} testID={`rain-drop-${index}`} />;
}

export function RainField({ capacity, counts, wind, size, seed, running, scroll, testID = "rain-field" }: { capacity: DropCounts; counts: DropCounts; wind: WindBase; size: Size; seed: string; running: boolean; scroll?: SharedValue<ScrollState> | null; testID?: string }) {
  const slots = useMemo(() => rainLayout(capacity), [capacity.back, capacity.mid, capacity.front]);
  const initial = useMemo(() => initialDrops(slots, counts, size, seed), [slots, seed, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const drops = useSharedValue<Drop[]>(initial);
  const want = useSharedValue<DropCounts>(counts);
  const base = useSharedValue<WindBase>(wind);
  const windX = useSharedValue(0);
  const clock = useSharedValue<{ t: number; gust: Gust; screen: string; y: number }>({ t: 0, gust: nextGust(Math.random, 0), screen: "", y: 0 });
  useEffect(() => {
    drops.value = initial;
  }, [initial, drops]);
  useEffect(() => {
    want.value = { back: counts.back, mid: counts.mid, front: counts.front };
  }, [counts.back, counts.mid, counts.front, want]);
  useEffect(() => {
    base.value = { factor: wind.factor, sign: wind.sign };
  }, [wind.factor, wind.sign, base]);
  const width = size.width;
  const height = size.height;
  const step = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    "worklet";
    const area = { width, height };
    const dt = Math.min(0.1, Math.max(0, (info.timeSincePreviousFrame ?? 16) / 1000));
    const before = clock.value;
    const t = before.t + dt;
    const gust = t > before.gust.at + before.gust.length + 4 ? nextGust(Math.random, t) : before.gust;
    const now = scroll ? scroll.value : null;
    const scrolled = now && now.screen === before.screen ? now.y - before.y : 0;
    clock.value = { t, gust, screen: now ? now.screen : "", y: now ? now.y : 0 };
    const counts = want.value;
    const windBase = base.value;
    // Den Wind hier rechnen: ein Worklet im Worklet kann keine Variable draußen setzen (es bekommt eine Kopie).
    windX.value = windAt(t, windBase, gust).x;
    drops.modify((list) => {
      "worklet";
      stepDrops(list, slots, counts, dt, t, windBase, gust, area, scrolled);
      return list;
    });
  }, [slots, width, height, scroll, clock, want, base, drops, windX]);
  const frame = useFrameCallback(step, running);
  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={testID}>
      {initial.map((drop, index) => <DropSprite key={index} index={index} drops={drops} windX={windX} drop={drop} />)}
    </View>
  );
}

/** Die Tiefen des Regens - für Tests und die Wetterkarte. */
export { RAIN_DEPTHS };

const styles = StyleSheet.create({
  drop: { position: "absolute", left: 0, top: 0, borderRadius: 1, backgroundColor: "#dbeefa" },
});
