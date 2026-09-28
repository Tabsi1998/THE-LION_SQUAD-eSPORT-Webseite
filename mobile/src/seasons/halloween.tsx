import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path } from "react-native-svg";
import { colors } from "../theme";
import { flightPath, keyframes, nextFlightDelaySeconds, planFlock } from "./bats";
import { between, pick, screenRng } from "./rng";
import type { ActiveSeason } from "./SeasonProvider";
import { useSeason } from "./SeasonProvider";
import { recordSignal } from "./signals";

// Halloween in der App (#636, #655, #658): dunkel und dezent. Ein Eck-Netz in Silber-Türkis, das eine Spinne
// auf vielen Screens sichtbar spinnt - Faden für Faden; eine kleine Spinne, die sich ab und zu abseilt;
// selten eine, die unten über den Screen krabbelt; wenige Fledermäuse als Silhouetten; der Kürbis im
// Dashboard-Kopf und als Tab-Symbol. Kein Nebel, keine Geister, nichts Hängendes unter der Kopfzeile.
// Jeder Screen bekommt aus seinem Namen eine eigene Anordnung. Nichts fängt Berührungen ab, außer der Kürbis.

export const SIGNAL_KEY = "halloween_pumpkin";
export const FACES = ["grin", "scared", "wicked"] as const;
export type Face = (typeof FACES)[number];
export const THREAD = "rgba(170,225,240,0.62)";
export const THREAD_SOFT = "rgba(170,225,240,0.4)";
export const EYES = "#9be7ff";
const BODY = "#1a1520";

export function pumpkinCounts(now: Date = new Date()): boolean {
  return now.getMonth() === 9 && now.getDate() === 31 && now.getHours() >= 18;
}

export type ScreenLayout = {
  webs: Array<{ corner: "tl" | "tr"; size: number; rotate: number; torn: number[]; build: boolean; stepMs: number }>;
  spiders: Array<{ side: "left" | "right"; size: number; periodMs: number; delayMs: number; drop: number }>;
  crawler: { firstMs: number; everyMs: number; size: number; durationMs: number } | null;
  lanternFace: Face;
};

/** Was dieser Screen bekommt - aus dem Namen berechnet: gleicher Screen, gleiches Bild; anderer Screen, anderes Bild. */
export function screenLayout(screen: string, intensity: string): ScreenLayout {
  const rng = screenRng(screen, "halloween");
  const full = intensity === "full";
  const subtle = intensity === "subtle";
  const mainCorner: "tl" | "tr" = rng() < 0.7 ? "tl" : "tr";
  const webs: ScreenLayout["webs"] = [
    { corner: mainCorner, size: Math.round(between(rng, 96, 140)), rotate: between(rng, -4, 4), torn: rng() < 0.35 ? [pick(rng, [2, 4, 6])] : [], build: !subtle && rng() < 0.6, stepMs: Math.round(between(rng, 700, 1200)) },
  ];
  if (rng() < 0.45) webs.push({ corner: mainCorner === "tl" ? "tr" : "tl", size: Math.round(between(rng, 64, 96)), rotate: between(rng, -4, 4), torn: [], build: false, stepMs: 0 });
  const spiders: ScreenLayout["spiders"] = subtle ? [] : [{ side: mainCorner === "tl" ? "left" : "right", size: Math.round(between(rng, 26, 34)), periodMs: Math.round(between(rng, 35, 60)) * 1000, delayMs: Math.round(between(rng, 6, 14)) * 1000, drop: Math.round(between(rng, 70, 130)) }];
  const crawler = !subtle && (full || rng() < 0.5) ? { firstMs: Math.round(between(rng, 40, 90)) * 1000, everyMs: Math.round(between(rng, 120, 260)) * 1000, size: Math.round(between(rng, 24, 32)), durationMs: Math.round(between(rng, 9, 14)) * 1000 } : null;
  return { webs, spiders, crawler, lanternFace: pick(rng, [...FACES]) };
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

/** Spinnweb in Silber-Türkis - mit `step` nur die ersten Fäden (Netzbau), sonst ganz; fertig mit Tautropfen. */
export function Cobweb({ size = 120, torn = [] as number[], step = WEB_STEPS }: { size?: number; torn?: number[]; step?: number }) {
  const rays = WEB_RAYS.slice(0, Math.max(0, Math.min(step, WEB_RAYS.length)));
  const rings = WEB_RINGS.slice(0, Math.max(0, Math.min(step - WEB_RAYS.length, WEB_RINGS.length)));
  const complete = step >= WEB_STEPS;
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <G stroke={THREAD} strokeWidth={0.7} fill="none" strokeLinecap="round">
        {rays.map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return <Line key={angle} x1={0} y1={0} x2={Math.cos(rad) * 118} y2={Math.sin(rad) * 118} />;
        })}
        {rings.map((radius, index) => (
          <Path key={radius} d={webRingPath(radius)} strokeWidth={index % 3 === 2 ? 0.8 : 0.55} strokeDasharray={torn.includes(index) ? "22 6" : undefined} />
        ))}
      </G>
      {complete ? [[38, 21], [61, 44], [23, 66], [80, 38], [52, 79]].map(([x, y]) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} fill="rgba(220,245,255,0.85)" />) : null}
    </Svg>
  );
}

/** Netzbau: das Netz entsteht Faden für Faden, die Spinne sitzt am Ende des zuletzt gesponnenen Fadens. */
export function BuildingWeb({ size, torn, stepMs = 900, reduced = false, mirrored = false }: { size: number; torn: number[]; stepMs?: number; reduced?: boolean; mirrored?: boolean }) {
  const [step, setStep] = useState(reduced ? WEB_STEPS : 0);
  useEffect(() => {
    if (reduced) return undefined;
    const handle = setInterval(() => setStep((current) => (current >= WEB_STEPS ? current : current + 1)), stepMs);
    return () => clearInterval(handle);
  }, [reduced, stepMs]);
  const point = webBuilderPoint(step);
  const scale = size / 120;
  const spiderSize = Math.max(12, Math.round(size * 0.13));
  return (
    <View style={{ width: size, height: size }} testID={step >= WEB_STEPS ? "halloween-web-built" : "halloween-web-building"}>
      <Cobweb size={size} torn={torn} step={step} />
      {step < WEB_STEPS ? (
        <View pointerEvents="none" style={{ position: "absolute", left: point.x * scale - spiderSize / 2, top: point.y * scale - spiderSize * 3.1, transform: [{ scaleX: mirrored ? -1 : 1 }] }}>
          <SpiderShape size={spiderSize} thread={false} />
        </View>
      ) : null}
    </View>
  );
}

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

/** Fledermaus als Silhouette mit einem Hauch hellem Rand - wie die erste Fassung, nur auf Dunkel besser zu sehen. */
export function Bat({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.55} viewBox="0 0 80 44">
      <Path d="M40 24 q-9 -20 -36 -16 q10 3 12 14 q6 -5 12 1 q4 -3 12 1 q8 -4 12 -1 q6 -6 12 -1 q2 -11 12 -14 q-27 -4 -36 16 z" fill="#0f0c14" stroke="rgba(170,225,240,0.22)" strokeWidth={0.8} strokeLinejoin="round" />
      <Ellipse cx={40} cy={25} rx={4.5} ry={8.5} fill="#0f0c14" />
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
  return (
    <Animated.View pointerEvents="none" style={[styles.spider, spec.side === "left" ? { left: 12 } : { right: 12 }, { transform: [{ translateY }, { rotate }] }]} testID={`halloween-spider-${spec.side}`}>
      <SpiderShape size={spec.size} />
    </Animated.View>
  );
}

/** Krabbler: alle `everyMs` läuft eine kleine Spinne unten quer über den Screen. */
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
      Animated.timing(progress, { toValue: 1, duration: spec.durationMs, easing: Easing.linear, useNativeDriver: true }).start();
      // Sichtbarkeit über die Uhr, nicht über das Animationsende: das feuert im Jest-Umfeld sofort.
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
    <Animated.View pointerEvents="none" style={[styles.crawler, { transform: [{ translateX }, { rotate: "-90deg" }, { scaleY }] }]} testID="halloween-crawler">
      <SpiderShape size={spec.size} thread={false} />
    </Animated.View>
  );
}

// ------------------------------------------------------------------ Ebenen

export function HalloweenCorners({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { width } = useWindowDimensions();
  const { reducedMotion } = useSeason();
  const layout = useMemo(() => screenLayout(screen, season.effective), [screen, season.effective]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="halloween-corners">
      {layout.webs.map((web) => (
        <View key={web.corner} style={[styles.web, CORNER_STYLES[web.corner], { transform: [{ scaleX: web.corner === "tr" ? -1 : 1 }, { rotate: `${web.rotate}deg` }] }]}>
          {web.build ? <BuildingWeb size={web.size} torn={web.torn} stepMs={web.stepMs} reduced={reducedMotion} mirrored={web.corner === "tr"} /> : <Cobweb size={web.size} torn={web.torn} />}
        </View>
      ))}
      {layout.spiders.map((spider) => <Spider key={spider.side} spec={spider} reduced={reducedMotion} />)}
      {layout.crawler ? <Crawler spec={layout.crawler} width={width} reduced={reducedMotion} /> : null}
    </View>
  );
}

const CORNER_STYLES: Record<"tl" | "tr", object> = {
  tl: { top: 0, left: 0 },
  tr: { top: 0, right: 0 },
};

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
  web: { position: "absolute", opacity: 0.75 },
  spider: { position: "absolute", top: 54 },
  crawler: { position: "absolute", left: 0, bottom: 70 },
  widget: { alignItems: "center", justifyContent: "center", marginLeft: 6 },
  bat: { position: "absolute", left: 0, top: 0 },
});

export const halloweenColors = colors;
