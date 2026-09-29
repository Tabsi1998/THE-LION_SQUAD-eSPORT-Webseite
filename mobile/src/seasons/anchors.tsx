import * as Haptics from "expo-haptics";
import React, { useContext, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { NavigationRouteContext } from "@react-navigation/native";
import { HangingBatShape, SHAPE_HEIGHT, SittingBatShape } from "./batArt";
import { fleePath, startFlight } from "./flights";
import { getMotionScheduler, requestMotion } from "./motion";
import { clearAssignment, perchPoint, perchSnapshot, registerPerch, subscribePerches, unregisterPerch, type PerchAssignment, type PerchKind, type PerchRect } from "./perches";
import { anyOverlayOpen, setOverlay, setQuietZone, subscribeQuiet } from "./quiet";

// Anker in der App (A1, #715): eine Karte, die einen Platz anbietet, legt `SeasonPerch` als unsichtbare Ebene über
// sich (`Card perch="..."`). Die Ebene meldet die Karte als Platz an, solange sie auf dem Screen ist, und zeigt die
// Fledermaus, wenn die Bühne ihr eine zuteilt - sitzend auf einer oberen Ecke oder hängend unter der Unterkante,
// scrollt mit der Karte mit und nimmt Berührungen nur auf der Figur. Antippen verscheucht: die Figur verlässt die
// Karte in Fensterkoordinaten, den Flug zeichnet die Bühne. Dazu zwei Haken für Ruhezonen: `useSeasonOverlay`
// (Dialoge und Sheets) und `useSeasonQuietZone` (Formulare, Tabellen).

/** Der Name des Screens, auf dem die Komponente liegt - ohne Navigation „Dashboard“. */
export function useRouteNameSafe(): string {
  const route = useContext(NavigationRouteContext);
  return (route && route.name) || "Dashboard";
}

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
 * Die unsichtbare Ebene über einer Karte: meldet den Platz an, zeigt die zugeteilte Fledermaus. `id` muss je
 * Screen eindeutig und über Renders stabil sein (Karten-ID, nicht Index).
 */
export function SeasonPerch({ id, kind = "card" }: { id: string; kind?: PerchKind }) {
  const screen = useRouteNameSafe();
  const ref = useRef<View>(null);
  const [assignment, setAssignment] = useState<PerchAssignment | null>(() => perchSnapshot().assignments[id] || null);
  const [covered, setCovered] = useState(anyOverlayOpen());
  useEffect(() => {
    registerPerch({ id, screen, kind, measure: () => measureNode(ref.current) });
    const stop = subscribePerches((state) => setAssignment(state.assignments[id] || null));
    const stopQuiet = subscribeQuiet((state) => setCovered(state.overlays.length > 0));
    return () => {
      stop();
      stopQuiet();
      unregisterPerch(id);
    };
  }, [id, screen, kind]);
  return (
    <View ref={ref} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill} testID={`season-perch-${id}`}>
      {assignment && !covered ? <PerchBat perchId={id} screen={screen} assignment={assignment} measure={() => measurePerch(id, () => measureNode(ref.current))} /> : null}
    </View>
  );
}

/** Die Fledermaus auf ihrem Platz: sitzend auf einer oberen Ecke oder hängend unter der Unterkante; Antippen scheucht. */
export function PerchBat({ perchId, screen, assignment, measure }: { perchId: string; screen: string; assignment: PerchAssignment; measure: () => Promise<PerchRect | null> }) {
  const { width, height } = useWindowDimensions();
  const settle = useRef(new Animated.Value(0)).current;
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    settle.setValue(0);
    Animated.timing(settle, { toValue: 1, duration: 700, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
  }, [settle, perchId]);
  const sitting = assignment.pose === "sit";
  const size = assignment.size;
  const shapeHeight = size * (sitting ? SHAPE_HEIGHT.sit : SHAPE_HEIGHT.hang);
  const onPress = async () => {
    if (leaving) return;
    setLeaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const rect = await measure();
    const point = rect ? perchPoint(rect, assignment.corner) : { x: width / 2, y: height / 2 };
    const from = { x: point.x, y: sitting ? point.y - shapeHeight / 2 : point.y + shapeHeight / 2 };
    const token = requestMotion("bat_scare", { force: true });
    startFlight({ screen, perchId, from, size, path: fleePath(from, { width, height }), durationMs: 2800 + Math.round(Math.random() * 600) });
    clearAssignment(perchId);
    if (token) setTimeout(() => getMotionScheduler().release(token), 3600);
  };
  const position = assignment.corner === "tl"
    ? { left: 22 - size / 2, top: -shapeHeight + 1 }
    : assignment.corner === "tr"
      ? { right: 22 - size / 2, top: -shapeHeight + 1 }
      : { left: "50%" as const, marginLeft: -size / 2, bottom: -shapeHeight + 1 };
  const scale = settle.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const opacity = settle.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] });
  return (
    <Animated.View style={[styles.bat, position, { opacity, transform: [{ scale }] }]} testID={`season-perch-bat-${perchId}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fledermaus verscheuchen" onPress={onPress} hitSlop={6} testID="halloween-bat-perched" disabled={leaving}>
        {sitting ? <SittingBatShape size={size} /> : <HangingBatShape size={size} />}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bat: { position: "absolute" },
});
