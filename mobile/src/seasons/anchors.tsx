import * as Haptics from "expo-haptics";
import React, { useContext, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { NavigationRouteContext } from "@react-navigation/native";
import { FlyingBatShape, HangingBatShape, SHAPE_HEIGHT, SittingBatShape } from "./batArt";
import { ALERT_MS, TAKEOFF_MS, alertEveryMs, restMs, wantsToRoam, type Temperament } from "./batLife";
import { REST_MS, claimCardTouch, createRest } from "./cardLift";
import { activeFlights, fleePath, requestHop, startFlight } from "./flights";
import { getMotionScheduler, requestMotion } from "./motion";
import { hashString, mulberry32 } from "./rng";
import { clearAssignment, perchPoint, perchSnapshot, registerPerch, subscribePerches, unregisterPerch, type CardDecoAssignment, type PerchAssignment, type PerchKind, type PerchRect, type WebAssignment } from "./perches";
import { CardDeco } from "./cardDeco";
import { CornerWeb } from "./cornerWeb";
import { HuntEggView, useEggTumbles } from "./easterHunt/HuntEgg";
import { useHuntSpots } from "./easterHunt/store";
import { anyOverlayOpen, setOverlay, setQuietZone, subscribeQuiet } from "./quiet";
import { useCardLift } from "./useCardLift";

// Anker in der App (A1, #715): eine Karte, die einen Platz anbietet, legt `SeasonPerch` als unsichtbare Ebene über
// sich (`Card perch="..."`). Die Ebene meldet die Karte als Platz an, solange sie auf dem Screen ist, und zeigt die
// Fledermaus, wenn die Bühne ihr eine zuteilt - sitzend auf einer oberen Ecke oder hängend unter der Unterkante,
// scrollt mit der Karte mit und nimmt Berührungen nur auf der Figur. Antippen verscheucht: die Figur verlässt die
// Karte in Fensterkoordinaten, den Flug zeichnet die Bühne. Dazu zwei Haken für Ruhezonen: `useSeasonOverlay`
// (Dialoge und Sheets) und `useSeasonQuietZone` (Formulare, Tabellen).
// Jahreszeiten IV (#1087-#1092): wird die Karte angetippt (Karten-Signal, cardLift.ts), reißt ihr Netz, ihre Fledermaus
// flattert kurz auf und landet wieder, ein Ei der Suche purzelt hervor - nur an genau dieser Karte. Variante B
// (#1091-#1094): an einigen Karten hängt dazu Deko der laufenden Saison (cardDeco.tsx) - Lichterkette, Osterei,
// Luftschlange, Wimpelkette - und reagiert genauso nur hier.

/** Der Name des Screens, auf dem die Komponente liegt - ohne Navigation „Dashboard“. */
export function useRouteNameSafe(): string {
  const route = useContext(NavigationRouteContext);
  return (route && route.name) || "Dashboard";
}

/** Ist der Screen gerade im Blick? (screenFocus.ts - hier weiter erreichbar für die Saisons, die es von hier holen.) */
export { useScreenFocused } from "./screenFocus";

/** Ein Dialog oder Sheet meldet sich: solange es offen ist, ruhen große Bewegungen und Plätze darunter. */
export function useSeasonOverlay(id: string, open: boolean) {
  useEffect(() => {
    setOverlay(id, open);
    getMotionScheduler().setBlocked(anyOverlayOpen());
    return () => {
      setOverlay(id, false);
      getMotionScheduler().setBlocked(anyOverlayOpen());
    };
  }, [id, open]);
}

/** Ein geschützter Bereich meldet sein Rechteck (Fensterkoordinaten) - `View` mit `ref` und `collapsable={false}`. */
export function useSeasonQuietZone(id: string, ref: React.RefObject<View | null>, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const measure = () => {
      const node = ref.current;
      if (!node || typeof node.measureInWindow !== "function") return;
      node.measureInWindow((x, y, width, height) => {
        if (!cancelled && width > 0 && height > 0) setQuietZone(id, { x, y, width, height });
      });
    };
    const timer = setTimeout(measure, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setQuietZone(id, null);
    };
  }, [id, ref, active]);
}

/** Das Rechteck einer View in Fensterkoordinaten - null ohne Antwort (Tests, abgebaute View), spätestens nach 250 ms. */
function measureNode(node: View | null): Promise<PerchRect | null> {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== "function") {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), 250);
    node.measureInWindow((x, y, width, height) => {
      clearTimeout(timer);
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

/** Misst über den angemeldeten Platz (Tests können ihn mit einer festen Messung neu anmelden). */
function measurePerch(perchId: string, fallback: () => Promise<PerchRect | null>): Promise<PerchRect | null> {
  const perch = perchSnapshot().perches.find((entry) => entry.id === perchId);
  return perch ? perch.measure() : fallback();
}

/**
 * Die unsichtbare Ebene über einer Karte: meldet den Platz an, zeigt die zugeteilte Fledermaus und die Ostereier der
 * Suche (#647). `id` muss je Screen eindeutig und über Renders stabil sein (Karten-ID, nicht Index). `clip`: die
 * Karte schneidet ab, was über ihren Rand ragt - Eier liegen dann innen in der Ecke, Fledermäuse gar nicht.
 */
export function SeasonPerch({ id, kind = "card", timeScale = 1, clip = false }: { id: string; kind?: PerchKind; timeScale?: number; clip?: boolean }) {
  const screen = useRouteNameSafe();
  const ref = useRef<View>(null);
  const [assignment, setAssignment] = useState<PerchAssignment | null>(() => perchSnapshot().assignments[id] || null);
  const [web, setWeb] = useState<WebAssignment | null>(() => perchSnapshot().webs[id] || null);
  const [deco, setDeco] = useState<CardDecoAssignment | null>(() => perchSnapshot().deco[id] || null);
  const [covered, setCovered] = useState(anyOverlayOpen());
  const eggs = useHuntSpots(id);
  const tumbles = useEggTumbles(id, eggs, clip);
  useEffect(() => {
    // Erst zuhören, dann anmelden: die Bühne teilt oft schon während der Anmeldung zu.
    const stop = subscribePerches((state) => {
      setAssignment(state.assignments[id] || null);
      setWeb(state.webs[id] || null);
      setDeco(state.deco[id] || null);
    });
    const stopQuiet = subscribeQuiet((state) => setCovered(state.overlays.length > 0));
    registerPerch({ id, screen, kind, clip, measure: () => measureNode(ref.current) });
    setAssignment(perchSnapshot().assignments[id] || null);
    setWeb(perchSnapshot().webs[id] || null);
    setDeco(perchSnapshot().deco[id] || null);
    return () => {
      stop();
      stopQuiet();
      unregisterPerch(id);
    };
  }, [id, screen, kind, clip]);
  return (
    <View ref={ref} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill} testID={`season-perch-${id}`}>
      {deco && !covered ? <CardDeco perchId={id} deco={deco} /> : null}
      {web && !covered ? <CornerWeb perchId={id} side={web.side} seed={web.seed} radius={web.radius} /> : null}
      {assignment && !covered ? <PerchBat perchId={id} screen={screen} assignment={assignment} landed={Boolean(assignment.landed)} timeScale={timeScale} measure={() => measurePerch(id, () => measureNode(ref.current))} /> : null}
      {eggs.map((spot) => <HuntEggView key={spot.egg.egg_no} spot={spot} clip={clip} tumble={tumbles[spot.egg.egg_no]} />)}
    </View>
  );
}

/**
 * Die Fledermaus auf ihrem Platz (A1/A2): landet mit Einfedern (leichte Haptik), döst, hebt ab und zu kurz den Kopf
 * (Aufmerksamkeit, ohne Haptik), zieht als Unruhige nach der Ruhe um (Start am Platz, dann Flug über die Bühne) und
 * fliegt beim Antippen davon (mittlere Haptik). Sitzend auf einer oberen Ecke oder hängend unter der Unterkante.
 * Wird ihre Karte angetippt (#1090), flattert sie eine Sekunde auf - Flügel auf, zwei, drei Schläge - und landet
 * wieder genau dort; nicht, solange eine Fledermaus fliegt, höchstens einmal in zehn Sekunden je Karte.
 */
export function PerchBat({ perchId, screen, assignment, measure, landed = false, timeScale = 1 }: { perchId: string; screen: string; assignment: PerchAssignment; measure: () => Promise<PerchRect | null>; landed?: boolean; timeScale?: number }) {
  const { width, height } = useWindowDimensions();
  const settle = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const flutter = useRef(new Animated.Value(0)).current;
  const flap = useRef(new Animated.Value(0)).current;
  const [fluttering, setFluttering] = useState(false);
  const flutterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<"settle" | "perched" | "alert" | "takeoff" | "gone">("settle");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const sitting = assignment.pose === "sit";
  const size = assignment.size;
  const shapeHeight = size * (sitting ? SHAPE_HEIGHT.sit : SHAPE_HEIGHT.hang);
  const temperament = (assignment.temperament || "sleepy") as Temperament;
  // Landung: Einfedern, bei echter Landung nach einem Flug eine leichte Haptik.
  useEffect(() => {
    settle.setValue(0);
    Animated.timing(settle, { toValue: 1, duration: 700 / timeScale, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
    if (landed) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const timer = setTimeout(() => setPhase((current) => (current === "settle" ? "perched" : current)), 700 / timeScale);
    return () => clearTimeout(timer);
  }, [settle, perchId, landed, timeScale]);
  // Aufmerksamkeit und Umzug: Zeitgeber aus dem Temperament, gesät je Platz.
  useEffect(() => {
    const rng = mulberry32(hashString(`life:${perchId}:${temperament}`));
    let alertTimer: ReturnType<typeof setTimeout> | null = null;
    let restTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const scheduleAlert = () => {
      alertTimer = setTimeout(() => {
        if (cancelled) return;
        if (phaseRef.current === "perched") {
          setPhase("alert");
          wiggle.setValue(0);
          Animated.sequence([
            Animated.timing(wiggle, { toValue: 1, duration: 260 / timeScale, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(wiggle, { toValue: -1, duration: 360 / timeScale, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(wiggle, { toValue: 0, duration: 380 / timeScale, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          ]).start();
          setTimeout(() => {
            if (!cancelled) setPhase((current) => (current === "alert" ? "perched" : current));
          }, ALERT_MS / timeScale);
        }
        scheduleAlert();
      }, alertEveryMs(temperament, rng) / timeScale);
    };
    scheduleAlert();
    restTimer = setTimeout(async () => {
      if (cancelled || phaseRef.current === "gone" || !wantsToRoam(temperament, rng)) return;
      const rect = await measure();
      if (cancelled || !rect) return;
      const point = perchPoint(rect, assignment.corner);
      const from = { x: point.x, y: sitting ? point.y - shapeHeight / 2 : point.y + shapeHeight / 2 };
      // Start am Platz: kurz anheben, dann übernimmt die Bühne den Flug (oder lässt sie sitzen, wenn kein Platz frei ist).
      setPhase("takeoff");
      lift.setValue(0);
      Animated.timing(lift, { toValue: 1, duration: TAKEOFF_MS / timeScale, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
      setTimeout(() => {
        if (cancelled) return;
        requestHop({ perchId, screen, from, size, temperament });
        setPhase((current) => (current === "takeoff" ? "perched" : current));
        lift.setValue(0);
      }, TAKEOFF_MS / timeScale);
    }, restMs(temperament, rng) / timeScale);
    return () => {
      cancelled = true;
      if (alertTimer) clearTimeout(alertTimer);
      if (restTimer) clearTimeout(restTimer);
    };
  }, [perchId, screen, temperament, assignment.corner, sitting, shapeHeight, size, measure, wiggle, lift, timeScale]);
  // Aufflattern (#1090): nur aus der Ruhe (sitzt oder schaut), nicht neben einem Flug (Bewegungsbudget).
  useEffect(() => () => {
    if (flutterTimer.current) clearTimeout(flutterTimer.current);
  }, []);
  useCardLift((detail) => {
    if (detail.key !== perchId || flutterTimer.current) return;
    if (phaseRef.current !== "perched" && phaseRef.current !== "alert") return;
    if (batsInFlight() || !flutterRest.take(perchId)) return;
    setFluttering(true);
    flutter.setValue(0);
    flap.setValue(0);
    Animated.parallel([
      Animated.timing(flutter, { toValue: 1, duration: FLUTTER_MS / timeScale, easing: Easing.bezier(0.3, 0.6, 0.4, 1), useNativeDriver: true }),
      Animated.timing(flap, { toValue: 1, duration: FLUTTER_MS / timeScale, easing: Easing.linear, useNativeDriver: true }),
    ]).start();
    flutterTimer.current = setTimeout(() => {
      flutterTimer.current = null;
      setFluttering(false);
    }, FLUTTER_MS / timeScale + 50);
  });
  const onPress = async () => {
    if (phaseRef.current === "gone" || phaseRef.current === "takeoff") return;
    setPhase("gone");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const rect = await measure();
    const point = rect ? perchPoint(rect, assignment.corner) : { x: width / 2, y: height / 2 };
    const from = { x: point.x, y: sitting ? point.y - shapeHeight / 2 : point.y + shapeHeight / 2 };
    const token = requestMotion("bat_scare", { force: true });
    startFlight({ kind: "flee", screen, perchId, from, size, temperament, path: fleePath(from, { width, height }), durationMs: (2800 + Math.round(Math.random() * 600)) / timeScale });
    clearAssignment(perchId);
    if (token) setTimeout(() => getMotionScheduler().release(token), 3600 / timeScale);
  };
  const position = assignment.corner === "tl"
    ? { left: 22 - size / 2, top: -shapeHeight + 1 }
    : assignment.corner === "tr"
      ? { right: 22 - size / 2, top: -shapeHeight + 1 }
      : { left: "50%" as const, marginLeft: -size / 2, bottom: -shapeHeight + 1 };
  const scale = settle.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const settleOpacity = settle.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] });
  const liftOpacity = lift.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
  const rotate = wiggle.interpolate({ inputRange: [-1, 1], outputRange: sitting ? ["-9deg", "9deg"] : ["7deg", "-7deg"] });
  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, sitting ? -10 : 8] });
  // Aufflattern wie im Web: sitzend hüpft sie hoch und landet, hängend sackt sie kurz ab und hängt sich wieder an.
  const flutterY = flutter.interpolate(sitting ? { inputRange: [0, 0.3, 0.6, 0.85, 1], outputRange: [0, -9, -4, 1, 0] } : { inputRange: [0, 0.25, 0.55, 0.8, 1], outputRange: [0, 7, -3, 1, 0] });
  const folded = flutter.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [1, 0, 0, 1] });
  const spread = flutter.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [0, 1, 1, 0] });
  // Drei Flügelschläge in der Sekunde; hängend bleibt sie kopfüber.
  const beats = flap.interpolate({ inputRange: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1], outputRange: [1, 0.4, 1, 0.4, 1, 0.4, 1].map((value) => (sitting ? value : -value)) });
  const wingWidth = size * 1.7;
  const wingHeight = wingWidth * 0.55;
  return (
    <Animated.View style={[styles.bat, position, { opacity: Animated.multiply(settleOpacity, liftOpacity), transform: [{ translateY: Animated.add(translateY, flutterY) }, { scale }, { rotate }] }]} testID={`season-perch-bat-${perchId}`} data-phase={phase} data-flutter={fluttering ? "1" : undefined}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fledermaus verscheuchen" onPress={onPress} onTouchStart={() => claimCardTouch(perchId)} hitSlop={6} testID="halloween-bat-perched" accessibilityState={{ busy: phase === "takeoff" }} disabled={phase === "gone" || phase === "takeoff"}>
        <Animated.View style={{ opacity: folded }}>
          {sitting ? <SittingBatShape size={size} /> : <HangingBatShape size={size} />}
        </Animated.View>
        {fluttering ? (
          <Animated.View pointerEvents="none" style={[styles.wings, { left: (size - wingWidth) / 2, top: (shapeHeight - wingHeight) / 2, opacity: spread, transform: [{ scaleY: beats }] }]} testID="halloween-bat-flutter">
            <FlyingBatShape size={wingWidth} />
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/** Aufflattern an einer angetippten Karte (#1090): eine Sekunde, wie im Web. */
export const FLUTTER_MS = 1000;
const flutterRest = createRest(REST_MS.small);

/** Nur für Tests: die Ruhezeiten des Aufflatterns vergessen. */
export function resetBatFlutter() {
  flutterRest.clear();
}

/** Fliegt gerade eine Fledermaus - eine verscheuchte, eine umziehende oder der Schwarm? */
function batsInFlight(): boolean {
  return activeFlights().length > 0 || getMotionScheduler().snapshot().active.includes("flock");
}

const styles = StyleSheet.create({
  bat: { position: "absolute" },
  wings: { position: "absolute" },
});
