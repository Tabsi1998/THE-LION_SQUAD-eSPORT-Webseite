import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { REST_MS, createRest } from "../cardLift";
import { easeDegrees, easeFrames } from "../frames";
import { useSeason } from "../SeasonProvider";
import { useCardLift } from "../useCardLift";
import { EggArt, GrassStrip } from "./art";
import { isQuiet } from "./plan";
import { ROLL, cardEggPlan, rollStep, tiltFrames, wayFrames, type CardEggPlan } from "./roll";

// Ein Osterei auf der Kante einer Karte (Jahreszeiten IV, Variante B, #1092 - wie CardEggs.jsx im Web): es liegt auf der
// Seite auf der Oberkante, daneben ein Grasbüschel. Wird die Karte angetippt, wackelt es zweimal und rollt höchstens
// sechs Punkte zur näheren Ecke; dort bleibt es liegen (auch wenn der Screen neu gezeichnet wird), über die Ecke rollt es
// nie. Am Karfreitag rührt sich nichts. Bewegt werden nur Ansichten, deren Mitte auf dem Drehpunkt liegt (Android).

/** Wohin die Eier gerollt sind (Schlüssel -> Versatz) - überdauert ein neues Zeichnen, wie die gepurzelten Eier. */
const rolled = new Map<string, number>();
const rollRest = createRest(REST_MS.small);

/** Nur für Tests: gerollte Eier und Ruhezeiten vergessen. */
export function resetEggRolls() {
  rolled.clear();
  rollRest.clear();
}

export type EggRoll = { n: number; from: number; to: number; progress: Animated.Value };

/**
 * Ein Ei rollt, wenn seine Karte `cardKey` angetippt wird (`key` trennt mehrere Eier einer Karte): höchstens alle zehn
 * Sekunden je Karte, nie über `plan.room`. Liefert den Versatz, auf dem es liegt, und das laufende Rollen.
 */
export function useEggRoll(cardKey: string | null, key: string, plan: Pick<CardEggPlan, "dir" | "room"> | null, enabled = true): { offset: number; roll: EggRoll | null } {
  const progress = useRef(new Animated.Value(0)).current;
  const [offset, setOffset] = useState(() => rolled.get(key) || 0);
  const [roll, setRoll] = useState<EggRoll | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useCardLift((detail) => {
    const current = planRef.current;
    if (!cardKey || detail.key !== cardKey || !current || !rollRest.take(cardKey)) return;
    const from = Math.max(-current.room, Math.min(current.room, rolled.get(key) || 0));
    const to = rollStep(from, current);
    rolled.set(key, to);
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: ROLL.ms, easing: Easing.linear, useNativeDriver: true }).start();
    setOffset(to);
    setRoll({ n: Date.now(), from, to, progress });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setRoll(null);
    }, ROLL.ms + 60);
  }, Boolean(cardKey && plan && enabled));
  return { offset: plan ? Math.max(-plan.room, Math.min(plan.room, offset)) : 0, roll };
}

/** Wie das Ei beim Rollen kippt: zweimal wackeln, beim Rollen nach vorn drehen (je nach Weg), wieder hinlegen. */
export function rollTilt(roll: EggRoll, dir: number): Animated.AnimatedInterpolation<string> {
  const share = Math.min(1, Math.abs(roll.to - roll.from) / ROLL.maxPx);
  const frames = tiltFrames(ROLL.turn * share * dir);
  return roll.progress.interpolate(easeDegrees(frames.inputRange, frames.outputRange.map((value) => parseFloat(value))));
}

/** Der Weg beim Rollen. */
export function rollWay(roll: EggRoll): Animated.AnimatedInterpolation<number> {
  const frames = wayFrames(roll.from, roll.to);
  return roll.progress.interpolate(easeFrames(frames.inputRange, frames.outputRange));
}

export function CardEgg({ perchId, seed }: { perchId: string; seed: string }) {
  const { byKey } = useSeason();
  const season = byKey?.easter;
  const quiet = season ? isQuiet(season) : false;
  const [width, setWidth] = useState(0);
  const plan = useMemo(() => (width > 0 ? cardEggPlan(width, seed) : null), [width, seed]);
  const { offset, roll } = useEggRoll(perchId, `card:${perchId}`, plan, !quiet);
  const height = plan ? plan.size * (38 / 30) : 0;
  // Die Ebene, die beim Wackeln kippt: ihre Mitte liegt auf dem Punkt, an dem das Ei die Kante berührt.
  const pivot = plan ? Math.ceil(plan.half + height / 2 + 2) : 0;
  return (
    <View pointerEvents="none" style={styles.measure} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} testID="easter-card-egg" data-offset={String(offset)} data-roll={roll ? "1" : undefined}>
      {plan ? (
        <View style={[styles.spot, { left: plan.x }]}>
          <View style={[styles.tuft, { left: plan.tuft.x - plan.x - plan.tuft.width / 2, top: -plan.tuft.height }]}>
            <GrassStrip width={plan.tuft.width} height={plan.tuft.height} />
          </View>
          <Animated.View style={[styles.spot, { transform: [{ translateX: roll ? rollWay(roll) : offset }] }]}>
            <View style={[styles.shadow, { left: -plan.size * 0.525, width: plan.size * 1.05 }]} />
            <Animated.View style={[styles.pivot, { left: -pivot, top: -pivot, width: pivot * 2, height: pivot * 2, transform: [{ rotate: roll ? rollTilt(roll, plan.dir) : "0deg" }] }]}>
              <View style={[styles.body, { left: pivot - plan.size / 2, top: pivot - plan.half - height / 2, width: plan.size, height, transform: [{ rotate: `${plan.lean}deg` }] }]}>
                <EggArt pattern={plan.pattern} size={plan.size} />
              </View>
            </Animated.View>
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Eine Linie auf der Oberkante (über dem Rand der Karte): sie misst die Breite, das Ei liegt darauf.
  measure: { position: "absolute", left: 0, right: 0, top: -1, height: 0 },
  spot: { position: "absolute", left: 0, top: 0, width: 0, height: 0 },
  tuft: { position: "absolute" },
  shadow: { position: "absolute", top: -1.5, height: 3, borderRadius: 2, backgroundColor: "rgba(0, 0, 0, 0.32)" },
  pivot: { position: "absolute" },
  body: { position: "absolute" },
});
