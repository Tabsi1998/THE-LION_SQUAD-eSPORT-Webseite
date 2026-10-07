import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { REST_MS, createRest, endReaction, startReaction } from "../cardLift";
import { seasonCapabilities } from "../intensity";
import { seasonYear } from "../rng";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { useCardKey, useCardLift } from "../useCardLift";
import { capGrowth, capLevel, capPath, capThickness } from "./caps";
import { SHAKE, shakeDone, shakeDuration, shakeFlakes, shakeLevel, type ShakeFlake } from "./shake";

// Die Schneehaube auf der Oberkante der Begrüßungskarte im Dashboard (W3, #729 - Entscheidung A: nur dort).
// Stufe vom Server (`snowcap_stage`), Tauen aus dem Wetter, Kontur und Wachstum aus dem Jahres-Seed; sie liegt
// über der Kante, verschiebt nichts und ist nie klickbar. „Dezent“ bekommt eine dünne Haube, stille Screens keine.
// Abschütteln (Jahreszeiten IV, #1088, wie im Web): wird die Karte angetippt (Karten-Signal #1087), lösen sich die
// Flocken in einer halben Sekunde, fallen 60 bis 120 px mit leichtem Wind und verblassen; die Haube sackt um ihre
// Unterkante auf ein Fünftel und wächst in 90 Sekunden nach. Höchstens einmal je Minute je Karte, nie neben einer
// anderen großen Reaktion; wer mitten im Nachwachsen zurückkommt, sieht sie weiterwachsen.

/** Einzug an den Enden: die Karte hat gerundete Ecken. */
export const CAP_INSET = 10;

/** Wann die Haube einer Karte abgeschüttelt wurde (Kartenschlüssel -> Zeitpunkt) - überdauert ein neues Zeichnen. */
const shaken = new Map<string, number>();
const shakeRest = createRest(REST_MS.big);

/** Nur für Tests: abgeschüttelte Hauben und Ruhezeiten vergessen. */
export function resetSnowShake() {
  shaken.clear();
  shakeRest.clear();
}

type Burst = { id: number; flakes: ShakeFlake[] };

/** Eine Flocke, die sich löst: unsichtbar bis zu ihrem Start, dann fällt sie mit dem Wind und verblasst. */
function FallingFlake({ flake }: { flake: ShakeFlake }) {
  const fall = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(fall, { toValue: 1, duration: flake.dur, delay: flake.delay, easing: Easing.bezier(0.45, 0.05, 0.75, 0.6), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [fall, flake]);
  const keys = [0, 0.01, 0.18, 1];
  return (
    <Animated.View
      style={[styles.flake, { left: flake.x - flake.size / 2, top: flake.y - flake.size / 2, width: flake.size, height: flake.size, borderRadius: flake.size / 2 }, {
        opacity: fall.interpolate({ inputRange: keys, outputRange: [0, 0.95, 0.95, 0] }),
        transform: [
          { translateX: fall.interpolate({ inputRange: keys, outputRange: [0, 0, flake.drift * 0.1, flake.drift] }) },
          { translateY: fall.interpolate({ inputRange: keys, outputRange: [0, 0, 2, flake.fall] }) },
        ],
      }]}
    />
  );
}

export function SnowCap({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { weather } = useSeason();
  const cardKey = useCardKey();
  const [width, setWidth] = useState(0);
  const caps = useMemo(() => seasonCapabilities("snow", screen, season.effective), [screen, season.effective]);
  const year = seasonYear({ key: "snow", starts_at: season.starts_at || "" });
  const level = capLevel({ stage: Number(season.data?.snowcap_stage) || 1, tempC: typeof weather?.temp_c === "number" ? weather.temp_c : null });
  const thickness = capThickness(season.effective === "subtle" ? Math.min(level, 1) : level, capGrowth(`${year}:dashboard-hero`));
  const shape = useMemo(() => (width > 2 * CAP_INSET ? capPath({ width: width - 2 * CAP_INSET, thickness, seed: `${year}:dashboard-hero`, level }) : null), [width, thickness, year, level]);
  const shake = useSnowShake(cardKey, caps.caps && shape ? width - 2 * CAP_INSET : 0, thickness);
  if (!caps.caps) return null;
  return (
    <View pointerEvents="none" style={styles.edge} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} testID="snow-cap">
      {shape ? (
        <View style={[styles.cap, { left: CAP_INSET, top: -shape.base + 1, width: width - 2 * CAP_INSET, height: shape.height + 2 }]} testID="snow-cap-shape" data-level={String(level)} data-shake={shake.phase || undefined}>
          {/* Sacken und Nachwachsen um die Unterkante der Haube (die Kante der Karte): skaliert wird um die Mitte, verschoben so weit, dass die Unterkante liegen bleibt. */}
          <Animated.View style={{ width: width - 2 * CAP_INSET, height: shape.height + 2, transform: [{ translateY: shake.amount.interpolate({ inputRange: [0, 1], outputRange: [shape.base - (shape.height + 2) / 2, 0] }) }, { scaleY: shake.amount }] }}>
            <Svg width={width - 2 * CAP_INSET} height={shape.height + 2}>
              <Path d={shape.d} fill="#f4f8ff" fillOpacity={0.96} stroke="rgba(190, 215, 240, 0.8)" strokeWidth={0.6} />
            </Svg>
          </Animated.View>
        </View>
      ) : null}
      {shake.burst ? (
        <View pointerEvents="none" style={[styles.burst, { left: CAP_INSET }]} testID="snow-shake" data-flakes={String(shake.burst.flakes.length)}>
          {shake.burst.flakes.map((flake, index) => <FallingFlake key={`${shake.burst?.id}-${index}`} flake={flake} />)}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Abschütteln (#1088): `amount` ist, wie viel der Haube liegt (1 = voll), `phase` „drop“ (sackt) oder „grow“ (wächst
 * nach), `burst` die fallenden Flocken. `capWidth` 0 heißt: keine Haube, keine Reaktion.
 */
function useSnowShake(cardKey: string | null, capWidth: number, thickness: number) {
  const amount = useRef(new Animated.Value(1)).current;
  const [phase, setPhase] = useState<"drop" | "grow" | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const tokens = useRef(new Set<ReturnType<typeof startReaction>>());
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  };
  const regrow = (from: number, ms: number) => {
    amount.setValue(from);
    Animated.timing(amount, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }).start();
  };
  // Kommt die Karte mitten im Nachwachsen zurück, wächst die Haube von dort weiter.
  useEffect(() => {
    const at = cardKey ? shaken.get(cardKey) : undefined;
    if (at === undefined) return;
    const elapsed = Date.now() - at;
    if (shakeDone(elapsed)) return;
    const rest = SHAKE.detachMs + SHAKE.regrowMs - Math.max(elapsed, SHAKE.detachMs);
    regrow(shakeLevel(Math.max(elapsed, SHAKE.detachMs)), rest);
    setPhase("grow");
    later(() => setPhase(null), rest + 500);
  }, [cardKey]);
  useEffect(() => () => {
    timers.current.forEach((id) => clearTimeout(id));
    timers.current.clear();
    tokens.current.forEach((token) => endReaction(token));
    tokens.current.clear();
  }, []);
  useCardLift((detail) => {
    if (!cardKey || detail.key !== cardKey || capWidth <= 0) return;
    if (shakeRest.left(cardKey) > 0) return;
    const token = startReaction();
    if (!token) return;
    shakeRest.take(cardKey);
    tokens.current.add(token);
    const now = Date.now();
    shaken.set(cardKey, now);
    const flakes = shakeFlakes({ runs: [{ from: 0, to: capWidth }], thickness, seed: `${cardKey}:${now}` });
    setBurst({ id: now, flakes });
    setPhase("drop");
    amount.setValue(1);
    Animated.sequence([
      Animated.timing(amount, { toValue: SHAKE.keep, duration: SHAKE.detachMs, easing: Easing.bezier(0.3, 0.7, 0.4, 1), useNativeDriver: true }),
      Animated.timing(amount, { toValue: 1, duration: SHAKE.regrowMs, easing: Easing.linear, useNativeDriver: true }),
    ]).start();
    later(() => setPhase("grow"), SHAKE.detachMs + 80);
    later(() => setPhase(null), SHAKE.detachMs + SHAKE.regrowMs + 500);
    later(() => {
      setBurst((current) => (current && current.id === now ? null : current));
      endReaction(token);
      tokens.current.delete(token);
    }, shakeDuration(flakes) + 120);
  }, Boolean(cardKey) && capWidth > 0);
  return { amount, phase, burst };
}

const styles = StyleSheet.create({
  edge: { position: "absolute", left: 0, right: 0, top: 0, height: 1 },
  cap: { position: "absolute" },
  burst: { position: "absolute", top: 0, width: 0, height: 0 },
  flake: { position: "absolute", backgroundColor: "rgba(255, 255, 255, 0.95)" },
});
