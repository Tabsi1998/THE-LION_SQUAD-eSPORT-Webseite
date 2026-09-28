import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path } from "react-native-svg";
import { Muted } from "../components/Text";
import { colors } from "../theme";
import { flightPath, keyframes, nextFlightDelaySeconds, planFlock } from "./bats";
import type { ActiveSeason } from "./SeasonProvider";
import { recordSignal } from "./signals";

// Halloween in der App (#636): Spinnweben oben in den Ecken, Fledermäuse alle 90–180 Sekunden über den
// Screen (nachts öfter), die Kürbislaterne im Dashboard-Kopf mit Haptik und Gruß, der Kürbis im Tab „Mehr“.
// Nichts davon fängt Berührungen ab, außer der Laterne selbst.

export const SIGNAL_KEY = "halloween_pumpkin";

/** Zählt der Klick? Nur am 31. Oktober ab 18:00 Ortszeit (der Server prüft später selbst). */
export function pumpkinCounts(now: Date = new Date()): boolean {
  return now.getMonth() === 9 && now.getDate() === 31 && now.getHours() >= 18;
}

export function Cobweb({ size = 110, mirrored = false }: { size?: number; mirrored?: boolean }) {
  const rays = [0, 15, 30, 45, 60, 75, 90];
  const rings = [22, 44, 66, 88, 110];
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={mirrored ? styles.mirrored : undefined}>
      <G stroke="rgba(255,255,255,0.7)" strokeWidth={0.9} fill="none">
        {rays.map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return <Line key={angle} x1={0} y1={0} x2={Math.cos(rad) * 118} y2={Math.sin(rad) * 118} />;
        })}
        {rings.map((radius) => (
          <Path
            key={radius}
            d={rays.slice(0, -1).map((angle, index) => {
              const a1 = (angle * Math.PI) / 180;
              const a2 = (rays[index + 1] * Math.PI) / 180;
              const mid = (a1 + a2) / 2;
              const sag = radius * 0.92;
              return `${index === 0 ? "M" : "L"} ${Math.cos(a1) * radius} ${Math.sin(a1) * radius} Q ${Math.cos(mid) * sag} ${Math.sin(mid) * sag} ${Math.cos(a2) * radius} ${Math.sin(a2) * radius}`;
            }).join(" ")}
          />
        ))}
      </G>
    </Svg>
  );
}

export function Pumpkin({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d="M19 8 q-2 -5 3 -7" stroke="#4d7c2a" strokeWidth={3} fill="none" strokeLinecap="round" />
      <Ellipse cx={20} cy={24} rx={17} ry={13} fill="#ff7a1a" />
      <Ellipse cx={12} cy={24} rx={7} ry={12.5} fill="#f26b0c" opacity={0.8} />
      <Ellipse cx={28} cy={24} rx={7} ry={12.5} fill="#f26b0c" opacity={0.8} />
      <Path d="M11 20 l4 5 l-8 0 z M29 20 l-4 5 l8 0 z" fill="#ffd166" />
      <Path d="M11 29 q9 6 18 0 l-2 3 l-3 -2 l-3 2 l-3 -2 l-3 2 l-3 -2 z" fill="#ffd166" />
    </Svg>
  );
}

export function Bat({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.6} viewBox="0 0 40 24">
      <Path d="M20 14 q-6 -12 -18 -8 q6 2 7 8 q3 -4 7 0 q2 -3 4 -3 q2 0 4 3 q4 -4 7 0 q1 -6 7 -8 q-12 -4 -18 8 z" fill="rgba(12,10,18,0.92)" />
      <Circle cx={18} cy={10} r={0.9} fill="#ff9a3c" />
      <Circle cx={22} cy={10} r={0.9} fill="#ff9a3c" />
    </Svg>
  );
}

export function HalloweenCorners({ season }: { season: ActiveSeason }) {
  const size = season.effective === "subtle" ? 80 : 110;
  return (
    <View pointerEvents="none" style={styles.corners} testID="halloween-corners">
      <View style={styles.cornerLeft}><Cobweb size={size} /></View>
      <View style={styles.cornerRight}><Cobweb size={size} mirrored /></View>
    </View>
  );
}

/** Die Laterne im Dashboard-Kopf: antippen → Gruß und Haptik, abends am 31.10. zählt es. */
export function HalloweenWidget({ season }: { season: ActiveSeason }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wobble = useRef(new Animated.Value(0)).current;
  const greeting = season.texts?.greeting || "Happy Halloween";
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const onPress = () => {
    setOpen(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (season.effective !== "subtle") {
      wobble.setValue(0);
      Animated.sequence([
        Animated.timing(wobble, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(wobble, { toValue: -1, duration: 140, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(wobble, { toValue: 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 4000);
    if (pumpkinCounts()) void recordSignal(SIGNAL_KEY);
  };
  const rotate = wobble.interpolate({ inputRange: [-1, 1], outputRange: ["-10deg", "10deg"] });
  return (
    <View style={styles.widget}>
      <Pressable accessibilityRole="button" accessibilityLabel={greeting} onPress={onPress} hitSlop={8} testID="halloween-lantern">
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Pumpkin size={30} />
        </Animated.View>
      </Pressable>
      {open ? <Muted style={styles.note} testID="halloween-note">{greeting}</Muted> : null}
    </View>
  );
}

type Flight = { id: number; plan: ReturnType<typeof planFlock>; path: ReturnType<typeof flightPath> };

function FlyingBat({ path, plan, onDone }: { path: ReturnType<typeof flightPath>; plan: ReturnType<typeof planFlock>[number]; onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  const frames = useMemo(() => keyframes(path, plan.offset), [path, plan.offset]);
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: plan.durationMs, delay: plan.delayMs, easing: Easing.linear, useNativeDriver: true });
    animation.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => animation.stop();
  }, [onDone, plan.delayMs, plan.durationMs, progress]);
  const translateX = progress.interpolate({ inputRange: frames.input, outputRange: frames.xs });
  const translateY = progress.interpolate({ inputRange: frames.input, outputRange: frames.ys });
  const flap = progress.interpolate({ inputRange: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1], outputRange: Array.from({ length: 21 }, (_, i) => (i % 2 ? 0.6 : 1)) });
  return (
    <Animated.View pointerEvents="none" style={[styles.bat, { transform: [{ translateX }, { translateY }, { scaleX: path.facing * plan.scale }, { scaleY: Animated.multiply(flap, plan.scale) }] }]}>
      <Bat />
    </Animated.View>
  );
}

/** Der Schwarm: nach einer Wartezeit fliegen 3–6 Tiere quer über den Screen, dann Pause bis zum nächsten Mal. */
export function HalloweenBats({ season, reducedMotion }: { season: ActiveSeason; reducedMotion: boolean }) {
  const { width, height } = useWindowDimensions();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [remaining, setRemaining] = useState(0);
  const night = Boolean(season.data?.night);
  const active = !reducedMotion && season.effective !== "subtle";

  useEffect(() => {
    if (!active || flight) return undefined;
    const delay = flight === null && remaining === 0 && !night ? 8000 : nextFlightDelaySeconds(night) * 1000;
    const handle = setTimeout(() => {
      const plan = planFlock(season.effective);
      setRemaining(plan.length);
      setFlight({ id: Date.now(), plan, path: flightPath({ width, height }) });
    }, delay);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, flight, night, season.effective]);

  const onDone = useMemo(() => () => {
    setRemaining((count) => {
      const next = count - 1;
      if (next <= 0) setFlight(null);
      return next;
    });
  }, []);

  if (!active || !flight) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="halloween-bats">
      {flight.plan.map((plan, index) => <FlyingBat key={`${flight.id}-${index}`} path={flight.path} plan={plan} onDone={onDone} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  corners: { position: "absolute", left: 0, right: 0, top: 0, height: 120 },
  cornerLeft: { position: "absolute", left: 0, top: 0, opacity: 0.55 },
  cornerRight: { position: "absolute", right: 0, top: 0, opacity: 0.55 },
  mirrored: { transform: [{ scaleX: -1 }] },
  widget: { alignItems: "center", justifyContent: "center", marginLeft: 6 },
  note: { position: "absolute", top: 36, right: 0, color: "#FFB366", fontSize: 11, backgroundColor: colors.surface, borderColor: "rgba(255,179,102,0.4)", borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, minWidth: 150, textAlign: "right" },
  bat: { position: "absolute", left: 0, top: 0 },
});
