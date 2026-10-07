import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Reanimated, { useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Body } from "../../components/Text";
import { greetingShownToday, localDay, markGreetingShown } from "../christmas/greeting";
import { TAB_BAR, useAppActive } from "../halloween";
import { effectClasses, screenClass } from "../intensity";
import { perchSnapshot, type PerchRect } from "../perches";
import { anyOverlayOpen, subscribeQuiet } from "../quiet";
import { hashString, mulberry32 } from "../rng";
import { seasonScroll, type ScrollState } from "../sky/scroll";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { onHuntActive } from "../easterHunt/api";
import { useCardDecoAssignments } from "../cardDeco";
import { useCardKey } from "../useCardLift";
import { ButterflyWing, EggArt, FlowerArt, GrassStrip, HareEarsArt } from "./art";
import { rollTilt, rollWay, useEggRoll, type EggRoll } from "./cardEgg";
import {
  BUTTERFLY_EVERY, BUTTERFLY_FIRST, PEEK_BOX, PEEK_EVERY, PEEK_FIRST, PETAL_COLORS, butterflyFlight, createPetal, edgeCount, greetingDay, isQuiet, nextDelay, peekSpot, petalCount, petalPose,
  rowPatterns, stepPetal, type EggPattern, type Flight, type Petal,
} from "./plan";

// Ostern in der App (S14 #645, E1 #753, E4 #756 - wie frontend/src/seasons/easter): von Palmsonntag bis Ostermontag.
// Hasenohren trägt der Löwe nicht mehr (#857). An der Unterkante der Begrüßungskarte liegt eine Reihe bemalter Eier
// im Gras, der Tab „Mehr“ trägt ein Osterei. Selten sinkt ein Blütenblatt (sie gehören
// zum Screen und ziehen beim Scrollen mit), bei „voll“ flattert ab und zu ein Zitronenfalter vorbei, und alle paar
// Minuten streckt ein Feldhase die Ohren hinter einer Karte hervor. Ostersonntag und -montag kommt der Gruß.
// Karfreitag ist still: alles da, nichts bewegt sich, kein Gruß. „dezent“ und „Bewegung reduzieren“: alles steht.
// Jahreszeiten IV (#1092): wird die Begrüßungskarte angetippt, wackeln ihre Eier zweimal und das äußerste rollt ein Stück
// zur Ecke; auf einigen weiteren Karten liegt ein Ei, das dasselbe tut (cardEgg.tsx).

export const GREETING_KEY = "easter-greeting";
export const TOAST_DELAY_MS = 1500;
export const TOAST_MS = 10000;
const PEEK_MS = 3400;
const EDGE_EGG = 12;
const EDGE_STEP = 16;

/** Ist die Deko gerade still - ohne Bewegung, „dezent“ oder Karfreitag? */
function useStill(season: ActiveSeason): boolean {
  const { reducedMotion } = useSeason();
  return reducedMotion || season.effective === "subtle" || isQuiet(season);
}

/** Das Osterei am Tab „Mehr“ - je Tag ein anderes Muster. */
export function EasterTabIcon({ size }: { size: number }) {
  const pattern = useMemo(() => rowPatterns(hashString(`easter-tab:${localDay()}`), 1)[0], []);
  return (
    <View style={{ transform: [{ rotate: "-8deg" }] }} testID="easter-tab-egg">
      <EggArt pattern={pattern} size={Math.round(size * 0.72)} />
    </View>
  );
}

/**
 * Hinter dem Inhalt ein helles Frühlingslicht (#753, wie im Web): oben rechts warm, unten links ein Hauch Rosa, unten
 * Grün - am Karfreitag halb so hell; nicht auf stillen Screens.
 */
export function EasterBackdrop({ season, screen }: { season: ActiveSeason; screen: string }) {
  if (screenClass(screen) === "quiet") return null;
  const dim = isQuiet(season) ? 0.5 : 1;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="easter-light">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="easterLightTop" cx="78%" cy="8%" rx="44%" ry="28%">
            <Stop offset="0" stopColor="#faf0be" stopOpacity={0.075 * dim} />
            <Stop offset="0.72" stopColor="#faf0be" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="easterLightPink" cx="14%" cy="86%" rx="40%" ry="24%">
            <Stop offset="0" stopColor="#f6bed2" stopOpacity={0.05 * dim} />
            <Stop offset="0.7" stopColor="#f6bed2" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="easterLightGreen" cx="50%" cy="100%" rx="60%" ry="26%">
            <Stop offset="0" stopColor="#96c882" stopOpacity={0.045 * dim} />
            <Stop offset="0.72" stopColor="#96c882" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#easterLightTop)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#easterLightPink)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#easterLightGreen)" />
      </Svg>
    </View>
  );
}

const EDGE_FLOWERS = ["daisy", "tulip", "primrose", "daisy", "tulip"];

/** So weit darf das äußerste Ei der Reihe zur Ecke der Begrüßungskarte rollen (Mitte bis 14 Punkte vor den Rand). */
export const EDGE_ROLL_ROOM = 18;
/** Das äußerste Ei rollt nach rechts zur Ecke der Begrüßungskarte. */
const EDGE_ROLL_PLAN = { dir: 1 as const, room: EDGE_ROLL_ROOM };

/**
 * Ein Ei der Reihe (oder eine Blume, solange die Suche läuft): wiegt sich langsam, je Stück versetzt; still ohne
 * Bewegung. `roll` (#1092): die Karte wurde angetippt - es wackelt zweimal; `rolls`: es ist das äußerste und rollt
 * dabei zur Ecke, `offset` ist, wo es danach liegt.
 */
function EdgeEgg({ pattern, index, moving, flower = null, roll = null, rolls = false, offset = 0 }: { pattern: EggPattern; index: number; moving: boolean; flower?: string | null; roll?: EggRoll | null; rolls?: boolean; offset?: number }) {
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!moving) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay((index * 370) % 2000),
      Animated.timing(sway, { toValue: 1, duration: 2750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: 5500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 2750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => {
      loop.stop();
      sway.setValue(0);
    };
  }, [moving, index, sway]);
  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ["-4deg", "4deg"] });
  const height = EDGE_EGG * (38 / 30);
  // Gedreht wird um den Fuß des Eis: die Ebene ist doppelt so hoch, ihre Mitte liegt auf dem Fuß (1 px über dem Boden).
  const shift = rolls ? (roll ? rollWay(roll) : offset) : 0;
  // Das Wackeln dreht eine zweite Ebene mit derselben Mitte (dem Fuß des Eis).
  const wobble = roll ? rollTilt(roll, rolls ? 1 : 0) : "0deg";
  return (
    <Animated.View style={[styles.edgeEggPivot, { left: 6 + index * EDGE_STEP, height: height * 2, bottom: -height + 1, transform: [{ translateX: shift }, { rotate }] }]} testID={flower ? "easter-edge-flower" : "easter-edge-egg"} data-roll={roll ? "1" : undefined} data-offset={rolls ? String(offset) : undefined}>
      <Animated.View style={{ width: EDGE_EGG, height: height * 2, transform: [{ rotate: wobble }] }}>
        {flower ? <FlowerArt kind={flower} height={height} /> : <EggArt pattern={pattern} size={EDGE_EGG} />}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Die Reihe an der Unterkante der Begrüßungskarte (#645 „Eier-Reihe im Dashboard-Kopf“): rechts, das Gras wächst auf
 * der Kante, die Eier stehen darin - oben bleiben sie im Innenabstand der Karte, unter dem Inhalt. Fünf Eier (schmal
 * vier), je Tag neu gemischt. Nie klickbar.
 */
export function EasterEdge({ season, screen }: { season: ActiveSeason; screen: string }) {
  const still = useStill(season);
  const { width } = useWindowDimensions();
  // Läuft die Eiersuche wirklich, liegen hier Blumen statt Eiern: Eier, die man nicht sammeln kann, sähen sonst genauso
  // aus wie die versteckten (wie im Web). Bis feststeht, ob sie läuft, auch Blumen.
  const { byKey } = useSeason();
  const huntWindow = Boolean(byKey?.easter_hunt && byKey.easter_hunt.effective !== "off");
  const [huntActive, setHuntActive] = useState<boolean | null>(null);
  useEffect(() => (huntWindow ? onHuntActive(setHuntActive) : undefined), [huntWindow]);
  const flowers = huntWindow && huntActive !== false;
  const count = edgeCount(width);
  const patterns = useMemo(() => rowPatterns(hashString(`easter-edge:${localDay()}`), count), [count]);
  // Antippen der Begrüßungskarte (#1092): alle Eier wackeln, das äußerste rollt zur Ecke - nicht die Blumen, nicht am Karfreitag.
  const cardKey = useCardKey();
  const shown = screenClass(screen) !== "quiet";
  const { offset, roll } = useEggRoll(shown && !flowers ? cardKey : null, "edge-row", EDGE_ROLL_PLAN, !isQuiet(season));
  if (!shown) return null;
  const rowWidth = count * EDGE_STEP + 12;
  return (
    <View pointerEvents="none" style={[styles.edge, { width: rowWidth }]} testID="easter-edge">
      {patterns.map((pattern, index) => <EdgeEgg key={pattern} pattern={pattern} index={index} moving={!still} flower={flowers ? EDGE_FLOWERS[index % EDGE_FLOWERS.length] : null} roll={flowers ? null : roll} rolls={index === patterns.length - 1} offset={offset} />)}
      <View style={styles.edgeGrass}>
        <GrassStrip width={rowWidth} height={7} />
      </View>
    </View>
  );
}

/**
 * Eier an Karten (Jahreszeiten IV, Variante B, #1092): auf einigen Karten des Screens liegt ein Ei auf der Oberkante
 * (cardDeco.tsx wählt sie aus) - nicht auf stillen Screens und nicht, solange die Eiersuche läuft (deren Eier liegen
 * dann an den Karten und sähen genauso aus).
 */
export function EasterCorners({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { byKey } = useSeason();
  const huntWindow = Boolean(byKey?.easter_hunt && byKey.easter_hunt.effective !== "off");
  const [huntActive, setHuntActive] = useState<boolean | null>(null);
  useEffect(() => (huntWindow ? onHuntActive(setHuntActive) : undefined), [huntWindow]);
  useCardDecoAssignments(season, screen, "egg", screenClass(screen) !== "quiet" && (!huntWindow || huntActive === false));
  return null;
}

/** Ein Blütenblatt: Lage aus dem gemeinsamen Zustand, Form ein Oval mit Spitze (gedreht, taumelnd). */
function PetalSprite({ index, petals, petal }: { index: number; petals: SharedValue<Petal[]>; petal: Petal }) {
  const style = useAnimatedStyle(() => {
    const current = petals.value[index];
    if (!current) return { opacity: 0, transform: [{ translateX: -50 }, { translateY: -50 }, { rotate: "0rad" }, { scaleY: 1 }] };
    const pose = petalPose(current);
    return { opacity: 0.92, transform: [{ translateX: pose.x - current.r }, { translateY: pose.y - current.r * 0.6 }, { rotate: `${current.angle}rad` }, { scaleY: pose.squash }] };
  });
  return <Reanimated.View style={[styles.petal, { width: petal.r * 2, height: petal.r * 1.2, borderRadius: petal.r, backgroundColor: PETAL_COLORS[petal.color] }, style]} testID={`easter-petal-${index}`} />;
}

/** Die wenigen Blätter über dem Screen: sie sinken auf dem UI-Thread und ziehen beim Scrollen mit. */
export function PetalField({ count, size, running, scroll }: { count: number; size: { width: number; height: number }; running: boolean; scroll: SharedValue<ScrollState> | null }) {
  const initial = useMemo(() => {
    const rng = mulberry32(hashString(`easter-petals:${localDay()}:${size.width}x${size.height}`));
    return Array.from({ length: count }, () => createPetal(rng, size.width, size.height, true));
  }, [count, size.width, size.height]);
  const petals = useSharedValue<Petal[]>(initial);
  const clock = useSharedValue<{ screen: string; y: number }>({ screen: "", y: 0 });
  useEffect(() => {
    petals.value = initial;
  }, [initial, petals]);
  const width = size.width;
  const height = size.height;
  const step = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    "worklet";
    const dt = Math.min(0.1, Math.max(0, (info.timeSincePreviousFrame ?? 16) / 1000));
    // Scrollen schiebt die Blätter - nur innerhalb desselben Screens; ein Wechsel springt nicht.
    const now = scroll ? scroll.value : null;
    const before = clock.value;
    const shift = now && now.screen === before.screen ? now.y - before.y : 0;
    clock.value = { screen: now ? now.screen : "", y: now ? now.y : 0 };
    petals.modify((list) => {
      "worklet";
      return list.map((petal) => stepPetal(petal, dt, shift, width, height, Math.random));
    });
  }, [scroll, clock, petals, width, height]);
  const frame = useFrameCallback(step, running);
  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="easter-petals">
      {initial.map((petal, index) => <PetalSprite key={index} index={index} petals={petals} petal={petal} />)}
    </View>
  );
}

/** Ein Flug des Zitronenfalters quer über den Screen: Bahn, Bogen, Flügelschlag (alles auf dem nativen Treiber). */
function ButterflyFlight({ flight, width, height, onDone }: { flight: Flight; width: number; height: number; onDone: () => void }) {
  const travel = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const flap = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const across = Animated.timing(travel, { toValue: 1, duration: flight.seconds * 1000, easing: Easing.linear, useNativeDriver: true });
    const bobbing = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const flapping = Animated.loop(Animated.sequence([
      Animated.timing(flap, { toValue: 1, duration: 140, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(flap, { toValue: 0, duration: 140, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    bobbing.start();
    flapping.start();
    across.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => {
      across.stop();
      bobbing.stop();
      flapping.stop();
    };
  }, [flight, travel, bob, flap, onDone]);
  const from = flight.fromLeft ? -flight.size - 10 : width + 10;
  const to = flight.fromLeft ? width + 10 : -flight.size - 10;
  const translateX = travel.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -flight.bob] });
  const wing = flap.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] });
  const half = Math.round(flight.size / 2);
  return (
    <Animated.View pointerEvents="none" style={[styles.butterfly, { top: Math.round(height * flight.y), width: flight.size, height: flight.size * 0.8, transform: [{ translateX }, { translateY }] }]} testID="easter-butterfly">
      {/* Jede Flügelseite schlägt um den Körper: die Ebene ist doppelt so breit, ihre Mitte liegt am Körper. */}
      <Animated.View style={[styles.wingPivot, { width: half * 2, height: flight.size * 0.8, transform: [{ scaleX: wing }] }]}>
        <View style={{ width: half }}><ButterflyWing size={half} side="left" /></View>
      </Animated.View>
      <Animated.View style={[styles.wingPivot, { width: half * 2, height: flight.size * 0.8, transform: [{ scaleX: wing }] }]}>
        <View style={{ width: half, marginLeft: half }}><ButterflyWing size={half} side="right" /></View>
      </Animated.View>
      <View style={[styles.body, { left: half - 1, height: flight.size * 0.5, top: flight.size * 0.15 }]} />
    </Animated.View>
  );
}

/** Ein Takt für seltene Momente: `act()` zuerst nach `first`, dann nach `every` - nicht im Hintergrund. */
function useMoments(first: [number, number], every: [number, number], act: (rng: () => number) => void, enabled: boolean) {
  const actRef = useRef(act);
  useEffect(() => {
    actRef.current = act;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const rng = mulberry32(Date.now() >>> 0);
    let timer: ReturnType<typeof setTimeout> = setTimeout(function run() {
      actRef.current(rng);
      timer = setTimeout(run, nextDelay(rng, every));
    }, nextDelay(rng, first));
    return () => clearTimeout(timer);
  }, [first, every, enabled]);
}

/** Die Ohren des Feldhasen über einer Karte: steigen auf, bleiben kurz, sinken - geht beim Scrollen sofort. */
function HarePeekView({ spot, onDone }: { spot: { x: number; y: number }; onDone: () => void }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.sequence([
      Animated.timing(rise, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(PEEK_MS - 1200),
      Animated.timing(rise, { toValue: 0, duration: 600, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    run.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => run.stop();
  }, [rise, onDone]);
  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [PEEK_BOX.height + 2, 3] });
  return (
    <View pointerEvents="none" style={[styles.peek, { left: spot.x, top: spot.y, width: PEEK_BOX.width, height: PEEK_BOX.height }]} testID="easter-hare">
      <Animated.View style={{ transform: [{ translateY }] }}>
        <HareEarsArt width={PEEK_BOX.width - 2} />
      </Animated.View>
    </View>
  );
}

async function measurePerches(screen: string): Promise<PerchRect[]> {
  const perches = perchSnapshot().perches.filter((perch) => perch.screen === screen && (perch.kind === "card" || perch.kind === "tile"));
  const rects = await Promise.all(perches.map((perch) => perch.measure().catch(() => null)));
  return rects.filter((rect): rect is PerchRect => Boolean(rect));
}

/**
 * Über allen Tabs (nie klickbar): wenige Blätter, bei „voll“ ab und zu ein Zitronenfalter, alle paar Minuten der
 * Feldhase. Nur mit Bewegung, nicht am Karfreitag, nicht auf stillen Screens, nicht im Hintergrund.
 */
export function EasterSky({ season, screen, reducedMotion }: { season: ActiveSeason; screen: string; reducedMotion: boolean }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const active = useAppActive();
  const quiet = isQuiet(season);
  const fx = effectClasses(screenClass(screen), season.effective);
  const moving = !reducedMotion && season.effective !== "subtle" && !quiet && fx.cls !== "quiet";
  const petals = moving ? petalCount(screen, season.effective) : 0;
  const [flight, setFlight] = useState<(Flight & { id: number }) | null>(null);
  const [peek, setPeek] = useState<{ x: number; y: number; id: number } | null>(null);
  const screenRef = useRef(screen);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  useMoments(BUTTERFLY_FIRST, BUTTERFLY_EVERY, (rng) => setFlight({ ...butterflyFlight(rng), id: Date.now() }), moving && active && fx.motion && season.effective === "full");
  useMoments(PEEK_FIRST, PEEK_EVERY, () => {
    void measurePerches(screenRef.current).then((rects) => {
      const spot = peekSpot(rects, { top: insets.top + 56, bottom: height - TAB_BAR - Math.max(insets.bottom, 8) });
      if (spot) setPeek({ ...spot, id: Date.now() });
    });
  }, moving && active && fx.rare);
  // Wer scrollt oder den Screen wechselt, nimmt dem Hasen seine Karte - er ist sofort weg.
  useEffect(() => {
    if (!peek) return undefined;
    const scroll = seasonScroll();
    const start = scroll ? scroll.value : null;
    const timer = setInterval(() => {
      const now = scroll ? scroll.value : null;
      if (now && start && (now.screen !== start.screen || Math.abs(now.y - start.y) > 2)) setPeek(null);
    }, 120);
    return () => clearInterval(timer);
  }, [peek]);
  useEffect(() => {
    setPeek(null);
  }, [screen]);
  const endFlight = useCallback(() => setFlight(null), []);
  const endPeek = useCallback(() => setPeek(null), []);
  if (!moving || !width || !height) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="easter-sky">
      {petals > 0 ? <PetalField count={petals} size={{ width, height }} running={active} scroll={seasonScroll()} /> : null}
      {flight ? <ButterflyFlight key={flight.id} flight={flight} width={width} height={height} onDone={endFlight} /> : null}
      {peek ? <HarePeekView key={peek.id} spot={peek} onDone={endPeek} /> : null}
    </View>
  );
}

/** Der Gruß am Ostersonntag und -montag, einmal je Tag, über der Tab-Leiste - nicht auf stillen Screens. */
export function EasterGreeting({ season, screen }: { season: ActiveSeason; screen: string }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [covered, setCovered] = useState(() => anyOverlayOpen());
  useEffect(() => subscribeQuiet((quiet) => setCovered(quiet.overlays.length > 0)), []);
  const due = greetingDay(season) && !isQuiet(season);
  const allowed = due && screenClass(screen) !== "quiet" && !covered;
  const greeting = season.texts?.greeting || "Frohe Ostern wünscht THE LION SQUAD";
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
      <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={`${greeting}. Schließen`} style={styles.toast} testID="easter-toast">
        <FlowerArt kind="daisy" height={18} />
        <Body style={styles.toastText}>{greeting}</Body>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // 4 px unter der Innenkante der Karte: das Gras steht auf der Kante, die Eier ragen 12 px in den Innenabstand (16).
  edge: { position: "absolute", right: 16, bottom: -4, height: 18 },
  edgeEggPivot: { position: "absolute", width: EDGE_EGG, justifyContent: "flex-start" },
  edgeGrass: { position: "absolute", left: 0, right: 0, bottom: 0 },
  petal: { position: "absolute", left: 0, top: 0 },
  butterfly: { position: "absolute", left: 0 },
  wingPivot: { position: "absolute", top: 0, left: 0, flexDirection: "row" },
  body: { position: "absolute", width: 2, borderRadius: 1, backgroundColor: "#4a3b22" },
  peek: { position: "absolute", overflow: "hidden" },
  toastWrap: { position: "absolute" },
  toast: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.4)", backgroundColor: "#12140f", shadowColor: "#000", shadowOpacity: 0.55, shadowRadius: 25, shadowOffset: { width: 0, height: 18 }, elevation: 12 },
  toastText: { color: "#fff6e0", fontSize: 15, fontWeight: "800", flexShrink: 1 },
});

