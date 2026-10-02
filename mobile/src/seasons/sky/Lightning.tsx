import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Defs, Polyline, RadialGradient, Rect, Stop } from "react-native-svg";
import { releaseMotion, requestMotion } from "../motion";
import { hashString, mulberry32 } from "../rng";
import type { Size } from "../snow/flakes";
import { BOLT_ALPHA, FLASH_SECONDS, GLOW_ALPHA, GLOW_REACH, PULSE, createFlash, nextFlashAt, type Flash } from "../weather/storm";

// Wetterleuchten in der App (#771) - wie im Web: ein breiter, flacher Schein oben, der an seinem Rand ganz ausläuft,
// manchmal ein feiner Blitz in der Ferne; ein oder zwei Pulse, frühestens alle acht Sekunden, nie heller als 14 %.
// Jeder Blitz fragt das Bewegungsbudget („lightning“): ist der Screen gerade unsichtbar oder im Hintergrund, fällt
// er aus. Die Helligkeit läuft als Reanimated-Folge auf dem UI-Thread.

/** Die Helligkeit eines Blitzes als Folge von Strecken: [Zielwert, Dauer in ms] - ein oder zwei Pulse wie `flashLevel`. */
export function pulseSteps(flash: Pick<Flash, "strength" | "pulses">): Array<[number, number]> {
  const rise = PULSE.rise * 1000;
  const fall = PULSE.fall * 1000;
  if (flash.pulses < 2) return [[flash.strength, rise], [0, fall]];
  const secondAt = PULSE.second * 1000;
  // Bis der zweite Puls beginnt, ist der erste auf 45 % gefallen; der zweite steigt auf 60 % und fällt dann aus.
  const dip = 1 - (PULSE.second - PULSE.rise) / PULSE.fall;
  return [[flash.strength, rise], [flash.strength * dip, secondAt - rise], [flash.strength * 0.6, rise], [0, fall]];
}

export function Lightning({ size, running, seed, top = 0 }: { size: Size; running: boolean; seed: string; top?: number }) {
  const rng = useMemo(() => mulberry32(hashString(`storm:${seed}`)), [seed]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const level = useSharedValue(0);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useEffect(() => {
    if (!running) return undefined;
    let wait: ReturnType<typeof setTimeout> | null = null;
    let done: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      wait = setTimeout(fire, nextFlashAt(rng, 0) * 1000);
    };
    const fire = () => {
      const token = requestMotion("lightning");
      if (token) {
        const next = createFlash(rng, sizeRef.current, 0, top);
        setFlash(next);
        const steps = pulseSteps(next).map(([value, duration]) => withTiming(value, { duration, easing: Easing.linear }));
        level.value = 0;
        level.value = withSequence(...steps);
        done = setTimeout(() => {
          releaseMotion(token);
          setFlash(null);
        }, FLASH_SECONDS * 1000 + 120);
      }
      schedule();
    };
    schedule();
    return () => {
      if (wait) clearTimeout(wait);
      if (done) clearTimeout(done);
      level.value = 0;
    };
  }, [running, rng, top, level]);
  const style = useAnimatedStyle(() => ({ opacity: level.value }));
  if (!flash) return null;
  const reach = size.height * GLOW_REACH;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} testID="weather-lightning">
      <Svg width={size.width} height={reach + top} style={styles.glow}>
        <Defs>
          <RadialGradient id="glow" cx={flash.x} cy={top} rx={Math.max(reach, size.width * 0.75)} ry={reach} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="rgb(215,230,255)" stopOpacity={GLOW_ALPHA} />
            <Stop offset="0.5" stopColor="rgb(190,210,250)" stopOpacity={GLOW_ALPHA * 0.45} />
            <Stop offset="1" stopColor="rgb(190,210,250)" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={top} width={size.width} height={reach} fill="url(#glow)" />
      </Svg>
      {flash.bolt ? (
        <View style={StyleSheet.absoluteFill} testID="weather-bolt">
          <Svg width={size.width} height={size.height}>
            {[{ points: flash.bolt.main, width: 1.4 }, ...flash.bolt.branches.map((points) => ({ points, width: 0.8 }))].map((line, index) => (
              <Polyline key={index} points={line.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")} fill="none" stroke="rgb(235,242,255)" strokeOpacity={BOLT_ALPHA} strokeWidth={line.width} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </Svg>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glow: { position: "absolute", left: 0, top: 0 },
});
