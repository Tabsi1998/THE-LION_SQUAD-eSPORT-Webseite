import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { REST_MS, createRest } from "../cardLift";
import { easeDegrees, easeFrames } from "../frames";
import { useCardLift } from "../useCardLift";
import { CARD_STREAMER, cardStreamerPlan, loopFrames, swingFrames } from "./cardStreamer";

// Eine Luftschlange auf der Kante einer Karte (Jahreszeiten IV, Variante B, #1093 - wie CardStreamers.jsx im Web):
// gekringelt auf der Oberkante, ihr Ende hängt an einer Ecke außen herab (in den Rand neben der Karte). Wird die Karte
// angetippt, flattert sie einmal durch: die Schlaufen heben sich nacheinander, das Ende pendelt nach außen. Jede Schlaufe
// und das Ende liegen in einer eigenen Ebene, deren Mitte auf ihrem Drehpunkt sitzt (Android dreht und staucht um die
// Mitte). Nie klickbar.

const flutterRest = createRest(REST_MS.small);

/** Nur für Tests: die Ruhezeiten vergessen. */
export function resetStreamerFlutter() {
  flutterRest.clear();
}

function extent(d: string): Array<[number, number]> {
  return d.slice(2).split(" L ").map((pair) => pair.split(" ").map(Number) as [number, number]);
}

function Ribbon({ d, colors }: { d: string; colors: [string, string] }) {
  return (
    <>
      <Path d={d} stroke={colors[0]} strokeWidth={CARD_STREAMER.stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={d} stroke={colors[1]} strokeWidth={0.9} fill="none" strokeLinecap="round" strokeDasharray="3 5" />
    </>
  );
}

export function CardStreamer({ perchId, seed }: { perchId: string; seed: string }) {
  const [width, setWidth] = useState(0);
  // Das Ende hängt in den Rand neben der Karte - in der App liegen die Karten in einer Spalte, links und rechts ist Rand.
  const plan = useMemo(() => (width > 0 ? cardStreamerPlan(width, seed) : null), [width, seed]);
  const progress = useRef(new Animated.Value(0)).current;
  const [flutter, setFlutter] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useCardLift((detail) => {
    if (detail.key !== perchId || !flutterRest.take(perchId)) return;
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: CARD_STREAMER.ms, easing: Easing.linear, useNativeDriver: true }).start();
    setFlutter(Date.now());
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setFlutter(null);
    }, CARD_STREAMER.ms + 60);
  }, Boolean(plan));
  const loops = useMemo(() => (plan ? plan.loops.map((loop) => {
    const points = extent(loop.d);
    const half = Math.ceil(Math.max(...points.map(([x]) => Math.abs(x - loop.x))) + 3);
    const rise = Math.ceil(Math.max(...points.map(([, y]) => -y)) + 3);
    return { ...loop, half, rise };
  }) : []), [plan]);
  const hang = useMemo(() => {
    if (!plan || !plan.hang) return null;
    const points = extent(plan.hang.d);
    const half = Math.ceil(Math.max(...points.map(([x]) => Math.abs(x - plan.corner))) + 3);
    const drop = Math.ceil(Math.max(...points.map(([, y]) => y)) + 3);
    return { d: plan.hang.d, half, drop };
  }, [plan]);
  return (
    <View pointerEvents="none" style={styles.measure} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} testID="carnival-card-streamer" data-flutter={flutter ? "1" : undefined} data-side={plan?.side}>
      {plan && hang ? (
        <Animated.View style={[styles.layer, { left: plan.corner - hang.half, top: -hang.drop, width: hang.half * 2, height: hang.drop * 2 }, flutter ? { transform: [{ rotate: progress.interpolate(easeDegrees(swingFrames(plan.swing).inputRange, swingFrames(plan.swing).outputRange.map((value) => parseFloat(value)))) }] } : null]} testID="carnival-card-streamer-hang">
          <Svg width={hang.half * 2} height={hang.drop * 2} viewBox={`${plan.corner - hang.half} ${-hang.drop} ${hang.half * 2} ${hang.drop * 2}`}>
            <Ribbon d={hang.d} colors={plan.colors} />
          </Svg>
        </Animated.View>
      ) : null}
      {plan ? loops.map((loop) => (
        <Animated.View key={loop.index} style={[styles.layer, { left: loop.x - loop.half, top: -loop.rise, width: loop.half * 2, height: loop.rise * 2 }, flutter ? { transform: [{ scaleY: progress.interpolate(easeFrames(loopFrames(loop.index).inputRange, loopFrames(loop.index).outputRange)) }] } : null]} testID="carnival-card-streamer-loop">
          <Svg width={loop.half * 2} height={loop.rise + 2} viewBox={`${loop.x - loop.half} ${-loop.rise} ${loop.half * 2} ${loop.rise + 2}`}>
            <Ribbon d={loop.d} colors={plan.colors} />
          </Svg>
        </Animated.View>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Eine Linie auf der Oberkante (über dem Rand der Karte): sie misst die Breite, die Luftschlange liegt darauf.
  measure: { position: "absolute", left: 0, right: 0, top: -1, height: 0 },
  layer: { position: "absolute" },
});
