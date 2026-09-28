import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { colors } from "../theme";
import { flightPath, keyframes, nextFlightDelaySeconds, planFlock } from "./bats";
import { between, pick, screenRng } from "./rng";
import type { ActiveSeason } from "./SeasonProvider";
import { useSeason } from "./SeasonProvider";
import { recordSignal } from "./signals";

// Halloween in der App (#636, #655): große Spinnweben mit Spinnen, die sich abseilen und ab und zu über
// den Screen krabbeln, Fledermausschwärme mit hellem Rand, hängende Fledermäuse unter der Kopfzeile, Nebel,
// bei „voll“ ein Geist, geschnitzte Kürbisse, die Laterne im Dashboard-Kopf. Jeder Screen bekommt aus seinem
// Namen eine eigene Anordnung. Nichts davon fängt Berührungen ab, außer der Laterne.

export const SIGNAL_KEY = "halloween_pumpkin";
export const FACES = ["grin", "scared", "wicked"] as const;
export type Face = (typeof FACES)[number];

export function pumpkinCounts(now: Date = new Date()): boolean {
  return now.getMonth() === 9 && now.getDate() === 31 && now.getHours() >= 18;
}

export type ScreenLayout = {
  webs: Array<{ corner: "tl" | "tr" | "bl" | "br"; size: number; rotate: number; torn: number[]; build?: boolean; stepMs?: number }>;
  spiders: Array<{ side: "left" | "right"; size: number; periodMs: number; delayMs: number; drop: number }>;
  hangingBats: Array<{ x: number; size: number; periodMs: number; delayMs: number }>;
  crawler: { firstMs: number; everyMs: number; size: number; durationMs: number } | null;
  fog: "none" | "light" | "dense";
  ghost: { firstMs: number; everyMs: number; y: number } | null;
  lanternFace: Face;
};

/** Was dieser Screen bekommt - aus dem Namen berechnet: gleicher Screen, gleiches Bild; anderer Screen, anderes Bild. */
export function screenLayout(screen: string, intensity: string): ScreenLayout {
  const rng = screenRng(screen, "halloween");
  const full = intensity === "full";
  const subtle = intensity === "subtle";
  const webs: ScreenLayout["webs"] = [
    { corner: "tl", size: Math.round(between(rng, 130, 190)), rotate: between(rng, -6, 6), torn: rng() < 0.4 ? [pick(rng, [2, 4, 6])] : [] },
    { corner: "tr", size: Math.round(between(rng, 110, 170)), rotate: between(rng, -6, 6), torn: rng() < 0.4 ? [pick(rng, [3, 5])] : [] },
  ];
  if (rng() < 0.5) webs.push({ corner: rng() < 0.5 ? "bl" : "br", size: Math.round(between(rng, 90, 130)), rotate: 0, torn: [] });
  // Netzbau: auf jedem zweiten Screen baut eine Spinne eines der Netze Faden für Faden (nicht bei dezent).
  if (!subtle && rng() < 0.5) {
    const target = webs[Math.floor(rng() * 2)];
    target.build = true;
    target.stepMs = Math.round(between(rng, 1600, 2600));
  }
  const spiders: ScreenLayout["spiders"] = subtle ? [] : [{ side: "left", size: Math.round(between(rng, 42, 60)), periodMs: Math.round(between(rng, 30, 55)) * 1000, delayMs: 5000, drop: Math.round(between(rng, 90, 170)) }];
  if (!subtle && (full || rng() < 0.55)) spiders.push({ side: "right", size: Math.round(between(rng, 36, 52)), periodMs: Math.round(between(rng, 40, 70)) * 1000, delayMs: Math.round(between(rng, 12, 30)) * 1000, drop: Math.round(between(rng, 70, 140)) });
  const hangingBats: ScreenLayout["hangingBats"] = subtle ? [] : Array.from({ length: 1 + Math.floor(rng() * 2) }, () => ({ x: between(rng, 0.2, 0.8), size: Math.round(between(rng, 36, 50)), periodMs: Math.round(between(rng, 16, 36)) * 1000, delayMs: Math.round(between(rng, 0, 15)) * 1000 }));
  const crawler = subtle ? null : { firstMs: Math.round(between(rng, 20, 60)) * 1000, everyMs: Math.round(between(rng, 90, 220)) * 1000, size: Math.round(between(rng, 52, 76)), durationMs: Math.round(between(rng, 9, 14)) * 1000 };
  const ghost = full && rng() < 0.75 ? { firstMs: Math.round(between(rng, 25, 70)) * 1000, everyMs: Math.round(between(rng, 110, 220)) * 1000, y: between(rng, 0.2, 0.6) } : null;
  return { webs, spiders, hangingBats, crawler, fog: full ? "dense" : subtle ? "none" : "light", ghost, lanternFace: pick(rng, [...FACES]) };
}

// ------------------------------------------------------------------ Kunst

const WEB_RAYS = [0, 11, 22, 34, 46, 58, 70, 80, 90];
const WEB_RINGS = [14, 26, 38, 50, 62, 74, 86, 98, 110];

function webRingPath(radius: number): string {
  return WEB_RAYS.slice(0, -1).map((angle, index) => {
    const a1 = (angle * Math.PI) / 180;
    const a2 = (WEB_RAYS[index + 1] * Math.PI) / 180;
    const mid = (a1 + a2) / 2;
    const sag = radius * 0.9;
    return `${index === 0 ? "M" : "L"} ${(Math.cos(a1) * radius).toFixed(1)} ${(Math.sin(a1) * radius).toFixed(1)} Q ${(Math.cos(mid) * sag).toFixed(1)} ${(Math.sin(mid) * sag).toFixed(1)} ${(Math.cos(a2) * radius).toFixed(1)} ${(Math.sin(a2) * radius).toFixed(1)}`;
  }).join(" ");
}

export const WEB_STEPS = WEB_RAYS.length + WEB_RINGS.length;

/** Wo die Spinne nach Schritt `step` sitzt (im 120er-Raster des Netzes): am Ende des zuletzt gesponnenen Fadens. */
export function webBuilderPoint(step: number): { x: number; y: number } {
  if (step <= 0) return { x: 0, y: 0 };
  if (step <= WEB_RAYS.length) {
    const rad = (WEB_RAYS[step - 1] * Math.PI) / 180;
    return { x: Math.cos(rad) * 118, y: Math.sin(rad) * 118 };
  }
  const radius = WEB_RINGS[Math.min(step - WEB_RAYS.length, WEB_RINGS.length) - 1];
  return { x: 0, y: radius };
}

/** Spinnweb - mit `step` nur die ersten Fäden (Netzbau), sonst ganz. */
export function Cobweb({ size = 150, torn = [] as number[], step = WEB_STEPS }: { size?: number; torn?: number[]; step?: number }) {
  const rays = WEB_RAYS.slice(0, Math.max(0, Math.min(step, WEB_RAYS.length)));
  const rings = WEB_RINGS.slice(0, Math.max(0, Math.min(step - WEB_RAYS.length, WEB_RINGS.length)));
  const complete = step >= WEB_STEPS;
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <G stroke="rgba(255,255,255,0.8)" strokeWidth={0.75} fill="none" strokeLinecap="round">
        {rays.map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return <Line key={angle} x1={0} y1={0} x2={Math.cos(rad) * 118} y2={Math.sin(rad) * 118} />;
        })}
        {rings.map((radius, index) => (
          <Path key={radius} d={webRingPath(radius)} strokeWidth={index % 3 === 2 ? 0.9 : 0.6} strokeDasharray={torn.includes(index) ? "22 6" : undefined} />
        ))}
      </G>
      {complete ? [[38, 21], [61, 44], [23, 66], [80, 38], [52, 79]].map(([x, y]) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.3} fill="rgba(255,255,255,0.9)" />) : null}
    </Svg>
  );
}

/** Netzbau: das Netz entsteht Faden für Faden, die Spinne sitzt am Ende des zuletzt gesponnenen Fadens. */
export function BuildingWeb({ size, torn, stepMs = 2000, reduced = false, mirrored = false }: { size: number; torn: number[]; stepMs?: number; reduced?: boolean; mirrored?: boolean }) {
  const [step, setStep] = useState(reduced ? WEB_STEPS : 0);
  useEffect(() => {
    if (reduced) return undefined;
    const handle = setInterval(() => setStep((current) => (current >= WEB_STEPS ? current : current + 1)), stepMs);
    return () => clearInterval(handle);
  }, [reduced, stepMs]);
  const point = webBuilderPoint(step);
  const scale = size / 120;
  const spiderSize = Math.max(18, Math.round(size * 0.16));
  return (
    <View style={{ width: size, height: size }} testID={step >= WEB_STEPS ? "halloween-web-built" : "halloween-web-building"}>
      <Cobweb size={size} torn={torn} step={step} />
      {step < WEB_STEPS ? (
        <View pointerEvents="none" style={{ position: "absolute", left: point.x * scale - spiderSize / 2, top: point.y * scale - spiderSize * 0.9, transform: [{ scaleX: mirrored ? -1 : 1 }] }}>
          <SpiderShape size={spiderSize} thread={false} />
        </View>
      ) : null}
    </View>
  );
}

export function SpiderShape({ size = 48, thread = true }: { size?: number; thread?: boolean }) {
  return (
    <Svg width={size} height={size * 2.4} viewBox="0 0 40 96">
      {thread ? <Line x1={20} y1={0} x2={20} y2={62} stroke="rgba(255,255,255,0.55)" strokeWidth={0.9} /> : null}
      <Ellipse cx={20} cy={76} rx={9} ry={12} fill="#17121d" />
      <Ellipse cx={20} cy={76} rx={6} ry={8} fill="#241a2c" />
      <Circle cx={20} cy={62} r={5.5} fill="#17121d" />
      {[-1, 1].map((side) => [0, 1, 2, 3].map((leg) => (
        <Path key={`${side}-${leg}`} d={`M ${20 + side * 6} ${64 + leg * 4} q ${side * 12} ${-8 + leg * 2} ${side * 17} ${3 + leg * 3.5} q ${side * 2} 5 ${side * 6} 11`} stroke="#17121d" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      )))}
      <Circle cx={17.5} cy={61} r={1.2} fill="#ff9a3c" />
      <Circle cx={22.5} cy={61} r={1.2} fill="#ff9a3c" />
    </Svg>
  );
}

const FACE_PATHS: Record<Face, React.ReactNode> = {
  grin: <><Path d="M13 22 l5 6 l-10 0 z M27 22 l-5 6 l10 0 z" fill="#ffd166" /><Path d="M9 31 q11 9 22 0 l-2.5 3.5 l-3 -2.2 l-3 2.2 l-3 -2.2 l-3 2.2 l-3 -2.2 l-3 2.2 z" fill="#ffd166" /></>,
  scared: <><Circle cx={14} cy={24} r={3.4} fill="#ffd166" /><Circle cx={26} cy={24} r={3.4} fill="#ffd166" /><Ellipse cx={20} cy={33} rx={3} ry={4.2} fill="#ffd166" /></>,
  wicked: <><Path d="M10 25 l8 -4 l-1 5 z M30 25 l-8 -4 l1 5 z" fill="#ffd166" /><Path d="M11 31 q9 -2 18 0 q-3 5 -9 5 q-6 0 -9 -5 z" fill="#ffd166" /></>,
};

export function Pumpkin({ size = 24, face = "grin" }: { size?: number; face?: Face }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d="M20 9 q-3 -6 3 -8 q-1 4 1 7" stroke="#4d7c2a" strokeWidth={3.2} fill="none" strokeLinecap="round" />
      <Path d="M22 6 q6 -4 9 1 q-5 0 -8 2 z" fill="#5e9a34" />
      <Ellipse cx={20} cy={24} rx={18} ry={14} fill="#ff7a1a" />
      <Ellipse cx={9} cy={24} rx={6} ry={13} fill="#e8620b" opacity={0.85} />
      <Ellipse cx={31} cy={24} rx={6} ry={13} fill="#e8620b" opacity={0.85} />
      <Ellipse cx={20} cy={24} rx={7.5} ry={13.5} fill="#ff8b31" opacity={0.7} />
      {FACE_PATHS[face] || FACE_PATHS.grin}
    </Svg>
  );
}

export function Bat({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.55} viewBox="0 0 80 44">
      <Path d="M40 24 q-9 -20 -36 -16 q10 3 12 14 q6 -5 12 1 q4 -3 12 1 q8 -4 12 -1 q6 -6 12 -1 q2 -11 12 -14 q-27 -4 -36 16 z" fill="#17121d" stroke="rgba(255,255,255,0.45)" strokeWidth={1.2} strokeLinejoin="round" />
      <Ellipse cx={40} cy={25} rx={5} ry={9} fill="#241a2c" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
      <Path d="M36 17 l-3 -6 l5 3 z M44 17 l3 -6 l-5 3 z" fill="#241a2c" />
      <Circle cx={38} cy={21} r={1.3} fill="#ff9a3c" />
      <Circle cx={42} cy={21} r={1.3} fill="#ff9a3c" />
    </Svg>
  );
}

export function Ghost({ size = 70 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.3} viewBox="0 0 60 78">
      <Path d="M8 42 q0 -34 22 -34 q22 0 22 34 v30 l-7 -6 l-7.5 6 l-7.5 -6 l-7.5 6 l-7.5 -6 l-7 6 z" fill="rgba(235,235,255,0.85)" />
      <Circle cx={22} cy={34} r={3.5} fill="#17121d" />
      <Circle cx={38} cy={34} r={3.5} fill="#17121d" />
      <Ellipse cx={30} cy={46} rx={4} ry={6} fill="#17121d" />
    </Svg>
  );
}

// ------------------------------------------------------------------ Bewegung

/** Spinne: seilt sich ab, baumelt, zieht sich hoch - alle `periodMs` wieder. */
function Spider({ spec, reduced }: { spec: ScreenLayout["spiders"][number]; reduced: boolean }) {
  const drop = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(spec.delayMs),
      Animated.timing(drop, { toValue: 1, duration: 3200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(sway, { toValue: -1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
      Animated.delay(2500),
      Animated.timing(drop, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(Math.max(1000, spec.periodMs - spec.delayMs - 10400)),
    ]));
    loop.start();
    return () => loop.stop();
  }, [drop, sway, spec, reduced]);
  if (reduced) return null;
  const translateY = drop.interpolate({ inputRange: [0, 1], outputRange: [-spec.drop - spec.size * 2.4, 0] });
  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ["-7deg", "7deg"] });
  return (
    <Animated.View pointerEvents="none" style={[styles.spider, spec.side === "left" ? { left: 56 } : { right: 48 }, { transform: [{ translateY }, { rotate }] }]} testID={`halloween-spider-${spec.side}`}>
      <SpiderShape size={spec.size} />
    </Animated.View>
  );
}

/** Krabbler: alle `everyMs` läuft eine Spinne unten quer über den Screen. */
function Crawler({ spec, width, reduced }: { spec: NonNullable<ScreenLayout["crawler"]>; width: number; reduced: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (reduced) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const run = () => {
      if (stopped) return;
      setRunning(true);
      progress.setValue(0);
      const legs = Animated.loop(Animated.sequence([
        Animated.timing(wiggle, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]));
      legs.start();
      Animated.timing(progress, { toValue: 1, duration: spec.durationMs, easing: Easing.linear, useNativeDriver: true }).start(() => {
        legs.stop();
        setRunning(false);
        timer = setTimeout(run, spec.everyMs);
      });
    };
    timer = setTimeout(run, spec.firstMs);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [progress, wiggle, spec, reduced]);
  if (!running || reduced) return null;
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-spec.size * 1.2, width + spec.size] });
  const scaleY = wiggle.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] });
  return (
    <Animated.View pointerEvents="none" style={[styles.crawler, { transform: [{ translateX }, { rotate: "-90deg" }, { scaleY }] }]} testID="halloween-crawler">
      <SpiderShape size={spec.size} thread={false} />
    </Animated.View>
  );
}

/** Hängende Fledermaus unter der Kopfzeile: ab und zu ein Flattern. */
function HangingBat({ spec, width, reduced }: { spec: ScreenLayout["hangingBats"][number]; width: number; reduced: boolean }) {
  const flutter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(spec.delayMs),
      Animated.timing(flutter, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(flutter, { toValue: -1, duration: 90, useNativeDriver: true }),
      Animated.timing(flutter, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(flutter, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.delay(Math.max(2000, spec.periodMs - spec.delayMs - 390)),
    ]));
    loop.start();
    return () => loop.stop();
  }, [flutter, spec, reduced]);
  const rotate = flutter.interpolate({ inputRange: [-1, 1], outputRange: ["172deg", "188deg"] });
  return (
    <Animated.View pointerEvents="none" style={[styles.hangingBat, { left: Math.round(width * spec.x) - spec.size / 2, transform: [{ rotate }] }]} testID="halloween-hanging-bat">
      <Bat size={spec.size} />
    </Animated.View>
  );
}

/** Nebel am unteren Rand: Verlauf aus SVG, treibt langsam hin und her. */
function Fog({ dense, width, height, reduced }: { dense: boolean; width: number; height: number; reduced: boolean }) {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 13000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 13000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [drift, reduced]);
  const fogHeight = Math.round(height * (dense ? 0.3 : 0.2));
  const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.06, width * 0.06] });
  return (
    <Animated.View pointerEvents="none" style={[styles.fog, { height: fogHeight, width: width * 1.2, left: -width * 0.1, transform: [{ translateX }] }]} testID="halloween-fog">
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="tls-fog" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="rgb(150,150,175)" stopOpacity={dense ? 0.32 : 0.2} />
            <Stop offset="1" stopColor="rgb(150,150,175)" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#tls-fog)" />
      </Svg>
    </Animated.View>
  );
}

/** Geist: treibt bei „voll“ selten quer über den Screen. */
function DriftingGhost({ spec, width, reduced }: { spec: NonNullable<ScreenLayout["ghost"]>; width: number; reduced: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (reduced) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const run = () => {
      if (stopped) return;
      setVisible(true);
      progress.setValue(0);
      Animated.timing(progress, { toValue: 1, duration: 14000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }).start(() => {
        setVisible(false);
        timer = setTimeout(run, spec.everyMs);
      });
    };
    timer = setTimeout(run, spec.firstMs);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [progress, spec, reduced]);
  if (!visible || reduced) return null;
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-90, width + 90] });
  const translateY = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -26, 8] });
  const opacity = progress.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 0.9, 0.9, 0] });
  return (
    <Animated.View pointerEvents="none" style={[styles.ghost, { top: `${Math.round(spec.y * 100)}%`, opacity, transform: [{ translateX }, { translateY }] }]} testID="halloween-ghost">
      <Ghost />
    </Animated.View>
  );
}

// ------------------------------------------------------------------ Ebenen

export function HalloweenCorners({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { width, height } = useWindowDimensions();
  const { reducedMotion } = useSeason();
  const layout = useMemo(() => screenLayout(screen, season.effective), [screen, season.effective]);
  const dense = layout.fog === "dense" || Boolean(season.data?.night);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="halloween-corners">
      {layout.fog !== "none" ? <Fog dense={dense} width={width} height={height} reduced={reducedMotion} /> : null}
      {layout.webs.map((web) => (
        <View key={web.corner} style={[styles.web, CORNER_STYLES[web.corner], { transform: [{ scaleX: web.corner.endsWith("r") ? -1 : 1 }, { scaleY: web.corner.startsWith("b") ? -1 : 1 }, { rotate: `${web.rotate}deg` }] }]}>
          {web.build ? <BuildingWeb size={web.size} torn={web.torn} stepMs={web.stepMs} reduced={reducedMotion} mirrored={web.corner.endsWith("r")} /> : <Cobweb size={web.size} torn={web.torn} />}
        </View>
      ))}
      {layout.spiders.map((spider) => <Spider key={spider.side} spec={spider} reduced={reducedMotion} />)}
      {layout.hangingBats.map((bat, index) => <HangingBat key={`hang-${index}`} spec={bat} width={width} reduced={reducedMotion} />)}
      {layout.crawler ? <Crawler spec={layout.crawler} width={width} reduced={reducedMotion} /> : null}
      {layout.ghost ? <DriftingGhost spec={layout.ghost} width={width} reduced={reducedMotion} /> : null}
    </View>
  );
}

const CORNER_STYLES: Record<"tl" | "tr" | "bl" | "br", object> = {
  tl: { top: 0, left: 0 },
  tr: { top: 0, right: 0 },
  bl: { bottom: 0, left: 0 },
  br: { bottom: 0, right: 0 },
};

/** Die Laterne im Dashboard-Kopf: antippen → Gruß als Overlay, Haptik, abends am 31.10. zählt es. */
export function HalloweenWidget({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { showToast } = useSeason();
  const layout = useMemo(() => screenLayout(screen, season.effective), [screen, season.effective]);
  const wobble = useRef(new Animated.Value(0)).current;
  const greeting = season.texts?.greeting || "Happy Halloween";
  const onPress = () => {
    showToast(greeting);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (season.effective !== "subtle") {
      wobble.setValue(0);
      Animated.sequence([
        Animated.timing(wobble, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(wobble, { toValue: -1, duration: 140, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(wobble, { toValue: 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
    if (pumpkinCounts()) void recordSignal(SIGNAL_KEY);
  };
  const rotate = wobble.interpolate({ inputRange: [-1, 1], outputRange: ["-12deg", "12deg"] });
  return (
    <View style={styles.widget}>
      <Pressable accessibilityRole="button" accessibilityLabel={greeting} onPress={onPress} hitSlop={10} testID="halloween-lantern">
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Pumpkin size={40} face={layout.lanternFace} />
        </Animated.View>
      </Pressable>
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
  const flap = progress.interpolate({ inputRange: Array.from({ length: 41 }, (_, i) => i / 40), outputRange: Array.from({ length: 41 }, (_, i) => (i % 2 ? 0.55 : 1)) });
  return (
    <Animated.View pointerEvents="none" style={[styles.bat, { transform: [{ translateX }, { translateY }, { scaleX: path.facing * plan.scale }, { scaleY: Animated.multiply(flap, plan.scale) }] }]}>
      <Bat size={26} />
    </Animated.View>
  );
}

/** Der Schwarm: erster Flug nach drei Sekunden, dann Pausen je Screen-Saat; nachts öfter. */
export function HalloweenBats({ season, screen, reducedMotion }: { season: ActiveSeason; screen: string; reducedMotion: boolean }) {
  const { width, height } = useWindowDimensions();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [remaining, setRemaining] = useState(0);
  const rngRef = useRef(screenRng(screen, "bats"));
  const night = Boolean(season.data?.night);
  const active = !reducedMotion && season.effective !== "subtle";

  useEffect(() => {
    rngRef.current = screenRng(screen, "bats");
  }, [screen]);

  useEffect(() => {
    if (!active || flight) return undefined;
    const delay = remaining === 0 && !night ? 3000 : nextFlightDelaySeconds(night, rngRef.current) * 1000;
    const handle = setTimeout(() => {
      const plan = planFlock(season.effective, rngRef.current);
      setRemaining(plan.length);
      setFlight({ id: Date.now(), plan, path: flightPath({ width, height }, rngRef.current) });
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
  web: { position: "absolute", opacity: 0.7 },
  spider: { position: "absolute", top: 54 },
  crawler: { position: "absolute", left: 0, bottom: 70 },
  hangingBat: { position: "absolute", top: 50 },
  fog: { position: "absolute", bottom: 0 },
  ghost: { position: "absolute", left: 0 },
  widget: { alignItems: "center", justifyContent: "center", marginLeft: 6 },
  bat: { position: "absolute", left: 0, top: 0 },
});

export const halloweenColors = colors;
