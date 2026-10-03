import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from "react-native-svg";
import { requestConfettiBurst } from "../carnival";
import { useAppActive } from "../halloween";
import { mulberry32 } from "../rng";

// Luftballons und Feier-Takt in der App (#856), wie im Web (frontend/src/seasons/birthday/balloons.js): ab und zu eine
// kleine Welle Ballons, die langsam am Rand aufsteigt, und alle paar Minuten ein Konfetti-Schub oben. Nur ganz außen am
// Rand (die Karten haben dort ihren Innenabstand), nichts fängt Berührungen ab; im Hintergrund und ohne Bewegung nichts.

export const BALLOON_COLORS: Array<[string, string]> = [["#29B6E8", "#bfeaf9"], ["#FFD700", "#fff6c2"], ["#f7f4ee", "#ffffff"], ["#ff4fa3", "#ffc2e0"]];

export type AppBalloon = { id: number; x: number; size: number; duration: number; delay: number; sway: number; color: number };

/** Eine Welle: abwechselnd links und rechts ganz außen, je Ballon eigene Größe, Dauer, Pendel, Verzögerung. */
export function appBalloonWave(rng: () => number, width: number, count: number, startId = 0): AppBalloon[] {
  const firstSide = rng() < 0.5 ? 0 : 1;
  return Array.from({ length: count }, (_, index) => {
    const left = (index + firstSide) % 2 === 0;
    const size = Math.round(16 + rng() * 6);
    const edge = 2 + rng() * 12;
    return {
      id: startId + index,
      x: Math.round(left ? edge : width - edge - size),
      size,
      duration: Math.round(13000 + rng() * 6000),
      delay: Math.round(rng() * 2400 + index * 900),
      sway: Math.round(4 + rng() * 6),
      color: Math.floor(rng() * BALLOON_COLORS.length),
    };
  });
}

/** Wann das nächste Mal gefeiert wird (wie im Web): Ballons alle 70–120 s (die erste nach 2,5 s), Konfetti alle 3–5 min. */
export function nextCelebration(kind: "balloons" | "confetti", rng: () => number, first = false): number {
  if (kind === "balloons") return first ? 2500 : 70000 + Math.round(rng() * 50000);
  return first ? 150000 + Math.round(rng() * 60000) : 180000 + Math.round(rng() * 120000);
}

let gradientIds = 0;

function BalloonShape({ size, color }: { size: number; color: number }) {
  const [id] = useState(() => `tls-balloon-${(gradientIds += 1)}`);
  const [body, shine] = BALLOON_COLORS[color] || BALLOON_COLORS[0];
  const h = size * 1.22;
  return (
    <Svg width={size} height={h + size * 2.2} viewBox={`0 0 ${size} ${h + size * 2.2}`}>
      <Defs>
        <RadialGradient id={id} cx="32%" cy="28%" r="70%">
          <Stop offset="0" stopColor={shine} />
          <Stop offset="0.4" stopColor={body} />
          <Stop offset="1" stopColor={body} />
        </RadialGradient>
      </Defs>
      <Path d={`M ${size / 2} ${h + 2} C ${size * 0.32} ${h + size * 0.7}, ${size * 0.7} ${h + size * 1.3}, ${size * 0.45} ${h + size * 2.1}`} stroke="rgba(255, 255, 255, 0.45)" strokeWidth={1} fill="none" />
      <Path d={`M ${size / 2 - 2.4} ${h + 2.6} L ${size / 2 + 2.4} ${h + 2.6} L ${size / 2} ${h - 1} Z`} fill={body} />
      <Ellipse cx={size / 2} cy={h / 2} rx={size / 2} ry={h / 2} fill={`url(#${id})`} opacity={0.92} />
    </Svg>
  );
}

function RisingBalloon({ balloon, height, onDone }: { balloon: AppBalloon; height: number; onDone: (id: number) => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.sequence([Animated.delay(balloon.delay), Animated.timing(progress, { toValue: 1, duration: balloon.duration, easing: Easing.linear, useNativeDriver: true })]);
    run.start(({ finished }) => finished && onDone(balloon.id));
    return () => run.stop();
  }, [balloon, progress, onDone]);
  const travel = height + balloon.size * 5;
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [height + balloon.size, height + balloon.size - travel] });
  const translateX = progress.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, balloon.sway, 0, -balloon.sway, 0] });
  const rotate = progress.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: ["0deg", "5deg", "0deg", "-5deg", "0deg"] });
  return (
    <Animated.View style={[styles.balloon, { left: balloon.x, transform: [{ translateY }, { translateX }, { rotate }] }]} testID="birthday-balloon">
      <BalloonShape size={balloon.size} color={balloon.color} />
    </Animated.View>
  );
}

/**
 * Der Feier-Takt: Ballon-Wellen und Konfetti-Schübe - nur mit Bewegung und solange die App vorne ist. `random` und
 * `seed` für Tests.
 */
export function BirthdayCelebration({ moving, count = 3, seed = 856, random = Math.random }: { moving: boolean; count?: number; seed?: number; random?: () => number }) {
  const { width, height } = useWindowDimensions();
  const active = useAppActive();
  const [balloons, setBalloons] = useState<AppBalloon[]>([]);
  const rng = useRef(mulberry32(seed));
  const nextId = useRef(0);
  const size = useRef({ width, height });
  size.current = { width, height };
  useEffect(() => {
    if (!moving || !active || count <= 0) return undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (kind: "balloons" | "confetti", first = false) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (kind === "balloons") {
          const wave = appBalloonWave(rng.current, size.current.width, count, nextId.current);
          nextId.current += wave.length;
          setBalloons((current) => [...current, ...wave].slice(-count * 3));
        } else {
          requestConfettiBurst({ x: Math.round(size.current.width * (0.15 + random() * 0.7)), y: Math.round(size.current.height * (0.08 + random() * 0.14)) });
        }
        later(kind);
      }, nextCelebration(kind, random, first));
      timers.add(timer);
    };
    later("balloons", true);
    later("confetti", true);
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [moving, active, count, random]);
  const done = useRef((id: number) => setBalloons((current) => current.filter((balloon) => balloon.id !== id))).current;
  if (!moving || !balloons.length) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="birthday-balloons">
      {balloons.map((balloon) => <RisingBalloon key={balloon.id} balloon={balloon} height={height} onDone={done} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  balloon: { position: "absolute", top: 0 },
});
