import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Ellipse, Line, Path } from "react-native-svg";
import { colors } from "../theme";
import { flightPath, keyframes, nextFlightDelaySeconds, planFlock, type FlightPath } from "./bats";
import { advanceRappel, createRappel, rappelView, type RappelSpec, type RappelState } from "./rappel";
import { between, pick, screenRng } from "./rng";
import type { ActiveSeason } from "./SeasonProvider";
import { useSeason } from "./SeasonProvider";
import { recordSignal } from "./signals";
import { EXTENT, buildPlan, planLines, stepDurationMs, toPixels, webRadius, type WebPlan } from "./webPlan";

// Halloween in der App (#636, #655, #658, #665): dunkel und dezent, und man kann Dingen beim Entstehen zuschauen.
// Ein rundes Netz hängt an drei Fäden in einer oberen Ecke und wird auf vielen Screens sichtbar gesponnen -
// die Spinne läuft in echter Reihenfolge (Anker, Rahmen, Speichen, Nabe, Spirale von außen). Fledermäuse hängen
// unter der Kopfzeile und fliegen beim Antippen davon; ein winziger Friedhof über der Tab-Leiste gibt beim
// Antippen Geister frei; eine Spinne seilt sich vom oberen Rand ab, lässt unten los und läuft weg, der Faden
// schwingt und reißt ab. Dazu der Schwarm, der Kürbis im Dashboard-Kopf und als Tab-Symbol. Jeder Screen
// bekommt aus seinem Namen seine Anordnung; Fledermäuse und Gräber sind die einzigen Dinge, die Berührungen nehmen.

export const SIGNAL_KEY = "halloween_pumpkin";
export const FACES = ["grin", "scared", "wicked"] as const;
export type Face = (typeof FACES)[number];
export const THREAD = "rgba(170,225,240,0.62)";
export const THREAD_SOFT = "rgba(170,225,240,0.42)";
export const EYES = "#9be7ff";
export const RIM = "rgba(170,225,240,0.28)";
const BODY = "#1a1520";
const INK = "#0b0a0f";
/** Höhe der Tab-Leiste ohne den unteren Sicherheitsrand (AppNavigator). */
export const TAB_BAR = 62;
export const GHOST_COOLDOWN_MS = 60000;

export function pumpkinCounts(now: Date = new Date()): boolean {
  return now.getMonth() === 9 && now.getDate() === 31 && now.getHours() >= 18;
}

export type WebSpec = { corner: "tl" | "tr"; factor: number; seed: number; build: boolean };
export type ScreenLayout = {
  web: WebSpec;
  secondWeb: WebSpec | null;
  spider: { side: "left" | "right"; offset: number; size: number; periodMs: number; delayMs: number; drop: number } | null;
  crawler: { firstMs: number; everyMs: number; size: number; durationMs: number } | null;
  rappel: RappelSpec | null;
  hangingBats: Array<{ x: number; size: number; delayMs: number }>;
  graves: Array<{ x: number; size: number; tilt: number }>;
  lanternFace: Face;
};

/** Was dieser Screen bekommt - aus dem Namen berechnet; alle Zufallszahlen immer gezogen, die Stärke schaltet nur ab. */
export function screenLayout(screen: string, intensity: string): ScreenLayout {
  const rng = screenRng(screen, "halloween");
  const full = intensity === "full";
  const subtle = intensity === "subtle";
  const corner: "tl" | "tr" = rng() < 0.7 ? "tl" : "tr";
  const web: WebSpec = { corner, factor: between(rng, 0.85, 1.1), seed: rng(), build: rng() < 0.65 && !subtle };
  const secondRoll = rng();
  const secondSpec: WebSpec = { corner: corner === "tl" ? "tr" : "tl", factor: between(rng, 0.45, 0.6), seed: rng(), build: false };
  const secondWeb = secondRoll < 0.35 ? secondSpec : null;
  const spiderSpec = { side: (corner === "tl" ? "right" : "left") as "left" | "right", offset: between(rng, 0.03, 0.12), size: Math.round(between(rng, 24, 32)), periodMs: Math.round(between(rng, 35, 60)) * 1000, delayMs: Math.round(between(rng, 6, 14)) * 1000, drop: Math.round(between(rng, 70, 130)) };
  const spider = subtle ? null : spiderSpec;
  const crawlerRoll = rng();
  const crawlerSpec = { firstMs: Math.round(between(rng, 40, 90)) * 1000, everyMs: Math.round(between(rng, 120, 260)) * 1000, size: Math.round(between(rng, 24, 32)), durationMs: Math.round(between(rng, 9, 14)) * 1000 };
  const crawler = !subtle && (full || crawlerRoll < 0.4) ? crawlerSpec : null;
  const rappelRoll = rng();
  const rappelSpec: RappelSpec = { side: pick(rng, ["left", "right"]), size: Math.round(between(rng, 22, 28)), speed: between(rng, 26, 40), first: between(rng, 8, 20), rest: between(rng, 40, 90) };
  const rappel = !subtle && rappelRoll < 0.55 ? rappelSpec : null;
  const batCount = Math.floor(rng() * 3);
  const batSpecs = Array.from({ length: 2 }, (_, index) => ({ x: index === 0 ? between(rng, 0.14, 0.42) : between(rng, 0.58, 0.86), size: Math.round(between(rng, 22, 28)), delayMs: Math.round(between(rng, 0, 5)) * 1000 }));
  const hangingBats = subtle ? [] : batSpecs.slice(0, full ? Math.max(1, batCount) : batCount);
  const graveRoll = rng();
  const graveSpecs = Array.from({ length: 2 + Math.floor(rng() * 2) }, (_, index) => ({ x: 0.1 + index * 0.22 + rng() * 0.1, size: Math.round(between(rng, 16, 22)), tilt: between(rng, -7, 7) }));
  const graves = !subtle && graveRoll < 0.6 ? graveSpecs : [];
  return { web, secondWeb, spider, crawler, rappel, hangingBats, graves, lanternFace: pick(rng, [...FACES]) };
}

// ------------------------------------------------------------------ Kunst

/** Die Spinne der ersten Fassung: klein, dünne gebogene Beine, dunkler Körper, Augen im Türkis der Saison. */
export function SpiderShape({ size = 28, thread = true }: { size?: number; thread?: boolean }) {
  return (
    <Svg width={size} height={size * 4} viewBox="0 0 20 80">
      {thread ? <Line x1={10} y1={0} x2={10} y2={62} stroke={THREAD_SOFT} strokeWidth={0.7} /> : null}
      <Ellipse cx={10} cy={66} rx={4.5} ry={5.5} fill={BODY} />
      <Circle cx={10} cy={60.5} r={2.6} fill={BODY} />
      {[-1, 1].map((side) => [0, 1, 2, 3].map((leg) => (
        <Path key={`${side}-${leg}`} d={`M ${10 + side * 3} ${63 + leg * 2} q ${side * 6} ${-4 + leg} ${side * 8} ${2 + leg * 1.5}`} stroke={BODY} strokeWidth={1.1} fill="none" strokeLinecap="round" />
      )))}
      <Circle cx={8.6} cy={60} r={0.6} fill={EYES} />
      <Circle cx={11.4} cy={60} r={0.6} fill={EYES} />
    </Svg>
  );
}

/** Dieselbe Spinne ohne Faden, in Laufrichtung gedreht - für Netzbau und Weglaufen. */
function SpiderBody({ size, heading }: { size: number; heading: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", transform: [{ rotate: `${heading}deg` }] }}>
      <Svg width={size} height={size} viewBox="0 0 20 20">
        <Ellipse cx={10} cy={13} rx={4.5} ry={5.5} fill={BODY} />
        <Circle cx={10} cy={7.5} r={2.6} fill={BODY} />
        {[-1, 1].map((side) => [0, 1, 2, 3].map((leg) => (
          <Path key={`${side}-${leg}`} d={`M ${10 + side * 3} ${10 + leg * 2} q ${side * 6} ${-4 + leg} ${side * 8} ${2 + leg * 1.5}`} stroke={BODY} strokeWidth={1.1} fill="none" strokeLinecap="round" />
        )))}
        <Circle cx={8.6} cy={7} r={0.6} fill={EYES} />
        <Circle cx={11.4} cy={7} r={0.6} fill={EYES} />
      </Svg>
    </View>
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

/** Fledermaus als Silhouette mit einem Hauch hellem Rand. */
export function Bat({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.55} viewBox="0 0 80 44">
      <Path d="M40 24 q-9 -20 -36 -16 q10 3 12 14 q6 -5 12 1 q4 -3 12 1 q8 -4 12 -1 q6 -6 12 -1 q2 -11 12 -14 q-27 -4 -36 16 z" fill="#0f0c14" stroke={RIM} strokeWidth={0.8} strokeLinejoin="round" />
      <Ellipse cx={40} cy={25} rx={4.5} ry={8.5} fill="#0f0c14" />
    </Svg>
  );
}

/** Eine Fledermaus, die kopfüber hängt: Füße oben, Flügel angelegt, Kopf unten mit Ohren und Augen. */
export function HangingBatShape({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.55} viewBox="0 0 40 62">
      <Path d="M18 0 l2 6 l2 -6" stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Path d="M13 12 q-9 12 -3 28 q3 -7 7 -3 z" fill={RIM} transform="translate(-0.6 0)" />
      <Path d="M27 12 q9 12 3 28 q-3 -7 -7 -3 z" fill={RIM} transform="translate(0.6 0)" />
      <Path d="M13 12 q-9 12 -3 28 q3 -7 7 -3 z" fill={INK} />
      <Path d="M27 12 q9 12 3 28 q-3 -7 -7 -3 z" fill={INK} />
      <Ellipse cx={20} cy={24} rx={6.5} ry={12} fill={INK} />
      <Circle cx={20} cy={40} r={5.6} fill={INK} />
      <Path d="M15 43 l-2.5 8 l6.5 -3.5 z M25 43 l2.5 8 l-6.5 -3.5 z" fill={INK} />
      <Circle cx={17.8} cy={40.5} r={0.9} fill={EYES} />
      <Circle cx={22.2} cy={40.5} r={0.9} fill={EYES} />
    </Svg>
  );
}

/** Ein winziger Grabstein, hell genug für Schwarz auf Schwarz. */
export function MiniTombstone({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.1} viewBox="0 0 20 22">
      <Path d="M3 22 v-13 q0 -7 7 -7 q7 0 7 7 v13 z" fill="rgba(170,225,240,0.5)" transform="translate(0 -1)" />
      <Path d="M3 22 v-13 q0 -7 7 -7 q7 0 7 7 v13 z" fill="#2a2734" />
      <Path d="M6 11 h8 M7 14 h6" stroke="rgba(170,225,240,0.5)" strokeWidth={0.9} />
      <Path d="M0 22 h20" stroke="rgba(170,225,240,0.4)" strokeWidth={0.8} />
    </Svg>
  );
}

/** Ein Geist als Schwade: weich, durchscheinend, im Türkis der Saison, nur zwei blasse Augen. */
export function Ghost({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.3} viewBox="0 0 40 52">
      <Path d="M6 30 q0 -24 14 -24 q14 0 14 24 v16 q-3 -4 -7 0 q-3 -4 -7 0 q-3 -4 -7 0 q-4 -4 -7 0 z" fill="rgba(190,235,245,0.22)" />
      <Path d="M9 30 q0 -20 11 -20 q11 0 11 20 v10 q-2 -3 -5.5 0 q-2.5 -3 -5.5 0 q-2.5 -3 -5.5 0 q-3 -3 -5.5 0 z" fill="rgba(190,235,245,0.12)" />
      <Circle cx={15} cy={24} r={1.7} fill="rgba(0,0,0,0.32)" />
      <Circle cx={25} cy={24} r={1.7} fill="rgba(0,0,0,0.32)" />
    </Svg>
  );
}

// ------------------------------------------------------------------ Das Netz

/** Das runde Netz in einer oberen Ecke: fertig auf einmal, oder Faden für Faden mit laufender Spinne. */
export function OrbWeb({ web, width, reduced }: { web: WebSpec; width: number; reduced: boolean }) {
  const plan = useMemo(() => buildPlan(web.seed), [web.seed]);
  const radius = webRadius(width, web.factor);
  const mirror = web.corner === "tr";
  const lines = useMemo(() => planLines(plan, radius, mirror), [plan, radius, mirror]);
  const building = web.build && !reduced;
  const [step, setStep] = useState(building ? 0 : plan.order.length);
  const position = useRef(new Animated.ValueXY(startPoint(plan, radius, mirror))).current;
  const [heading, setHeading] = useState(0);
  const sway = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setStep(building ? 0 : plan.order.length);
    position.setValue(startPoint(plan, radius, mirror));
  }, [building, plan, radius, mirror, position]);

  // Netzbau: ein Schritt nach dem anderen, die Spinne gleitet zum Ende des Fadens, der Faden steht dann.
  useEffect(() => {
    if (!building || step >= plan.order.length) return undefined;
    const item = plan.order[step];
    const from = toPixels(plan.nodes[item.from], radius, mirror);
    const to = toPixels(plan.nodes[item.to], radius, mirror);
    const duration = stepDurationMs(plan, item, radius);
    setHeading((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 90);
    Animated.timing(position, { toValue: to, duration, easing: Easing.linear, useNativeDriver: true }).start();
    // Weiter über die Uhr, nicht über das Animationsende (das feuert im Jest-Umfeld sofort).
    const handle = setTimeout(() => setStep((current) => current + 1), duration);
    return () => clearTimeout(handle);
  }, [building, step, plan, radius, mirror, position]);

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [sway, reduced]);

  const done = step >= plan.order.length;
  const builtThreads = useMemo(() => {
    if (done) return new Set(plan.threads.map((_, index) => index));
    const set = new Set<number>();
    for (let n = 0; n < step; n += 1) {
      const item = plan.order[n];
      if (item.thread !== undefined) set.add(item.thread);
    }
    return set;
  }, [done, step, plan]);
  const boxWidth = EXTENT.x * radius;
  const boxHeight = EXTENT.y * radius;
  const rotate = sway.interpolate({ inputRange: [0, 1], outputRange: ["-0.8deg", "0.8deg"] });
  const hub = toPixels(plan.nodes[0], radius, mirror);
  const spiderSize = Math.max(14, Math.round(radius * 0.22));
  return (
    <Animated.View pointerEvents="none" style={[styles.web, web.corner === "tl" ? { left: 0 } : { right: 0 }, { width: boxWidth, height: boxHeight, transform: [{ rotate }] }]} testID={done ? "halloween-web-built" : "halloween-web-building"}>
      <Svg width={boxWidth} height={boxHeight}>
        {lines.map((line, index) => (builtThreads.has(index) ? (
          <Line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={line.kind === "spiral" ? THREAD_SOFT : THREAD} strokeWidth={line.kind === "spiral" ? 0.65 : 0.9} strokeLinecap="round" />
        ) : null))}
        {done ? plan.dew.map((id) => {
          const point = toPixels(plan.nodes[id], radius, mirror);
          return <Circle key={id} cx={point.x} cy={point.y} r={1.3} fill="rgba(225,246,255,0.85)" />;
        }) : null}
      </Svg>
      {done ? (
        <View pointerEvents="none" style={{ position: "absolute", left: hub.x - spiderSize / 2, top: hub.y - spiderSize / 2 }}>
          <SpiderBody size={spiderSize} heading={0} />
        </View>
      ) : (
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: -spiderSize / 2, top: -spiderSize / 2, transform: [{ translateX: position.x }, { translateY: position.y }] }}>
          <SpiderBody size={spiderSize} heading={heading} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

function startPoint(plan: WebPlan, radius: number, mirror: boolean) {
  return toPixels(plan.nodes[plan.order[0].from], radius, mirror);
}

// ------------------------------------------------------------------ Bewegung

/** Spinne am Faden vom oberen Rand: seilt sich ab, baumelt, zieht sich hoch - alle `periodMs` wieder, nie mitten im Bild. */
function DropSpider({ spec, width, reduced }: { spec: NonNullable<ScreenLayout["spider"]>; width: number; reduced: boolean }) {
  const drop = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(spec.delayMs),
      Animated.timing(drop, { toValue: 1, duration: 3600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(sway, { toValue: -1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
      Animated.delay(2500),
      Animated.timing(drop, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(Math.max(1000, spec.periodMs - spec.delayMs - 10400)),
    ]));
    loop.start();
    return () => loop.stop();
  }, [drop, sway, spec, reduced]);
  if (reduced) return null;
  const translateY = drop.interpolate({ inputRange: [0, 1], outputRange: [-spec.drop - spec.size * 4, 0] });
  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ["-6deg", "6deg"] });
  const offset = Math.round(width * spec.offset);
  return (
    <Animated.View pointerEvents="none" style={[styles.spider, spec.side === "left" ? { left: offset } : { right: offset }, { transform: [{ translateY }, { rotate }] }]} testID={`halloween-spider-${spec.side}`}>
      <SpiderShape size={spec.size} />
    </Animated.View>
  );
}

/** Krabbler: alle `everyMs` läuft eine kleine Spinne unten quer über den Screen. */
function Crawler({ spec, width, bottom, reduced }: { spec: NonNullable<ScreenLayout["crawler"]>; width: number; bottom: number; reduced: boolean }) {
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
      Animated.timing(progress, { toValue: 1, duration: spec.durationMs, easing: Easing.linear, useNativeDriver: true }).start();
      timer = setTimeout(() => {
        legs.stop();
        setRunning(false);
        timer = setTimeout(run, spec.everyMs);
      }, spec.durationMs);
    };
    timer = setTimeout(run, spec.firstMs);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [progress, wiggle, spec, reduced]);
  if (!running || reduced) return null;
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-spec.size * 4, width + spec.size * 4] });
  const scaleY = wiggle.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] });
  return (
    <Animated.View pointerEvents="none" style={[styles.crawler, { bottom, transform: [{ translateX }, { rotate: "-90deg" }, { scaleY }] }]} testID="halloween-crawler">
      <SpiderShape size={spec.size} thread={false} />
    </Animated.View>
  );
}

/** Die Abseil-Spinne: Zustandsfolge aus rappel.ts, 20-mal je Sekunde weitergerechnet; Faden, Spinne, Läufer, loses Ende. */
export function RappelSpider({ spec, width, floorY, reduced }: { spec: RappelSpec; width: number; floorY: number; reduced: boolean }) {
  const [state, setState] = useState<RappelState>(() => createRappel(spec));
  const sway = useRef(new Animated.Value(0)).current;
  const detach = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    let current = createRappel(spec);
    setState(current);
    const handle = setInterval(() => {
      current = advanceRappel(current, 0.05, { floorY, width });
      setState(current);
    }, 50);
    return () => clearInterval(handle);
  }, [spec, floorY, width, reduced]);
  const view = rappelView(state);
  useEffect(() => {
    if (!view.swaying) {
      sway.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [view.swaying, sway]);
  useEffect(() => {
    detach.setValue(0);
    if (!view.detaching) return undefined;
    Animated.timing(detach, { toValue: 1, duration: 2200, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    return undefined;
  }, [view.detaching, detach]);
  if (reduced || !view.thread) return null;
  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ["-2.5deg", "2.5deg"] });
  const flyX = detach.interpolate({ inputRange: [0, 1], outputRange: [0, 70] });
  const flyY = detach.interpolate({ inputRange: [0, 1], outputRange: [0, -140] });
  const opacity = detach.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const edge = Math.round(width * 0.04) + 8;
  return (
    <Animated.View pointerEvents="none" style={[styles.rappel, state.side === "left" ? { left: edge } : { right: edge }, { height: Math.round(state.y), opacity, transform: [{ translateX: flyX }, { translateY: flyY }, { rotate }] }]} testID="halloween-rappel">
      <View style={styles.rappelThread} />
      {view.spiderOnThread ? (
        <View style={{ position: "absolute", bottom: -spec.size * 0.6, left: -spec.size / 2 }}>
          <SpiderBody size={spec.size} heading={0} />
        </View>
      ) : null}
      {view.running ? (
        <View style={{ position: "absolute", bottom: -spec.size * 0.6, left: -spec.size / 2, transform: [{ translateX: state.x }] }} testID="halloween-rappel-runner">
          <SpiderBody size={spec.size} heading={state.runDir > 0 ? 90 : -90} />
        </View>
      ) : null}
      {!view.spiderOnThread && !view.running ? <View style={styles.rappelEnd} /> : null}
    </Animated.View>
  );
}

/** Eine Fledermaus hängt unter der Kopfzeile, zuckt ab und zu; Antippen scheucht sie durchs Bild. */
function HangingBat({ spec, width, height, reduced, onScared }: { spec: ScreenLayout["hangingBats"][number]; width: number; height: number; reduced: boolean; onScared: () => void }) {
  const swing = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const [flight, setFlight] = useState<FlightPath | null>(null);
  const [gone, setGone] = useState(false);
  const start = useMemo(() => ({ x: Math.round(width * spec.x), y: 56 }), [width, spec.x]);
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(spec.delayMs),
      Animated.timing(swing, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(swing, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [swing, spec.delayMs, reduced]);
  useEffect(() => {
    if (!flight) return undefined;
    Animated.timing(progress, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
    const handle = setTimeout(() => {
      setGone(true);
      onScared();
    }, 2800);
    return () => clearTimeout(handle);
  }, [flight, progress, onScared]);
  if (gone) return null;
  if (flight) {
    const frames = keyframes(flight, { x: 0, y: 0 });
    const translateX = progress.interpolate({ inputRange: frames.input, outputRange: frames.xs });
    const translateY = progress.interpolate({ inputRange: frames.input, outputRange: frames.ys });
    const flap = progress.interpolate({ inputRange: Array.from({ length: 33 }, (_, i) => i / 32), outputRange: Array.from({ length: 33 }, (_, i) => (i % 2 ? 0.5 : 1)) });
    return (
      <Animated.View pointerEvents="none" style={[styles.bat, { transform: [{ translateX }, { translateY }, { scaleX: flight.facing }, { scaleY: flap }] }]} testID="halloween-bat-flying">
        <Bat size={spec.size * 1.7} />
      </Animated.View>
    );
  }
  const scare = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const rng = Math.random;
    const dir: 1 | -1 = rng() < 0.5 ? -1 : 1;
    const endX = dir > 0 ? width + 80 : -80;
    const endY = rng() < 0.6 ? Math.min(height - TAB_BAR - 40, start.y + 220 + rng() * 260) : Math.max(-60, start.y - 120 - rng() * 120);
    setFlight({ p0: start, p1: { x: start.x + (endX - start.x) * 0.25, y: start.y - 90 }, p2: { x: start.x + (endX - start.x) * 0.75, y: endY - 60 }, p3: { x: endX, y: endY }, facing: dir });
  };
  const rotate = swing.interpolate({ inputRange: [0, 1], outputRange: ["-3deg", "3deg"] });
  return (
    <Animated.View style={[styles.hangingBat, { left: start.x - spec.size / 2, top: start.y, transform: [{ rotate }] }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fledermaus verscheuchen" onPress={scare} hitSlop={8} testID="halloween-bat-hanging">
        <HangingBatShape size={spec.size} />
      </Pressable>
    </Animated.View>
  );
}

/** Mini-Friedhof über der Tab-Leiste: Antippen lässt einen Geist aufsteigen, je Grab höchstens einen je Minute. */
function Graveyard({ graves, width, bottom, reduced }: { graves: ScreenLayout["graves"]; width: number; bottom: number; reduced: boolean }) {
  const [ghosts, setGhosts] = useState<Array<{ id: number; x: number; dx: number; dy: number }>>([]);
  const lastRef = useRef<Record<number, number>>({});
  const nextId = useRef(0);
  const release = (index: number, x: number) => {
    const now = Date.now();
    if (reduced || now - (lastRef.current[index] || 0) < GHOST_COOLDOWN_MS) return;
    lastRef.current[index] = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    nextId.current += 1;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const distance = 220 + Math.random() * 260;
    setGhosts((current) => [...current, { id: nextId.current, x, dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance }]);
  };
  if (!graves.length) return null;
  return (
    <View pointerEvents="box-none" style={[styles.graveyard, { bottom }]} testID="halloween-graveyard">
      {graves.map((grave, index) => {
        const x = Math.round(width * grave.x);
        return (
          <Pressable key={index} accessibilityRole="button" accessibilityLabel="Grab" onPress={() => release(index, x)} hitSlop={6} style={[styles.grave, { left: x, transform: [{ rotate: `${grave.tilt}deg` }] }]} testID="halloween-grave">
            <MiniTombstone size={grave.size} />
          </Pressable>
        );
      })}
      {ghosts.map((ghost) => <RisingGhost key={ghost.id} ghost={ghost} onDone={() => setGhosts((current) => current.filter((entry) => entry.id !== ghost.id))} />)}
    </View>
  );
}

function RisingGhost({ ghost, onDone }: { ghost: { id: number; x: number; dx: number; dy: number }; onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 6000, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const handle = setTimeout(onDone, 6000);
    return () => clearTimeout(handle);
  }, [progress, onDone]);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, ghost.dx] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, ghost.dy] });
  const opacity = progress.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 1, 0.8, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.15] });
  return (
    <Animated.View pointerEvents="none" style={[styles.ghost, { left: ghost.x - 18, opacity, transform: [{ translateX }, { translateY }, { scale }] }]} testID="halloween-ghost">
      <Ghost />
    </Animated.View>
  );
}

// ------------------------------------------------------------------ Ebenen

export function HalloweenCorners({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useSeason();
  const layout = useMemo(() => screenLayout(screen, season.effective), [screen, season.effective]);
  const moving = !reducedMotion && season.effective !== "subtle";
  const bottom = TAB_BAR + insets.bottom + 4;
  const floorY = Math.max(240, height - insets.top - bottom - 10);
  const [salt, setSalt] = useState(0);
  const onScared = useCallback(() => setSalt((value) => value + 1), []);
  void salt;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="halloween-corners">
      <OrbWeb web={layout.web} width={width} reduced={!moving} />
      {layout.secondWeb ? <OrbWeb web={layout.secondWeb} width={width} reduced={!moving} /> : null}
      {layout.spider ? <DropSpider spec={layout.spider} width={width} reduced={!moving} /> : null}
      {layout.crawler ? <Crawler spec={layout.crawler} width={width} bottom={bottom} reduced={!moving} /> : null}
      {layout.rappel && moving ? <RappelSpider spec={layout.rappel} width={width} floorY={floorY} reduced={!moving} /> : null}
      {moving ? layout.hangingBats.map((bat, index) => <HangingBat key={`${screen}-${index}`} spec={bat} width={width} height={height} reduced={!moving} onScared={onScared} />) : null}
      {moving ? <Graveyard graves={layout.graves} width={width} bottom={bottom} reduced={!moving} /> : null}
    </View>
  );
}

/** Der Kürbis im Dashboard-Kopf: antippen → Gruß als Overlay, Haptik, abends am 31.10. zählt es. */
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

type Flight = { id: number; plan: ReturnType<typeof planFlock>; path: FlightPath };

function FlyingBat({ path, plan, onDone }: { path: FlightPath; plan: ReturnType<typeof planFlock>[number]; onDone: () => void }) {
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
  web: { position: "absolute", top: 0, opacity: 0.85 },
  spider: { position: "absolute", top: 0 },
  crawler: { position: "absolute", left: 0 },
  rappel: { position: "absolute", top: 0, width: 0, transformOrigin: "50% 0%" },
  rappelThread: { position: "absolute", top: 0, bottom: 0, left: 0, width: 1, backgroundColor: "rgba(170,225,240,0.34)" },
  rappelEnd: { position: "absolute", bottom: -8, left: 0, width: 10, height: 9, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "rgba(170,225,240,0.34)", borderBottomRightRadius: 9 },
  hangingBat: { position: "absolute", transformOrigin: "50% 0%" },
  graveyard: { position: "absolute", left: 0, right: 0, height: 0 },
  grave: { position: "absolute", bottom: 0, transformOrigin: "50% 100%" },
  ghost: { position: "absolute", bottom: 4 },
  widget: { alignItems: "center", justifyContent: "center", marginLeft: 6 },
  bat: { position: "absolute", left: 0, top: 0 },
});

export const halloweenColors = colors;
