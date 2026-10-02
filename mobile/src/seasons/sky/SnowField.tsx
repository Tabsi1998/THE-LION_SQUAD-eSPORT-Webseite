import React, { useCallback, useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import { hashString, mulberry32 } from "../rng";
import { DEPTHS, DEPTH_ORDER, advanceFlake, createFlake, nextGust, scrollFlake, windAt, type DepthKey, type Flake, type Gust, type Size, type WindBase } from "../snow/flakes";
import { FlakeSvg, flakeBox } from "./FlakeSvg";
import type { ScrollState } from "./scroll";

// Ein Schneefeld über dem Screen (#642, #771): so viele Plätze, wie es höchstens Flocken geben kann (`capacity`);
// wie viele davon gerade schneien, sagt `counts` - kommen weniger, fallen die übrigen noch zu Ende, kommen mehr, fallen
// sie oben neu herein. Die Rechnung je Bild (Wind, Böen, Fallen, Taumeln, Scrollen) läuft als Worklet auf dem
// UI-Thread; jede Flocke ist eine kleine Ansicht mit ihrer Form, bewegt nur über Versatz und Drehung um ihre Mitte.

export type FieldCounts = { back: number; mid: number; front: number };
export type Slot = { depth: DepthKey; rank: number };

/** Die Plätze des Felds: je Tiefe so viele, wie `capacity` sagt, hinten zuerst (gezeichnet wird von hinten nach vorne). */
export function poolLayout(capacity: FieldCounts): Slot[] {
  const slots: Slot[] = [];
  DEPTH_ORDER.forEach((depth) => {
    for (let rank = 0; rank < Math.max(0, capacity[depth] || 0); rank += 1) slots.push({ depth, rank });
  });
  return slots;
}

/** Die Flocken zum Start: über das ganze Bild verteilt, aus dem Seed des Felds - an Ort und Stelle wie im Web. */
export function initialFlakes(slots: Slot[], counts: FieldCounts, size: Size, seed: string): Flake[] {
  const rng = mulberry32(hashString(`snow:${seed}`));
  return slots.map((slot, index) => {
    const flake = createFlake(slot.depth, size, rng, { index, anywhere: true });
    // Plätze über der aktuellen Zahl warten unsichtbar, bis mehr Schnee kommt.
    if (slot.rank >= (counts[slot.depth] || 0)) flake.done = true;
    return flake;
  });
}

/**
 * Ein Schritt für alle Flocken - die Rechnung des Frame-Callbacks, ohne Reanimated testbar. `active` sagt je Platz, ob
 * er gerade schneien soll; ein wieder gebrauchter Platz fällt oben neu herein, ein nicht mehr gebrauchter fällt zu Ende.
 */
export function stepFlakes(list: Flake[], slots: Slot[], counts: FieldCounts, dt: number, t: number, base: WindBase, gust: Gust | null, size: Size, scrolled = 0, random: () => number = Math.random): Flake[] {
  "worklet";
  const wind = windAt(t, base, gust);
  for (let i = 0; i < list.length; i += 1) {
    const flake = list[i];
    const slot = slots[i];
    const active = slot.rank < (counts[slot.depth] || 0);
    if (flake.done) {
      if (!active) continue;
      flake.done = false;
      flake.y = -flake.radius * 3 - 10 - random() * 40;
      flake.x = random() * size.width;
    }
    flake.leaving = !active;
    if (scrolled) scrollFlake(flake, scrolled, size, random);
    advanceFlake(flake, dt, wind, size, random);
  }
  return list;
}

function FlakeSprite({ index, flakes, flake }: { index: number; flakes: SharedValue<Flake[]>; flake: Flake }) {
  const box = flakeBox(flake.radius);
  const turns = !DEPTHS[flake.depth].soft;
  const style = useAnimatedStyle(() => {
    const current = flakes.value[index];
    if (!current || current.done) return { opacity: 0, transform: [{ translateX: -100 }, { translateY: -100 }, { rotate: "0rad" }] };
    return { opacity: current.opacity, transform: [{ translateX: current.x - box }, { translateY: current.y - box }, { rotate: turns ? `${current.rotation}rad` : "0rad" }] };
  });
  return (
    <Animated.View style={[styles.sprite, { width: box * 2, height: box * 2 }, style]} testID={`snow-flake-${index}`}>
      <FlakeSvg shape={flake.shape} radius={flake.radius} />
    </Animated.View>
  );
}

export function SnowField({ capacity, counts, wind, size, seed, running, scroll, testID = "snow-field" }: { capacity: FieldCounts; counts: FieldCounts; wind: WindBase; size: Size; seed: string; running: boolean; scroll?: SharedValue<ScrollState> | null; testID?: string }) {
  const slots = useMemo(() => poolLayout(capacity), [capacity.back, capacity.mid, capacity.front]);
  // Neu gewürfelt wird nur mit neuen Plätzen, einem neuen Seed oder einer neuen Größe - nicht, wenn sich die Zahl ändert.
  const initial = useMemo(() => initialFlakes(slots, counts, size, seed), [slots, seed, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const flakes = useSharedValue<Flake[]>(initial);
  const want = useSharedValue<FieldCounts>(counts);
  const base = useSharedValue<WindBase>(wind);
  const clock = useSharedValue<{ t: number; gust: Gust; screen: string; y: number }>({ t: 0, gust: nextGust(Math.random, 0), screen: "", y: 0 });
  useEffect(() => {
    flakes.value = initial;
  }, [initial, flakes]);
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
    // Scrollen schiebt die Flocken - nur innerhalb desselben Screens; ein Wechsel des Screens springt nicht.
    const now = scroll ? scroll.value : null;
    const scrolled = now && now.screen === before.screen ? now.y - before.y : 0;
    clock.value = { t, gust, screen: now ? now.screen : "", y: now ? now.y : 0 };
    const counts = want.value;
    const windBase = base.value;
    flakes.modify((list) => {
      "worklet";
      return stepFlakes(list, slots, counts, dt, t, windBase, gust, area, scrolled);
    });
  }, [slots, width, height, scroll, clock, want, base, flakes]);
  const frame = useFrameCallback(step, running);
  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={testID}>
      {initial.map((flake, index) => <FlakeSprite key={index} index={index} flakes={flakes} flake={flake} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  sprite: { position: "absolute", left: 0, top: 0 },
});
