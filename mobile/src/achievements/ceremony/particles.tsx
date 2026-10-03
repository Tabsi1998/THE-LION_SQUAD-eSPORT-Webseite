import React, { useCallback, useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";

// Erfolge II (E13, #623): die Partikel der Zeremonie - dieselben Arten und dieselbe Physik wie im Web
// (particles.js): Blätter, Funken, Glut, Glanz, Konfetti, Kristalle, Prisma, Flammen, Irrlichter. Am Handy
// höchstens 60 Teilchen; die Rechnung je Bild läuft als Worklet auf dem UI-Thread, jedes Teilchen ist eine
// kleine Ansicht, bewegt nur über Versatz, Drehung und Deckkraft (wie der Schnee, keine Zeichenfläche).

export type Particle = {
  x: number; y: number; vx: number; vy: number; size: number; rot: number; vr: number;
  life: number; ttl: number; color: string; kind: string;
};

export const PALETTES: Record<string, string[]> = {
  leaf: ["#C08A55", "#A0703C", "#7A5330", "#E3B27A"],
  spark: ["#F1F3F5", "#B4BAC0", "#FFFFFF", "#9AA0A6"],
  ember: ["#E3A25C", "#CD7F32", "#FF8A3D", "#FFD1A0"],
  glint: ["#FFFFFF", "#E8EAEC", "#C0C0C0", "#F7F7F7"],
  confetti: ["#FFD700", "#FFE066", "#FFFFFF", "#29B6E8", "#00FF88"],
  crystal: ["#8FE2FF", "#29B6E8", "#E6F9FF", "#FFFFFF"],
  prism: ["#B9F2FF", "#FF7AD9", "#FFE066", "#7AFFB2", "#7AB8FF", "#FFFFFF"],
  flame: ["#FF3B30", "#FF7A6E", "#FFD700", "#FF8A3D"],
  wisp: ["#C79BFF", "#A855F7", "#F3E8FF", "#7C3AED"],
};

const rnd = (rng: () => number, min: number, max: number) => min + rng() * (max - min);

/** Die Teilchen zum Start - Konfetti und Blätter fallen von oben, alles andere platzt aus der Bühnenmitte. */
export function spawnParticles({ kind = "confetti", count = 40, width = 400, height = 800, rng = Math.random, origin = null }: { kind?: string; count?: number; width?: number; height?: number; rng?: () => number; origin?: { x: number; y: number } | null }): Particle[] {
  const colors = PALETTES[kind] || PALETTES.confetti;
  const cx = origin?.x ?? width / 2;
  const cy = origin?.y ?? height / 2;
  const falling = kind === "confetti" || kind === "leaf";
  const rising = kind === "flame" || kind === "wisp";
  const out: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const speed = rising ? rnd(rng, 20, 90) : rnd(rng, 90, 320);
    out.push({
      x: falling ? rng() * width : cx + Math.cos(angle) * rnd(rng, 0, 30),
      y: falling ? -rnd(rng, 10, height * 0.5) : cy + Math.sin(angle) * rnd(rng, 0, 30),
      vx: falling ? rnd(rng, -30, 30) : Math.cos(angle) * speed,
      vy: falling ? rnd(rng, 60, 160) : Math.sin(angle) * speed - (rising ? 60 : 0),
      size: kind === "confetti" ? rnd(rng, 5, 10) : rnd(rng, 2, 6),
      rot: rng() * Math.PI,
      vr: rnd(rng, -4, 4),
      life: 0,
      ttl: rnd(rng, 1.4, kind === "wisp" ? 4 : 3),
      color: colors[Math.floor(rng() * colors.length)],
      kind,
    });
  }
  return out;
}

/** Ein Schritt für alle Teilchen (Schwerkraft, Luftwiderstand, Auftrieb bei Flammen und Irrlichtern). */
export function stepParticles(list: Particle[], dt: number, width: number, height: number, gravity = 220, drag = 0.985): Particle[] {
  "worklet";
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (p.life >= p.ttl) continue;
    p.life += dt;
    const upward = p.kind === "flame" || p.kind === "wisp";
    p.vy += (upward ? -gravity * 0.15 : gravity) * dt;
    p.vx *= drag;
    p.vy *= drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.kind === "wisp") p.x += Math.sin(p.life * 3 + p.rot) * 20 * dt;
    if (p.y > height + 40 || p.x < -40 || p.x > width + 40) p.life = p.ttl;
  }
  return list;
}

/** Deckkraft eines Teilchens: blendet über seine Lebenszeit aus (wie im Web, leicht verstärkt). */
export function particleOpacity(p: Particle): number {
  "worklet";
  if (p.life >= p.ttl) return 0;
  return Math.max(0, Math.min(1, (1 - p.life / p.ttl) * 1.2));
}

function shapeStyle(p: Particle) {
  if (p.kind === "confetti") return { width: p.size, height: p.size / 2, borderRadius: 1 };
  if (p.kind === "crystal" || p.kind === "prism") return { width: p.size * 1.2, height: p.size * 1.2, borderRadius: 1, transform: [{ rotate: "45deg" }] };
  if (p.kind === "leaf") return { width: p.size * 2, height: p.size, borderRadius: p.size };
  return { width: p.size, height: p.size, borderRadius: p.size };
}

function Sprite({ index, particles, particle }: { index: number; particles: SharedValue<Particle[]>; particle: Particle }) {
  const half = particle.kind === "leaf" ? particle.size : particle.size / 2;
  const style = useAnimatedStyle(() => {
    const p = particles.value[index];
    if (!p) return { opacity: 0 };
    return { opacity: particleOpacity(p), transform: [{ translateX: p.x - half }, { translateY: p.y - half }, { rotate: `${p.rot}rad` }] };
  });
  return (
    <Animated.View style={[styles.sprite, style]} testID={`ceremony-particle-${index}`}>
      <View style={[shapeStyle(particle), { backgroundColor: particle.color }]} />
    </Animated.View>
  );
}

/** Die Partikel-Ebene über der Bühne: einmal gespawnt, läuft bis alle verglüht sind, dann steht der Takt. */
export function CeremonyParticles({ kind, count, width, height, origin, running = true, seed = Math.random }: { kind: string; count: number; width: number; height: number; origin?: { x: number; y: number } | null; running?: boolean; seed?: () => number }) {
  const initial = useMemo(() => spawnParticles({ kind, count, width, height, origin, rng: seed }), [kind, count, width, height, origin?.x, origin?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const particles = useSharedValue<Particle[]>(initial);
  useEffect(() => {
    particles.value = initial;
  }, [initial, particles]);
  const step = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    "worklet";
    const dt = Math.min(0.05, Math.max(0, (info.timeSincePreviousFrame ?? 16) / 1000));
    particles.modify((list) => {
      "worklet";
      return stepParticles(list, dt, width, height);
    });
  }, [particles, width, height]);
  const frame = useFrameCallback(step, running);
  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="ceremony-particles">
      {initial.map((particle, index) => <Sprite key={index} index={index} particles={particles} particle={particle} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  sprite: { position: "absolute", left: 0, top: 0 },
});
