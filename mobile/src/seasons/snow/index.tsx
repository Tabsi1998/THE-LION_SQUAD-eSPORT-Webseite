import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import Svg, { Circle, G, Line } from "react-native-svg";
import { useAppActive } from "../halloween";
import { seasonCapabilities } from "../intensity";
import { seasonSeed, seasonYear } from "../rng";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { recordSignal } from "../signals";
import { SnowField } from "../sky/SnowField";
import { seasonScroll } from "../sky/scroll";
import { tiltSource } from "../tilt";
import { MELT, breakShards, catchStyle, type CatchStyle } from "./catch";
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
  // Neigung (#667): nur solange es schneit und die App vorne ist - der Sensor läuft nicht umsonst.
  const lean = useSharedValue(0);
  const wantsTilt = budget > 0 && share > 0 && active;
  useEffect(() => {
    if (!wantsTilt) {
      lean.value = 0;
      return undefined;
    }
    return tiltSource.subscribe((tilt) => {
      lean.value = tilt.x;
    });
  }, [wantsTilt, lean]);
  if (!budget || share <= 0 || !width || !height) return null;
  const counts = flakeCounts(budget, { share, factor: snowfallFactor(weather, 0.55), fade: fadeAt(season.ends_at) });
  const capacity = flakeCounts(budget, { factor: 1.25 });
  const seed = seasonSeed({ season: "snow", year: seasonYear(season), screen: "sky" });
  return <SnowField capacity={capacity} counts={counts} wind={windFrom(weather)} size={{ width, height }} seed={seed} running={active} scroll={seasonScroll()} lean={lean} testID="snow-sky" />;
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

/** Die Splitter eines brechenden Kristalls (W5 #731) - dieselben wie im Web: je Arm ein langer, dazwischen kleine. */
export const SHARDS = breakShards();

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
  const { reducedMotion, showToast, weather } = useSeason();
  const [clicks, setClicks] = useState(0);
  const [style, setStyle] = useState<CatchStyle | null>(null);
  const turn = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const melt = useRef(new Animated.Value(0)).current;
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
    // Bei Frost bricht der Kristall, bei Tauwetter schmilzt er (W5 #731) - die echte Temperatur am Vereinsort.
    const kind = catchStyle(weather?.temp_c, clicks);
    setClicks(next);
    void writeClicks(next);
    // Gefangen zählt als Saison-Fundstück (#678) - der Server deckelt je Tag.
    void recordSignal(SNOW_SIGNAL, { onceIf: false });
    // Dezent: ein kurzes Tippen beim Bruch, beim Schmelzen nur ein Hauch.
    void Promise.resolve(kind === "melt" ? Haptics.selectionAsync() : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
    if (!calm) {
      setStyle(kind);
      burst.setValue(0);
      melt.setValue(0);
      pop.setValue(1);
      if (kind === "break") {
        Animated.parallel([
          Animated.timing(burst, { toValue: 1, duration: BURST_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(pop, { toValue: 0.2, duration: 160, useNativeDriver: true }),
            Animated.timing(pop, { toValue: 1, duration: 360, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
          ]),
        ]).start();
      } else {
        Animated.parallel([
          Animated.timing(melt, { toValue: 1, duration: MELT.ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(pop, { toValue: 0.3, duration: 300, useNativeDriver: true }),
            Animated.delay(250),
            Animated.timing(pop, { toValue: 1, duration: 350, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
          ]),
        ]).start();
      }
    }
    if (next === SNOW_KING_AT) showToast("Fünfzig Flocken gefangen – Schneekönig!", 5000);
  };
  const label = clicks >= SNOW_KING_AT ? `Schneeflocke – Schneekönig mit ${clicks} Flocken` : `Schneeflocke fangen – ${clicks} von ${SNOW_KING_AT}`;
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "60deg"] });
  // Beim Schmelzen verblasst der Kristall, während er schrumpft; danach wächst eine neue Flocke nach.
  const crystalOpacity = melt.interpolate({ inputRange: [0, 0.35, 0.6, 1], outputRange: [1, 0.15, 0, 1] });
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={styles.widget} testID="snow-flake-widget" data-catch={style || undefined}>
      {style === "break" ? SHARDS.map((shard, index) => (
        <Animated.View
          key={index}
          pointerEvents="none"
          style={[shard.kind === "sliver" ? styles.sliver : styles.chip, {
            opacity: burst.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 1, 0] }),
            transform: [
              { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, shard.dx] }) },
              { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, shard.dy] }) },
              { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: [`${shard.kind === "chip" ? 45 : shard.angle}deg`, `${(shard.kind === "chip" ? 45 : shard.angle) + shard.turn}deg`] }) },
              { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [1, shard.kind === "sliver" ? 0.55 : 1] }) },
            ],
          }]}
          testID={`snow-flake-${shard.kind}`}
        />
      )) : null}
      {style === "melt" ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[styles.drop, {
              opacity: melt.interpolate({ inputRange: [0, 0.25, 0.85, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateY: melt.interpolate({ inputRange: [0, 0.25, 0.85, 1], outputRange: [-2, 0, MELT.fall, MELT.fall + 1] }) },
                { scaleX: melt.interpolate({ inputRange: [0, 0.25, 0.85, 1], outputRange: [0.4, 1, 0.9, 1.2] }) },
                { scaleY: melt.interpolate({ inputRange: [0, 0.25, 0.85, 1], outputRange: [0.4, 1, 1.1, 0.5] }) },
              ],
            }]}
            testID="snow-flake-drop"
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.ripple, {
              opacity: melt.interpolate({ inputRange: [0, 0.8, 0.88, 1], outputRange: [0, 0, 0.8, 0] }),
              transform: [{ scale: melt.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.3, 0.3, 1.8] }) }],
            }]}
            testID="snow-flake-ripple"
          />
        </>
      ) : null}
      <Animated.View style={{ opacity: crystalOpacity, transform: [{ rotate }, { scale: pop }] }} testID="snow-flake-crystal">
        <SnowflakeShape />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  widget: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  sliver: { position: "absolute", left: 16, top: 13, width: 2, height: 8, borderRadius: 1, backgroundColor: "#ffffff" },
  chip: { position: "absolute", left: 15.5, top: 15.5, width: 3, height: 3, backgroundColor: "#e9f4ff" },
  drop: { position: "absolute", left: 14, top: 13, width: 6, height: 8, borderRadius: 3, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: "#a8d4ff" },
  ripple: { position: "absolute", left: 12.5, top: 28.5, width: 9, height: 3, borderRadius: 4.5, borderWidth: 1, borderColor: "rgba(168, 212, 255, 0.75)" },
});

