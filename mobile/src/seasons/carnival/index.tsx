import { Canvas, Picture, Skia, createPicture, type SkPicture } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { runOnJS, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, ClipPath, Defs, G, Path } from "react-native-svg";
import { Body } from "../../components/Text";
import { greetingShownToday, localDay, markGreetingShown } from "../christmas/greeting";
import { TAB_BAR, useAppActive } from "../halloween";
import { effectClasses, screenClass } from "../intensity";
import { anyOverlayOpen, subscribeQuiet } from "../quiet";
import { hashString, mulberry32, seasonRng, seasonYear } from "../rng";
import { seasonScroll, type ScrollState } from "../sky/scroll";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { COLORS, burstPieces, confettiWind, rainPieces } from "./confetti";
import { APP_BURST, addFlying, capForApp, confettiIdle, drawConfetti, emptyConfetti, flyingFrom, stepConfetti, type ConfettiState, type Flying, type Ledge } from "./sky";

// Fasching in der App (S12 #643; F1–F3 #745–#747), wie im Web (frontend/src/seasons/carnival): beim ersten Start des
// Tages regnet es Konfetti mit eigener Physik (Skia auf dem UI-Thread), einige Stücke bleiben kurz auf der Tab-Leiste
// liegen. Im Dashboard-Kopf sitzt der Partyhut - antippen lässt ihn wippen, gibt ein leichtes Tippen und wirft eine
// Handvoll Konfetti (höchstens alle zehn Sekunden, ohne Erfolge daran). Der Tab „Mehr“ trägt den Hut als Symbol,
// oben in den Rändern hängen Luftschlangen (beim ersten Mal entfalten sie sich), der Gruß kommt einmal am Tag.
// „dezent“ und „Bewegung reduzieren“: kein Konfetti, der Hut ist nur ein Bild, die Luftschlangen hängen still.

export const RAIN_KEY = "carnival-rain";
export const UNFOLD_KEY = "carnival-unfold";
export const GREETING_KEY = "carnival-greeting";
export const HAT_COOLDOWN_MS = 10000;
export const WIGGLE_MS = 700;
export const TOAST_DELAY_MS = 1500;
export const TOAST_MS = 10000;
const UNFOLD_MS = 2000;

// Was je Start der App nur einmal geschehen darf (Regen, Entfalten) - die Bühne hängt Bausteine auch neu ein.
const once = { rained: false, unfoldChecked: false };

/** Für Tests: alles wie beim Start der App. */
export function resetCarnivalState(): void {
  once.rained = false;
  once.unfoldChecked = false;
  bursts.clear();
}

type Point = { x: number; y: number };
const bursts = new Set<(point: Point) => void>();

/** Eine Explosion an einem Punkt (Fensterkoordinaten) - die Konfetti-Ebene nimmt sie auf, wenn sie lebt. */
export function requestConfettiBurst(point: Point): void {
  bursts.forEach((listener) => listener(point));
}

export function yearOf(season: Pick<ActiveSeason, "starts_at"> | null | undefined): number {
  return seasonYear({ key: "carnival", starts_at: season?.starts_at || "" });
}

/** Wo der Regen fallen darf: auf lebendigen und mittleren Screens - nicht über einem Chat oder den Einstellungen. */
export function rainAllowed(screen: string): boolean {
  const cls = screenClass(screen);
  return cls === "lively" || cls === "medium";
}

/** Die Oberkante der Tab-Leiste (Fensterkoordinaten) - dort dürfen Stücke kurz liegen bleiben. */
export function tabBarLedge(width: number, height: number, bottomInset: number): Ledge {
  return { left: 0, right: width, top: height - TAB_BAR - Math.max(bottomInset, 8) };
}

const EMPTY_PICTURE: SkPicture = createPicture(() => undefined);

/** Die Konfetti-Ebene am Fasching: Regen beim ersten Start des Tages, Explosionen des Huts. */
export function ConfettiSky({ season, screen, reducedMotion }: { season: ActiveSeason; screen: string; reducedMotion: boolean }) {
  return <ConfettiField cap={reducedMotion ? 0 : capForApp(season.effective)} screen={screen} rain />;
}

type ConfettiFieldProps = { cap: number; screen: string; rain?: boolean; palette?: number[] | null; burstSize?: number; seedKey?: string };

/**
 * Eine Konfetti-Ebene über allen Tabs (nie klickbar), für Fasching und Vereinsgeburtstag (#644): `rain` lässt es beim
 * ersten Start des Tages einmal regnen, `palette` beschränkt die Farben, Explosionen kommen über
 * `requestConfettiBurst`. Ohne Stücke gibt es keine Zeichenfläche; nach dem letzten liegenden Stück schläft sie wieder.
 */
export function ConfettiField({ cap, screen, rain = false, palette = null, burstSize = APP_BURST, seedKey = "carnival" }: ConfettiFieldProps) {
  const { weather } = useSeason();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const appActive = useAppActive();
  const [awake, setAwake] = useState(false);
  const rng = useRef(mulberry32(hashString(`${localDay()}:${seedKey}`))).current;

  const state = useSharedValue<ConfettiState>(emptyConfetti());
  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const windValue = useSharedValue(confettiWind(weather));
  const lastScroll = useSharedValue<ScrollState | null>(null);
  const sleeping = useSharedValue(true);
  const scroll = seasonScroll();
  useEffect(() => {
    windValue.value = confettiWind(weather);
  }, [weather, windValue]);

  const throwPieces = useCallback((entries: Flying[]) => {
    if (!entries.length) return;
    state.modify((current) => {
      "worklet";
      return addFlying(current, entries, cap);
    });
    sleeping.value = false;
    setAwake(true);
  }, [cap, state, sleeping]);

  // Der Regen: einmal am Tag, auf dem ersten Screen, wo er fallen darf.
  useEffect(() => {
    if (!rain || cap <= 0 || once.rained || !rainAllowed(screen)) return undefined;
    let cancelled = false;
    void greetingShownToday(RAIN_KEY).then((shown) => {
      if (cancelled || once.rained) return;
      once.rained = true;
      if (shown) return;
      void markGreetingShown(RAIN_KEY);
      throwPieces(flyingFrom(rainPieces(rng, { width, height }, cap, 2500, palette), Date.now(), rng));
    });
    return () => {
      cancelled = true;
    };
  }, [rain, screen, cap, width, height, rng, palette, throwPieces]);

  // Die Explosionen des Huts.
  useEffect(() => {
    if (cap <= 0) return undefined;
    const listener = (point: Point) => throwPieces(flyingFrom(burstPieces(rng, point, Math.min(burstSize, cap), palette), Date.now(), rng));
    bursts.add(listener);
    return () => {
      bursts.delete(listener);
    };
  }, [cap, rng, burstSize, palette, throwPieces]);

  const onIdle = useCallback(() => setAwake(false), []);
  const size = useMemo(() => ({ width, height }), [width, height]);
  const ledge = useMemo(() => tabBarLedge(width, height, insets.bottom), [width, height, insets.bottom]);
  const step = useCallback(() => {
    "worklet";
    const now = Date.now();
    const current = scroll ? scroll.value : null;
    const before = lastScroll.value;
    const scrolled = current && before && current.screen === before.screen ? current.y - before.y : 0;
    lastScroll.value = current ? { screen: current.screen, y: current.y } : null;
    const wind = windValue.value;
    state.modify((confetti) => {
      "worklet";
      return stepConfetti(confetti, now, size, wind, ledge, scrolled);
    });
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, size.width, size.height));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    const front = COLORS.map(([color]) => Skia.Color(color));
    const back = COLORS.map(([, color]) => Skia.Color(color));
    const rect = (x: number, y: number, w: number, h: number) => {
      "worklet";
      return Skia.XYWHRect(x, y, w, h);
    };
    const polygon = (points: Array<[number, number]>) => {
      "worklet";
      const path = Skia.Path.Make();
      points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
      path.close();
      return path;
    };
    drawConfetti(canvas, state.value, now, size, wind, { paint, front, back, rect, polygon });
    picture.value = recorder.finishRecordingAsPicture();
    if (!sleeping.value && confettiIdle(state.value)) {
      sleeping.value = true;
      runOnJS(onIdle)();
    }
  }, [size, ledge, scroll, lastScroll, windValue, state, picture, sleeping, onIdle]);

  const running = cap > 0 && appActive && awake;
  const frame = useFrameCallback(step, running);
  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);

  if (cap <= 0 || !awake) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none" testID="carnival-sky">
      <Picture picture={picture} />
    </Canvas>
  );
}

let hatIds = 0;

/** Der Partyhut - kegelförmig, gestreift, mit Bommel; Vereinsfarben, derselbe wie im Web. */
export function PartyHatArt({ size = 24 }: { size?: number }) {
  const [clip] = useState(() => `tls-hat-cone-${(hatIds += 1)}`);
  return (
    <Svg width={size} height={size * 1.3} viewBox="0 0 40 52">
      <Defs>
        <ClipPath id={clip}><Path d="M20 6 L35 45 Q20 50 5 45 Z" /></ClipPath>
      </Defs>
      <Path d="M20 6 L35 45 Q20 50 5 45 Z" fill="#29B6E8" />
      <G clipPath={`url(#${clip})`}>
        <Path d="M2 30 L38 14 M2 42 L38 26 M2 54 L38 38" stroke="#FFD700" strokeWidth={4.2} />
        <Circle cx={17} cy={23} r={1.6} fill="#ff4fa3" />
        <Circle cx={25} cy={34} r={1.6} fill="#ffffff" />
        <Circle cx={13} cy={38} r={1.4} fill="#ff4fa3" />
      </G>
      <Path d="M5 45 Q20 50 35 45" stroke="#c9a800" strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <Circle cx={20} cy={6} r={4.6} fill="#ff4fa3" />
      <Path d="M17 2.6 l-1.6 -2 M20 1.6 v-1.6 M23 2.6 l1.6 -2" stroke="#ff9ccb" strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  );
}

/** Der Hut als Symbol des Tabs „Mehr“ - etwas schmaler, damit er mit Bommel in die Leiste passt. */
export function PartyHatTabIcon({ size }: { size: number }) {
  return (
    <View style={{ transform: [{ rotate: "-10deg" }] }} testID="carnival-tab-hat">
      <PartyHatArt size={Math.round(size * 0.82)} />
    </View>
  );
}

/**
 * Der Partyhut im Dashboard-Kopf: antippen → wippen, leichtes Tippen, eine Handvoll Konfetti aus dem Hut - höchstens
 * alle zehn Sekunden. Bei „dezent“ und „Bewegung reduzieren“ nur ein Bild, kein Knopf.
 */
export function PartyHatWidget({ season }: { season: ActiveSeason; screen: string }) {
  const { reducedMotion } = useSeason();
  const ref = useRef<View>(null);
  const last = useRef(0);
  const wiggle = useRef(new Animated.Value(0)).current;
  const still = reducedMotion || season.effective === "subtle";
  if (still) {
    return (
      <View style={styles.widget} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="carnival-hat-widget">
        <View style={styles.tilt}><PartyHatArt size={24} /></View>
      </View>
    );
  }
  const onPress = () => {
    const now = Date.now();
    if (now - last.current < HAT_COOLDOWN_MS) return;
    last.current = now;
    void Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
    wiggle.setValue(0);
    Animated.timing(wiggle, { toValue: 1, duration: WIGGLE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const node = ref.current;
    if (node && typeof node.measureInWindow === "function") node.measureInWindow((x, y, w, h) => requestConfettiBurst({ x: x + w / 2, y: y + h * 0.3 }));
  };
  const rotate = wiggle.interpolate({ inputRange: [0, 0.25, 0.55, 0.8, 1], outputRange: ["-12deg", "-24deg", "4deg", "-16deg", "-12deg"] });
  const translateY = wiggle.interpolate({ inputRange: [0, 0.25, 0.55, 1], outputRange: [0, -6, -2, 0] });
  return (
    <Pressable ref={ref} onPress={onPress} accessibilityRole="button" accessibilityLabel="Partyhut – Konfetti werfen" hitSlop={8} style={styles.widget} testID="carnival-hat-widget">
      <Animated.View style={{ transform: [{ translateY }, { rotate }] }} testID="carnival-hat">
        <PartyHatArt size={24} />
      </Animated.View>
    </Pressable>
  );
}

export type AppStreamer = { side: "left" | "right"; offset: number; length: number; curl: number; turns: number; colors: [string, string]; sway: number; delay: number };
const PALETTE: Array<[string, string]> = [["#29B6E8", "#7fd6f5"], ["#FFD700", "#ffe866"], ["#ff4fa3", "#ff9ccb"], ["#3ddc84", "#8ff0bb"], ["#a66bff", "#cbb0ff"], ["#ff8a3d", "#ffbb8a"]];
/** So breit ist eine Luftschlange in der App: sie bleibt im Rand neben den Karten (18 Punkte). */
export const STREAMER_BOX = 14;

/** Die Luftschlangen eines Screens in diesem Jahr: je Seite eine, Länge und Kräuselung aus Jahr und Screen. */
export function appStreamerPlan(year: number, screen: string): AppStreamer[] {
  const rng = seasonRng({ season: "carnival", year, screen }, "streamers");
  return (["left", "right"] as const).map((side) => ({
    side,
    offset: Math.round(1 + rng() * 2),
    length: Math.round(56 + rng() * 44),
    curl: Math.round((2.2 + rng() * 1.2) * 10) / 10,
    turns: Math.round((2.5 + rng() * 1.5) * 10) / 10,
    colors: PALETTE[Math.floor(rng() * PALETTE.length)],
    sway: Math.round((4.5 + rng() * 2.5) * 10) / 10,
    delay: Math.round(rng() * 500),
  }));
}

/** Die Form: oben in der Mitte befestigt, nach unten gekräuselt und weiter schwingend - wie im Web, nur schmaler. */
export function appStreamerPath({ length, curl, turns }: Pick<AppStreamer, "length" | "curl" | "turns">): string {
  const steps = 24;
  const center = STREAMER_BOX / 2;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const s = i / steps;
    const x = Math.sin(s * turns * Math.PI * 2) * curl * (0.35 + 0.65 * s);
    return `${(center + x).toFixed(1)} ${(s * length).toFixed(1)}`;
  });
  return `M ${points[0]} L ${points.slice(1).join(" L ")}`;
}

/** Wie viele Luftschlangen ein Screen bekommt: lebendige zwei, mittlere eine (rechts - links sitzt oft „Zurück“). */
export function streamersFor(plan: AppStreamer[], screen: string, effective: string): AppStreamer[] {
  const corners = effectClasses(screenClass(screen), effective).corner;
  if (corners >= 2) return plan;
  return corners === 1 ? plan.filter((streamer) => streamer.side === "right") : [];
}

function Streamer({ streamer, unfold, moving }: { streamer: AppStreamer; unfold: boolean; moving: boolean }) {
  const drop = useRef(new Animated.Value(unfold ? 0 : 1)).current;
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!unfold) return;
    Animated.timing(drop, { toValue: 1, duration: 1200, delay: streamer.delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [unfold, drop, streamer.delay]);
  useEffect(() => {
    if (!moving) return undefined;
    const half = (streamer.sway * 1000) / 2;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: half * 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => {
      loop.stop();
      sway.setValue(0);
    };
  }, [moving, sway, streamer.sway]);
  const { length } = streamer;
  const d = appStreamerPath(streamer);
  // Gedreht wird um den Aufhängepunkt: die Ebene ist doppelt so hoch und steht mit ihrer Mitte darauf - auf Android
  // dreht `transformOrigin` mit Prozent nicht zuverlässig, die Mitte schon.
  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ["-2.4deg", "2.4deg"] });
  const translateY = drop.interpolate({ inputRange: [0, 1], outputRange: [-length, 0] });
  const place = streamer.side === "left" ? { left: streamer.offset } : { right: streamer.offset };
  return (
    <Animated.View pointerEvents="none" style={[styles.streamerPivot, place, { top: -length, height: length * 2, transform: [{ rotate }] }]} testID="carnival-streamer">
      <View style={[styles.streamerClip, { top: length, height: length + 4 }]}>
        <Animated.View style={{ transform: [{ translateY }] }}>
          <Svg width={STREAMER_BOX} height={length + 4} viewBox={`0 0 ${STREAMER_BOX} ${length + 4}`}>
            <Path d={d} stroke={streamer.colors[0]} strokeWidth={3.4} fill="none" strokeLinecap="round" />
            <Path d={d} stroke={streamer.colors[1]} strokeWidth={1.2} fill="none" strokeLinecap="round" strokeDasharray="4 6" />
          </Svg>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** Oben in den Rändern: Luftschlangen, beim ersten Mal am Tag entfalten sie sich, danach schwingen sie leise. */
export function CarnivalCorners({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { reducedMotion } = useSeason();
  const still = reducedMotion || season.effective === "subtle";
  const [mode, setMode] = useState<"wait" | "unfold" | "hang">(() => (still || once.unfoldChecked ? "hang" : "wait"));
  // Entfaltet wird einmal - danach hängen sie auf jedem weiteren Screen gleich da.
  useEffect(() => {
    if (mode !== "unfold") return undefined;
    const timer = setTimeout(() => setMode("hang"), UNFOLD_MS);
    return () => clearTimeout(timer);
  }, [mode]);
  useEffect(() => {
    if (mode !== "wait") return undefined;
    once.unfoldChecked = true;
    let cancelled = false;
    void greetingShownToday(UNFOLD_KEY).then((shown) => {
      if (cancelled) return;
      if (!shown) void markGreetingShown(UNFOLD_KEY);
      setMode(shown ? "hang" : "unfold");
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);
  const plan = useMemo(() => appStreamerPlan(yearOf(season), screen), [season, screen]);
  const shown = streamersFor(plan, screen, season.effective);
  if (mode === "wait" || !shown.length) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="carnival-corners">
      {shown.map((streamer) => <Streamer key={`${screen}:${streamer.side}`} streamer={streamer} unfold={mode === "unfold"} moving={!still} />)}
    </View>
  );
}

/** Der Gruß einmal am Tag über der Tab-Leiste - nicht auf stillen Screens und nicht unter einem offenen Fenster. */
export function CarnivalGreeting({ season, screen }: { season: ActiveSeason; screen: string }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [covered, setCovered] = useState(() => anyOverlayOpen());
  useEffect(() => subscribeQuiet((quiet) => setCovered(quiet.overlays.length > 0)), []);
  const allowed = screenClass(screen) !== "quiet" && !covered;
  const greeting = season.texts?.greeting || "Schönen Fasching";
  useEffect(() => {
    if (!allowed) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void greetingShownToday(GREETING_KEY).then((shown) => {
      if (cancelled || shown) return;
      timer = setTimeout(() => {
        void markGreetingShown(GREETING_KEY);
        setOpen(true);
      }, TOAST_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [allowed]);
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => setOpen(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [open]);
  if (!open || !allowed) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: TAB_BAR + Math.max(insets.bottom, 8) + 12, width: Math.min(width - 32, 440), left: Math.max(16, (width - 440) / 2) }]}>
      <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={`${greeting}. Schließen`} style={styles.toast} testID="carnival-toast">
        <PartyHatArt size={20} />
        <Body style={styles.toastText}>{greeting}</Body>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  widget: { width: 34, height: 40, alignItems: "center", justifyContent: "center" },
  tilt: { transform: [{ rotate: "-12deg" }] },
  streamerPivot: { position: "absolute", width: STREAMER_BOX },
  streamerClip: { position: "absolute", left: 0, width: STREAMER_BOX, overflow: "hidden" },
  toastWrap: { position: "absolute" },
  toast: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255, 215, 0, 0.35)", backgroundColor: "#0e1220", shadowColor: "#000", shadowOpacity: 0.55, shadowRadius: 25, shadowOffset: { width: 0, height: 18 }, elevation: 12 },
  toastText: { color: "#fff6e0", fontSize: 15, fontWeight: "800", flexShrink: 1 },
});
