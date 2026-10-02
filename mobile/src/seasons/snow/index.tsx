import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Circle, G, Line } from "react-native-svg";
import { useAppActive } from "../halloween";
import { seasonCapabilities } from "../intensity";
import { seasonSeed, seasonYear } from "../rng";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { recordSignal } from "../signals";
import { SnowField } from "../sky/SnowField";
import { seasonScroll } from "../sky/scroll";
import { fadeAt, flakeCounts, snowfallFactor, windFrom } from "./flakes";

// Schnee in der App (#642, Web #766/#768): vom 1. Advent bis Dreikönig schneit es - Flocken in drei Tiefen mit Wind
// und Böen aus dem echten Wetter, dichter, wenn es draußen schneit oder regnet. Dazu die Schneeflocke im
// Dashboard-Kopf zum Fangen: jeder Fang zählt als Saison-Fundstück (#678), fünfzig ergeben den Schneekönig.
// „Bewegung reduzieren“ und „dezent“: kein Schneefall; die Schneeflocke bleibt und hält still.

/** So viele Teilchen verträgt die App (#642: 30 bei „normal“, 60 bei „kräftig“). */
export const SKY_BUDGET = 60;
export const SNOW_SIGNAL = "snowflakes_clicked";
export const SNOW_KING_AT = 50;
export const CLICKS_KEY = "snowflake_clicks";
export const BURST_MS = 650;

/** Stärke → Teilchen wie `budgetFor` im Web: „dezent“ zeichnet nichts, „normal“ die Hälfte, „kräftig“ alles. */
export function skyBudget(intensity: string | null | undefined, base = SKY_BUDGET): number {
  if (intensity === "subtle" || intensity === "off") return 0;
  if (intensity === "full") return base;
  return Math.round(base / 2);
}

/** Der Anteil des Screens: lebendige Screens alles, mittlere 60 %, ruhige und stille nichts - wie `snowKeys` im Web. */
export function snowShare(screen: string, intensity: string = "normal"): number {
  return Number(seasonCapabilities("snow", screen, intensity).flakes) || 0;
}

export function SnowSky({ season, screen, reducedMotion }: { season: ActiveSeason; screen: string; reducedMotion: boolean }) {
  const { weather } = useSeason();
  const { width, height } = useWindowDimensions();
  const active = useAppActive();
  const budget = reducedMotion ? 0 : skyBudget(season.effective);
  const share = snowShare(screen, season.effective);
  if (!budget || share <= 0 || !width || !height) return null;
  const counts = flakeCounts(budget, { share, factor: snowfallFactor(weather, 0.55), fade: fadeAt(season.ends_at) });
  const capacity = flakeCounts(budget, { factor: 1.25 });
  const seed = seasonSeed({ season: "snow", year: seasonYear(season), screen: "sky" });
  return <SnowField capacity={capacity} counts={counts} wind={windFrom(weather)} size={{ width, height }} seed={seed} running={active} scroll={seasonScroll()} testID="snow-sky" />;
}

async function readClicks(): Promise<number> {
  try {
    return Math.max(0, Number(await SecureStore.getItemAsync(CLICKS_KEY)) || 0);
  } catch {
    return 0;
  }
}

async function writeClicks(value: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(CLICKS_KEY, String(value));
  } catch {
    // Dann zählt eben nur der Server.
  }
}

/** Zwölf Splitter, wenn die Flocke gefangen wird - wie im Web, ringsum in drei Weiten. */
export const SHARDS = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2;
  const distance = 14 + (i % 3) * 5;
  return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance };
});

/** Ein sechsstrahliger Kristall - dieselbe Zeichnung wie die Schneeflocke im Web. */
export function SnowflakeShape({ size = 26, color = "#dff6ff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="-14 -14 28 28">
      <Circle cx={0} cy={0} r={11} fill="rgba(155,231,255,0.12)" />
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <G key={angle} rotation={angle} stroke={color} strokeWidth={1.5} strokeLinecap="round" fill="none">
          <Line x1={0} y1={0} x2={0} y2={-12} />
          <Line x1={0} y1={-7} x2={-3.2} y2={-9.6} />
          <Line x1={0} y1={-7} x2={3.2} y2={-9.6} />
          <Line x1={0} y1={-4} x2={-2} y2={-5.6} />
          <Line x1={0} y1={-4} x2={2} y2={-5.6} />
        </G>
      ))}
      <Circle cx={0} cy={0} r={1.6} fill={color} />
    </Svg>
  );
}

export function SnowflakeWidget({ season }: { season: ActiveSeason; screen: string }) {
  const { reducedMotion, showToast } = useSeason();
  const [clicks, setClicks] = useState(0);
  const turn = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const calm = reducedMotion || season.effective === "subtle";
  useEffect(() => {
    let alive = true;
    void readClicks().then((value) => {
      if (alive) setClicks(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (calm) return undefined;
    // Eine Sechstel-Drehung in acht Sekunden - der Kristall sieht danach genauso aus, also ohne Ruck im Kreis.
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => {
      loop.stop();
      turn.setValue(0);
    };
  }, [calm, turn]);
  const onPress = () => {
    const next = clicks + 1;
    setClicks(next);
    void writeClicks(next);
    // Gefangen zählt als Saison-Fundstück (#678) - der Server deckelt je Tag.
    void recordSignal(SNOW_SIGNAL, { onceIf: false });
    void Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
    if (!calm) {
      burst.setValue(0);
      pop.setValue(1);
      Animated.parallel([
        Animated.timing(burst, { toValue: 1, duration: BURST_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(pop, { toValue: 0.2, duration: 160, useNativeDriver: true }),
          Animated.timing(pop, { toValue: 1, duration: 360, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
        ]),
      ]).start();
    }
    if (next === SNOW_KING_AT) showToast("Fünfzig Flocken gefangen – Schneekönig!", 5000);
  };
  const label = clicks >= SNOW_KING_AT ? `Schneeflocke – Schneekönig mit ${clicks} Flocken` : `Schneeflocke fangen – ${clicks} von ${SNOW_KING_AT}`;
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "60deg"] });
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={styles.widget} testID="snow-flake-widget">
      {SHARDS.map((shard, index) => (
        <Animated.View
          key={index}
          pointerEvents="none"
          style={[styles.shard, {
            opacity: burst.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 1, 0] }),
            transform: [{ translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, shard.dx] }) }, { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, shard.dy] }) }],
          }]}
        />
      ))}
      <Animated.View style={{ transform: [{ rotate }, { scale: pop }] }} testID="snow-flake-crystal">
        <SnowflakeShape />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  widget: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  shard: { position: "absolute", left: 15.5, top: 15.5, width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#dff6ff" },
});

