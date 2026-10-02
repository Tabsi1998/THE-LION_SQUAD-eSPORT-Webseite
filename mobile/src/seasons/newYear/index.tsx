import { Ionicons } from "@expo/vector-icons";
import { BlendMode, Canvas, Picture, Skia, createPicture, type SkPicture } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated as RNAnimated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { runOnJS, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Body } from "../../components/Text";
import { greetingShownToday, markGreetingShown } from "../christmas/greeting";
import { TAB_BAR, useAppActive } from "../halloween";
import { screenClass } from "../intensity";
import { anyOverlayOpen, subscribeQuiet } from "../quiet";
import { hashString, seasonYear } from "../rng";
import { recordSignal } from "../signals";
import { seasonScroll, type ScrollState } from "../sky/scroll";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { handwriting, planHour, salvoLaunches, salvoTimes, type Hand } from "./choreography";
import { countdownState, newYearOf, ZERO_SECONDS } from "./countdown";
import { COLORS, EMBER, soundDelay, windDrift, type Launch } from "./fireworks";
import { capFor, drawFire, emptyFire, fireIdle, nextLaunchAt, stepFire, type FireState } from "./sky";
import { playFireSound, useNewYearSound } from "./sound";

// Silvester in der App (S11 #642; N1–N5 #739–#743), wie auf der Website (#800): ab dem 29.12. abends Raketen nach der
// Rampe des Servers, ab 23:00 der Hinweis im Dashboard-Kopf, ab 23:59:00 der Countdown als Karte oben, um 00:00 der
// Gruß und die Show mit drei großen Salven, danach der Ausklang und am 1. Jänner der Gruß einmal am Tag. Gezeichnet
// mit Skia auf dem UI-Thread (#667), alles nach der Serveruhr. Ton nur nach Einschalten; Haptik nur um Mitternacht und
// bei den großen Salven. „dezent“ und „Bewegung reduzieren“: keine Raketen, Countdown und Gruß stehen still.

export const SIGNAL_KEY = "online_at_new_year";
export const LIVE_PHASES = new Set(["pre_countdown", "countdown", "show", "fade"]);
export const ROCKET_PHASES = new Set(["ramp_29", "ramp_30", "evening_31", "pre_countdown", "countdown", "show", "fade", "greeting"]);
const GREETING_KEY = "new-year-greeting";
const SOUND_HORIZON_MS = 30000;

// Die Bühne hängt den Gruß bei jedem Phasenwechsel neu ein (um 00:00 von „countdown“ auf „show“) - was je Jahr nur
// einmal geschehen darf (Signal, Tippen und Merker um Mitternacht), steht deshalb hier und nicht im Baustein.
const seen: { counted: number | null; zero: number | null } = { counted: null, zero: null };

/** Für Tests: alles wieder wie beim Start der App. */
export function resetNewYearState(): void {
  seen.counted = null;
  seen.zero = null;
}

/** Wie viel Feuerwerk ein Screen bekommt: lebendige alles, mittlere 70 %, ruhige 45 %, stille keins. */
export function fireShare(screen: string): number {
  const cls = screenClass(screen);
  return cls === "lively" ? 1 : cls === "medium" ? 0.7 : cls === "calm" ? 0.45 : 0;
}

let handCache: { year: number | null; hand: Hand | null } = { year: null, hand: null };

export function showYear(season: Pick<ActiveSeason, "starts_at">): number {
  return seasonYear({ key: "new_year", starts_at: season?.starts_at || "" });
}

function handFor(season: ActiveSeason): Hand {
  const year = showYear(season);
  if (handCache.year !== year || !handCache.hand) handCache = { year, hand: handwriting(year) };
  return handCache.hand as Hand;
}

/** Die Raketen der laufenden Stunde (Server) und - in der Show - die drei großen Salven; wie `currentPlan` im Web. */
export function planFor(season: ActiveSeason, serverNow: string | null): Launch[] {
  if (season.key !== "new_year") return [];
  const data = (season.data || {}) as { seed?: number; salvos?: number[]; show_start?: string; salvo_seconds?: number[] };
  const hand = handFor(season);
  const payloadNow = Date.parse(serverNow || "");
  const hourStart = Number.isFinite(payloadNow) ? Math.floor(payloadNow / 3600000) * 3600000 : 0;
  const launches = planHour(hand, { hourSeed: data.seed ?? 0, salvos: Array.isArray(data.salvos) ? data.salvos : [], phase: season.phase, hourStart });
  const showStart = Date.parse(data.show_start || "");
  if (Number.isFinite(showStart) && ["pre_countdown", "countdown", "show"].includes(season.phase)) {
    salvoTimes(showStart, data.salvo_seconds ?? null).forEach((at, index) => launches.push(...salvoLaunches(hand, index, at)));
  }
  return launches;
}

/** Weniger Raketen auf ruhigeren Screens - fest je Rakete (kein Flackern beim Wechsel); große Salven immer. */
export function thinPlan(plan: Launch[], share: number): Launch[] {
  if (share >= 1) return plan;
  if (share <= 0) return [];
  return plan.filter((launch) => launch.id.startsWith("salvo:") || hashString(`keep:${launch.id}`) % 100 < share * 100);
}

const EMPTY_PICTURE: SkPicture = createPicture(() => undefined);

/**
 * Die Feuerwerks-Ebene über allen Tabs (nie klickbar): Skia zeichnet je Bild, was `stepFire` auf dem UI-Thread rechnet.
 * Steht nichts an, schläft sie; der JS-Thread weckt sie rechtzeitig vor der nächsten Rakete. Mit eingeschaltetem Ton
 * zischen und knallen nahe Raketen und die großen Salven.
 */
export function FireworksSky({ season, screen, reducedMotion }: { season: ActiveSeason; screen: string; reducedMotion: boolean }) {
  const { serverOffset, serverNow, weather } = useSeason();
  const { width, height } = useWindowDimensions();
  const appActive = useAppActive();
  const [soundOn] = useNewYearSound();
  const share = fireShare(screen);
  const cap = reducedMotion ? 0 : Math.round(capFor(season.effective) * Math.max(0.5, share));
  const plan = useMemo(() => thinPlan(planFor(season, serverNow), share), [season, serverNow, share]);
  const [awake, setAwake] = useState(true);
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const planValue = useSharedValue<Launch[]>(plan);
  const offsetValue = useSharedValue(serverOffset || 0);
  const windValue = useSharedValue(windDrift(weather));
  const capValue = useSharedValue(cap);
  const state = useSharedValue<FireState>(emptyFire());
  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const lastScroll = useSharedValue<ScrollState | null>(null);
  const sleeping = useSharedValue(false);
  const scroll = seasonScroll();

  useEffect(() => {
    planValue.value = plan;
    sleeping.value = false;
    setAwake(true);
  }, [plan, planValue, sleeping]);
  useEffect(() => {
    offsetValue.value = serverOffset || 0;
  }, [serverOffset, offsetValue]);
  useEffect(() => {
    windValue.value = windDrift(weather);
  }, [weather, windValue]);
  useEffect(() => {
    capValue.value = cap;
  }, [cap, capValue]);

  const onIdle = useCallback(() => {
    setAwake(false);
    if (wakeTimer.current) clearTimeout(wakeTimer.current);
    const now = Date.now() + (serverOffset || 0);
    const next = nextLaunchAt(plan, now);
    if (next === null) return;
    wakeTimer.current = setTimeout(() => {
      sleeping.value = false;
      setAwake(true);
    }, Math.max(0, next - now - 1500));
  }, [plan, serverOffset, sleeping]);
  useEffect(() => () => {
    if (wakeTimer.current) clearTimeout(wakeTimer.current);
  }, []);

  const size = useMemo(() => ({ width, height }), [width, height]);
  const step = useCallback(() => {
    "worklet";
    const now = Date.now() + offsetValue.value;
    const current = scroll ? scroll.value : null;
    const before = lastScroll.value;
    const scrolled = current && before && current.screen === before.screen ? current.y - before.y : 0;
    lastScroll.value = current ? { screen: current.screen, y: current.y } : null;
    const launches = planValue.value;
    const wind = windValue.value;
    const limit = capValue.value;
    state.modify((fire) => {
      "worklet";
      return stepFire(fire, launches, now, size, wind, limit, scrolled);
    });
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, size.width, size.height));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setBlendMode(BlendMode.Plus);
    const smokePaint = Skia.Paint();
    smokePaint.setAntiAlias(true);
    const colors: Record<string, ReturnType<typeof Skia.Color>> = {};
    for (const name of Object.keys(COLORS)) colors[name] = Skia.Color(COLORS[name as keyof typeof COLORS]);
    drawFire(canvas, state.value, now, size, wind, { paint, smokePaint, colors, ember: Skia.Color(EMBER), smoke: Skia.Color("#aaafbe") });
    picture.value = recorder.finishRecordingAsPicture();
    if (!sleeping.value && fireIdle(state.value, launches, now)) {
      sleeping.value = true;
      runOnJS(onIdle)();
    }
  }, [size, scroll, offsetValue, lastScroll, planValue, windValue, capValue, state, picture, sleeping, onIdle]);

  const running = cap > 0 && appActive && awake && plan.length > 0;
  const frame = useFrameCallback(step, running);
  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);

  // Ton (nur eingeschaltet): nahe Raketen und die großen Salven zischen beim Start und knallen nach der Entfernung.
  useEffect(() => {
    if (!soundOn || !running) return undefined;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const scheduled = new Set<string>();
    const plan30 = () => {
      const now = Date.now() + (serverOffset || 0);
      for (const launch of plan) {
        if (scheduled.has(launch.id) || launch.at < now || launch.at > now + SOUND_HORIZON_MS) continue;
        const loud = launch.id.startsWith("salvo:") || launch.distance < 0.4;
        if (!loud) continue;
        scheduled.add(launch.id);
        const startIn = launch.at - now;
        timers.push(setTimeout(() => void playFireSound("whistle", launch.distance), startIn));
        timers.push(setTimeout(() => void playFireSound(`boom-${launch.type}`, launch.distance), startIn + (launch.rise + soundDelay(launch.distance)) * 1000));
      }
    };
    plan30();
    const every = setInterval(plan30, SOUND_HORIZON_MS / 2);
    return () => {
      clearInterval(every);
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [soundOn, running, plan, serverOffset]);

  if (cap <= 0 || plan.length === 0) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none" testID="new-year-sky">
      <Picture picture={picture} />
    </Canvas>
  );
}

/** Die Serverzeit, alle `ms` neu gelesen. */
function useServerClock(ms: number): number {
  const { serverOffset } = useSeason();
  const [now, setNow] = useState(() => Date.now() + (serverOffset || 0));
  useEffect(() => {
    setNow(Date.now() + (serverOffset || 0));
    const timer = setInterval(() => setNow(Date.now() + (serverOffset || 0)), ms);
    return () => clearInterval(timer);
  }, [serverOffset, ms]);
  return now;
}

/** Ton an oder aus - ein runder Knopf mit Lautsprecher wie im Web (durchgestrichen = aus). */
export function SoundSwitch({ testID = "new-year-sound" }: { testID?: string }) {
  const [on, setOn] = useNewYearSound();
  return (
    <Pressable onPress={() => setOn(!on)} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={on ? "Feuerwerk-Ton ausschalten" : "Feuerwerk-Ton einschalten"} hitSlop={10} style={[styles.sound, on && styles.soundOn]} testID={testID}>
      <Ionicons name={on ? "volume-high-outline" : "volume-mute-outline"} size={15} color={on ? "#ffc857" : "rgba(255, 255, 255, 0.75)"} />
    </Pressable>
  );
}

/**
 * Im Dashboard-Kopf: ab 23:00 „noch / 42 Min.“ übereinander, darunter der Ton-Schalter, solange Raketen fliegen können.
 * Schmal wie Kranz und Schneeflocke - in einer Zeile nahm der Hinweis dem Namen in der Begrüßungskarte den Platz.
 */
export function NewYearWidget({ season }: { season: ActiveSeason; screen?: string }) {
  const now = useServerClock(5000);
  const data = (season.data || {}) as { show_start?: string; new_year?: number };
  const state = countdownState(now, Date.parse(data.show_start || ""));
  if (!ROCKET_PHASES.has(season.phase)) return null;
  const year = data.new_year || newYearOf(data.show_start);
  return (
    <View style={styles.widget} testID="new-year-widget">
      {state.stage === "hint" ? (
        <View accessible accessibilityLabel={`Noch ${state.minutes} Minuten bis ${year || "Mitternacht"}`} style={styles.hintBox} testID="new-year-hint">
          <Body style={styles.hintSmall}>noch</Body>
          <Body style={styles.hint}>{state.minutes} Min.</Body>
        </View>
      ) : null}
      {season.effective !== "subtle" ? <SoundSwitch /> : null}
    </View>
  );
}

/**
 * Countdown-Karte oben (ab 23:59:00), Null mit Gruß um Mitternacht, danach einmal am Tag der Gruß über der Tab-Leiste.
 * Zählt „um Mitternacht dabei“ einmal; ein Erfolgs-Tippen um 00:00, ein leichtes zu jeder großen Salve.
 */
export function NewYearGreeting({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { reducedMotion } = useSeason();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const data = (season.data || {}) as { show_start?: string; new_year?: number; salvo_seconds?: number[] };
  const showStart = Date.parse(data.show_start || "");
  const near = ["pre_countdown", "countdown", "show"].includes(season.phase);
  const now = useServerClock(near ? 100 : 5000);
  const state = countdownState(now, showStart);
  const year = data.new_year || newYearOf(data.show_start);
  const still = season.effective === "subtle" || reducedMotion;
  const greeting = season.texts?.greeting || "Frohes neues Jahr wünscht THE LION SQUAD";
  const beat = useRef(new RNAnimated.Value(0)).current;
  const [toast, setToast] = useState(false);
  const [covered, setCovered] = useState(() => anyOverlayOpen());
  useEffect(() => subscribeQuiet((quiet) => setCovered(quiet.overlays.length > 0)), []);

  const showKey = year || 0;
  useEffect(() => {
    if (seen.counted === showKey || !LIVE_PHASES.has(season.phase)) return;
    seen.counted = showKey;
    void recordSignal(SIGNAL_KEY);
  }, [season.phase, showKey]);

  // Um Mitternacht ein Erfolgs-Tippen, zu jeder großen Salve ein leichtes (wenn sie zerplatzt). Wer die Null gesehen
  // hat, bekommt den Gruß danach nicht noch einmal (wie im Web) - der Merker zählt nach dem Tag der Serveruhr.
  useEffect(() => {
    if (state.stage === "zero" && seen.zero !== showKey) {
      seen.zero = showKey;
      void markGreetingShown(GREETING_KEY, new Date(now));
      void Promise.resolve(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage]);
  useEffect(() => {
    if (!Number.isFinite(showStart) || season.effective === "subtle") return undefined;
    const offsetNow = now;
    const timers = salvoTimes(showStart, data.salvo_seconds ?? null)
      .map((at) => at + 1300 - offsetNow)
      .filter((delay) => delay > 0 && delay < 15 * 60 * 1000)
      .map((delay) => setTimeout(() => void Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {}), delay));
    return () => timers.forEach((timer) => clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStart, season.effective]);

  // Puls: jede neue Zahl der letzten zehn Sekunden kommt mit einem Schlag.
  const pulseSecond = state.stage === "pulse" ? state.seconds : null;
  useEffect(() => {
    if (pulseSecond === null || still) return;
    beat.setValue(1);
    RNAnimated.timing(beat, { toValue: 0, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [pulseSecond, still, beat]);

  const afterwards = state.stage === "done" && ["show", "fade", "greeting"].includes(season.phase) && screenClass(screen) !== "quiet" && !covered;
  useEffect(() => {
    if (!afterwards || seen.zero === showKey) return undefined;
    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const today = new Date(now);
    void greetingShownToday(GREETING_KEY, today).then((shown) => {
      if (cancelled || shown) return;
      timers.push(setTimeout(() => {
        void markGreetingShown(GREETING_KEY, today);
        setToast(true);
      }, 1500));
      timers.push(setTimeout(() => setToast(false), 1500 + 12000));
    });
    return () => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afterwards]);

  const cardWidth = Math.min(width - 48, 320);
  if (state.stage === "calm" || state.stage === "pulse") {
    const scale = beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
    return (
      <View pointerEvents="box-none" style={[styles.countWrap, { top: insets.top + 64, width: cardWidth, left: (width - cardWidth) / 2 }]}>
        <View style={styles.countCard} accessibilityRole="timer" accessibilityLabel={`Noch ${state.seconds} Sekunden bis ${year || "zum neuen Jahr"}`} testID="new-year-countdown">
          <Body style={styles.countLabel}>{state.stage === "pulse" ? "Gleich ist es so weit" : "Noch"}</Body>
          <RNAnimated.Text style={[styles.digits, state.stage === "pulse" && styles.digitsPulse, { transform: [{ scale }] }]} testID="new-year-digits">{String(state.seconds)}</RNAnimated.Text>
          <Body style={styles.countLabel}>{state.stage === "pulse" ? `bis ${year || "Mitternacht"}` : `Sekunden bis ${year || "Mitternacht"}`}</Body>
          <View style={styles.countSound}><SoundSwitch testID="new-year-countdown-sound" /></View>
        </View>
      </View>
    );
  }
  if (state.stage === "zero") {
    return (
      <View pointerEvents="none" style={[styles.countWrap, { top: insets.top + 64, width: cardWidth, left: (width - cardWidth) / 2 }]}>
        <View style={styles.countCard} accessibilityLiveRegion="assertive" testID="new-year-zero">
          <Body style={styles.zeroTitle}>Frohes neues Jahr{year ? ` ${year}` : ""}!</Body>
          <Body style={styles.zeroText}>{greeting}</Body>
        </View>
      </View>
    );
  }
  if (!toast) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: TAB_BAR + Math.max(insets.bottom, 8) + 12, width: Math.min(width - 32, 440), left: Math.max(16, (width - 440) / 2) }]}>
      <Pressable onPress={() => setToast(false)} accessibilityRole="button" accessibilityLabel={`Frohes neues Jahr${year ? ` ${year}` : ""}. ${greeting}. Schließen`} style={styles.toast} testID="new-year-toast">
        <Body style={styles.toastTitle}>Frohes neues Jahr{year ? ` ${year}` : ""}</Body>
        <Body style={styles.toastText}>{greeting}</Body>
      </Pressable>
    </View>
  );
}

export { ZERO_SECONDS };

const styles = StyleSheet.create({
  widget: { alignItems: "center", gap: 3 },
  hintBox: { alignItems: "center" },
  hintSmall: { color: "rgba(255, 200, 87, 0.8)", fontSize: 9, lineHeight: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  hint: { color: "#ffc857", fontSize: 12, lineHeight: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  sound: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.18)", backgroundColor: "rgba(255, 255, 255, 0.04)" },
  soundOn: { borderColor: "rgba(255, 200, 87, 0.6)", backgroundColor: "rgba(255, 200, 87, 0.08)" },
  countWrap: { position: "absolute", alignItems: "center" },
  countCard: { width: "100%", alignItems: "center", paddingVertical: 14, paddingHorizontal: 18, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255, 200, 87, 0.35)", backgroundColor: "#0a0c16", shadowColor: "#000", shadowOpacity: 0.55, shadowRadius: 22, shadowOffset: { width: 0, height: 14 }, elevation: 12 },
  countLabel: { color: "#ffc857", fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  digits: { color: "#fff6e0", fontSize: 54, lineHeight: 60, fontWeight: "900", fontVariant: ["tabular-nums"] },
  digitsPulse: { fontSize: 66, lineHeight: 72 },
  countSound: { position: "absolute", top: 8, right: 8 },
  zeroTitle: { color: "#fff6e0", fontSize: 24, fontWeight: "900", textAlign: "center" },
  zeroText: { color: "rgba(255, 246, 224, 0.85)", fontSize: 15, marginTop: 4, textAlign: "center" },
  toastWrap: { position: "absolute" },
  toast: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255, 200, 87, 0.35)", backgroundColor: "#0e1220", shadowColor: "#000", shadowOpacity: 0.55, shadowRadius: 25, shadowOffset: { width: 0, height: 18 }, elevation: 12 },
  toastTitle: { color: "#ffc857", fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  toastText: { color: "#fff6e0", fontSize: 15, marginTop: 3 },
});
