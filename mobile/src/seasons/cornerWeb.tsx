import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, Line, Path } from "react-native-svg";
import { REST_MS, createRest, endReaction, startReaction } from "./cardLift";
import { useCardLift } from "./useCardLift";
import { EXTENT, buildPlan, planLines, toPixels, type PlanLine } from "./webPlan";
import { TEAR, buildDelays, tearPhase, tearPlan, type TearPhase, type TearPlan } from "./webTear";

// Ein kleines Netz in einer oberen Innenecke einer Karte (A4, #718 - wie H12 im Web): dieselben Fäden wie das große
// Netz, nur klein (Radius 22–30) und blasser, still, nie klickbar; die Karte darunter bleibt, wie sie ist.
// Netz reißt (Jahreszeiten IV, #1089, wie im Web): wird die Karte angetippt, reißen Anker und Rahmen nacheinander, ein
// Fetzen weht davon, der Rest löst sich auf, die Spinne seilt sich ab - dann ist das Netz weg, bis die Spinne es nach
// einer Minute Faden für Faden neu baut. Drei sichtbare Vorgänge, keine Standbilder. Der Zustand hängt an der Karte,
// nicht an der Anzeige: wer wegscrollt und wiederkommt, sieht das Netz in derselben Phase. Bewegt werden nur Views
// (nie SVG-Transformationen - die sind auf Android unzuverlässig), gedreht und geschrumpft um echte Punkte des Netzes.

const THREAD = "rgba(170,225,240,0.52)";
const THREAD_SOFT = "rgba(170,225,240,0.36)";
const SPIDER_BODY = "#1a1520";
const SPIDER_EYES = "#9be7ff";
/** Die Spinne eines Eck-Netzes (px breit) - wie im Web. */
export const SPIDER_SIZE = 8;
/** Abseilen: in `TEAR.rappelMs` hinunter, bis hier ausgeblendet (ms) - wie die Keyframes im Web. */
const RAPPEL_MS = 2400;
/** So oft zählt der Neubau die nächsten Fäden dazu (ms). */
const BUILD_STEP_MS = 100;

type Side = "tl" | "tr";
type Geometry = { side: Side; seed: number; radius: number };
type Tear = Geometry & { at: number; plan: TearPlan };
type Box = { lines: PlanLine[]; width: number; height: number; hub: { x: number; y: number } };
type AnimatedStyle = React.ComponentProps<typeof Animated.View>["style"];

const tears = new Map<string, Tear>();
const webRest = createRest(REST_MS.big);

/** Nur für Tests: gerissene Netze und Ruhezeiten vergessen. */
export function resetWebTears() {
  tears.clear();
  webRest.clear();
}

function boxOf({ side, seed, radius }: Geometry): Box {
  const plan = buildPlan(seed);
  const mirror = side === "tr";
  return { lines: planLines(plan, radius, mirror), width: Math.round(EXTENT.x * radius), height: Math.round(EXTENT.y * radius), hub: toPixels(plan.nodes[0], radius, mirror) };
}

function Thread({ line }: { line: PlanLine }) {
  return <Line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={line.kind === "spiral" ? THREAD_SOFT : THREAD} strokeWidth={line.kind === "spiral" ? 0.55 : 0.8} strokeLinecap="round" />;
}

/** Die Fäden eines Netzes (alle oder nur die mit diesen Nummern) in einem SVG so groß wie der Kasten. */
function Threads({ box, only }: { box: Box; only?: number[] }) {
  const indices = only || box.lines.map((_, index) => index);
  return (
    <Svg width={box.width} height={box.height}>
      {indices.map((index) => <Thread key={index} line={box.lines[index]} />)}
    </Svg>
  );
}

/**
 * Eine Ebene, deren Mitte auf dem Punkt `at` des Netzes liegt: Drehen und Schrumpfen einer View geht immer um ihre
 * Mitte - so dreht der Fetzen um die Nabe und ein Faden schnurrt zu seinem Anfang zurück.
 */
function Pivot({ at, box, style, children }: { at: { x: number; y: number }; box: Box; style?: AnimatedStyle; children: React.ReactNode }) {
  const size = 2 * Math.max(box.width, box.height) + 8;
  const half = size / 2;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: at.x - half, top: at.y - half, width: size, height: size }, style]}>
      <View style={{ position: "absolute", left: half - at.x, top: half - at.y, width: box.width, height: box.height }}>{children}</View>
    </Animated.View>
  );
}

/** Die winzige Spinne des Netzes, mit Faden nach oben (Abseilen) oder ohne (Neubau). */
function CornerSpider({ thread }: { thread: boolean }) {
  return (
    <Svg width={SPIDER_SIZE} height={SPIDER_SIZE * 4} viewBox="0 0 20 80">
      {thread ? <Line x1={10} y1={0} x2={10} y2={62} stroke={THREAD_SOFT} strokeWidth={0.9} /> : null}
      <Ellipse cx={10} cy={66} rx={4.5} ry={5.5} fill={SPIDER_BODY} />
      <Circle cx={10} cy={60.5} r={2.6} fill={SPIDER_BODY} />
      {[-1, 1].map((side) => [0, 1, 2, 3].map((leg) => (
        <Path key={`${side}-${leg}`} d={`M ${10 + side * 3} ${63 + leg * 2} q ${side * 6} ${-4 + leg} ${side * 8} ${2 + leg * 1.5}`} stroke={SPIDER_BODY} strokeWidth={1.4} fill="none" strokeLinecap="round" />
      )))}
      <Circle cx={8.6} cy={60} r={0.7} fill={SPIDER_EYES} />
      <Circle cx={11.4} cy={60} r={0.7} fill={SPIDER_EYES} />
    </Svg>
  );
}

/** Wo die Spinne an der Nabe sitzt: ihr Körper auf der Nabe, der Faden darüber (wie im Web). */
function spiderSpot(box: Box) {
  return { left: box.hub.x - SPIDER_SIZE / 2, top: box.hub.y - SPIDER_SIZE * 3.3 };
}

/** Das reißende Netz: Anker und Rahmen reißen nacheinander, der Fetzen weht davon, der Rest löst sich auf. */
function TornWeb({ tear }: { tear: Tear }) {
  const box = useMemo(() => boxOf(tear), [tear]);
  const roles = useMemo(() => {
    const of = (role: string) => tear.plan.lines.filter((entry) => entry.role === role && box.lines[entry.index]);
    return { snap: of("snap"), scrap: of("scrap").map((entry) => entry.index), fade: of("fade").map((entry) => entry.index) };
  }, [tear, box]);
  const values = useRef<{ snaps: Animated.Value[]; scrap: Animated.Value; rest: Animated.Value; spider: Animated.Value } | null>(null);
  if (!values.current) values.current = { snaps: roles.snap.map(() => new Animated.Value(0)), scrap: new Animated.Value(0), rest: new Animated.Value(0), spider: new Animated.Value(0) };
  const { snaps, scrap, rest, spider } = values.current;
  useEffect(() => {
    const animation = Animated.parallel([
      ...roles.snap.map((entry, n) => Animated.timing(snaps[n], { toValue: 1, duration: TEAR.snapEachMs, delay: entry.delay, easing: Easing.bezier(0.5, 0, 0.9, 0.5), useNativeDriver: true })),
      Animated.timing(scrap, { toValue: 1, duration: TEAR.scrapMs, delay: TEAR.scrapAt, easing: Easing.bezier(0.25, 0.4, 0.5, 1), useNativeDriver: true }),
      Animated.timing(rest, { toValue: 1, duration: TEAR.dissolveMs, delay: TEAR.dissolveAt, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      Animated.timing(spider, { toValue: 1, duration: RAPPEL_MS, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [roles, snaps, scrap, rest, spider]);
  const { dx, dy, turn } = tear.plan.scrap;
  const down = TEAR.rappelMs / RAPPEL_MS;
  const keys = [0, 0.25, 1];
  return (
    <View pointerEvents="none" style={[styles.web, tear.side === "tl" ? { left: 0 } : { right: 0 }, { width: box.width, height: box.height }]} testID="halloween-corner-web-torn" data-side={tear.side}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: rest.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateY: rest.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }) }] }]}>
        <Threads box={box} only={roles.fade} />
      </Animated.View>
      {roles.snap.map((entry, n) => (
        <Pivot key={entry.index} at={{ x: box.lines[entry.index].x1, y: box.lines[entry.index].y1 }} box={box} style={{ opacity: snaps[n].interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ scale: snaps[n].interpolate({ inputRange: [0, 1], outputRange: [1, 0.02] }) }] }}>
          <Threads box={box} only={[entry.index]} />
        </Pivot>
      ))}
      <Pivot
        at={box.hub}
        box={box}
        style={{
          opacity: scrap.interpolate({ inputRange: keys, outputRange: [1, 1, 0] }),
          transform: [
            { translateX: scrap.interpolate({ inputRange: keys, outputRange: [0, dx * 0.25, dx] }) },
            { translateY: scrap.interpolate({ inputRange: keys, outputRange: [0, dy * 0.08, dy] }) },
            { rotate: scrap.interpolate({ inputRange: keys, outputRange: ["0deg", `${turn * 0.3}deg`, `${turn}deg`] }) },
          ],
        }}
      >
        <Threads box={box} only={roles.scrap} />
      </Pivot>
      <Animated.View
        pointerEvents="none"
        style={[styles.spider, spiderSpot(box), { opacity: spider.interpolate({ inputRange: [0, down, 1], outputRange: [1, 1, 0] }), transform: [{ translateY: spider.interpolate({ inputRange: [0, down, 1], outputRange: [0, 46, 52] }) }] }]}
        testID="halloween-corner-spider-rappel"
      >
        <CornerSpider thread />
      </Animated.View>
    </View>
  );
}

/** Der Neubau: die Spinne spinnt Faden für Faden in der Reihenfolge des Plans (Anker, Rahmen, Speichen, Spirale). */
function BuildingWeb({ tear }: { tear: Tear }) {
  const box = useMemo(() => boxOf(tear), [tear]);
  const delays = useMemo(() => buildDelays(box.lines.length), [box.lines.length]);
  const start = tear.at + TEAR.rebuildAt;
  const [shown, setShown] = useState(() => countBuilt(delays, Date.now() - start));
  const complete = shown >= box.lines.length;
  useEffect(() => {
    if (complete) return undefined;
    const timer = setInterval(() => setShown(countBuilt(delays, Date.now() - start)), BUILD_STEP_MS);
    return () => clearInterval(timer);
  }, [complete, start, delays]);
  const presence = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const elapsed = Math.max(0, Date.now() - start);
    presence.setValue(Math.min(1, elapsed / TEAR.buildMs));
    const animation = Animated.timing(presence, { toValue: 1, duration: Math.max(0, TEAR.buildMs - elapsed), easing: Easing.linear, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [presence, start]);
  return (
    <View pointerEvents="none" style={[styles.web, tear.side === "tl" ? { left: 0 } : { right: 0 }, { width: box.width, height: box.height }]} testID="halloween-corner-web-building" data-side={tear.side} data-shown={String(shown)}>
      <Threads box={box} only={box.lines.slice(0, shown).map((_, index) => index)} />
      <Animated.View pointerEvents="none" style={[styles.spider, spiderSpot(box), { opacity: presence.interpolate({ inputRange: [0, 0.08, 0.92, 1], outputRange: [0, 1, 1, 0] }) }]}>
        <CornerSpider thread={false} />
      </Animated.View>
    </View>
  );
}

/** Wie viele Fäden `elapsedMs` nach Beginn des Neubaus schon stehen. */
export function countBuilt(delays: number[], elapsedMs: number): number {
  let count = 0;
  while (count < delays.length && delays[count] <= elapsedMs) count += 1;
  return count;
}

/**
 * Das Netz an einer Karte. `perchId` ist der Schlüssel der Karte - mit ihm reißt das Netz, wenn die Karte angetippt
 * wird (höchstens einmal je Minute je Karte, nie neben einer anderen großen Reaktion).
 */
export function CornerWeb({ side, seed, radius, perchId = null }: { side: Side; seed: number; radius: number; perchId?: string | null }) {
  const box = useMemo(() => boxOf({ side, seed, radius }), [side, seed, radius]);
  const [tear, setTear] = useState<Tear | null>(() => (perchId ? tears.get(perchId) || null : null));
  const [, setTick] = useState(0);
  // Nur wer das Reißen selbst gestartet hat, zeigt es; kommt die Karte mitten darin zurück, ist das Netz schon weg.
  const startedHere = useRef(false);
  const phase: TearPhase = tear ? tearPhase(Date.now() - tear.at) : "done";
  // Die Phasen gehen über die Uhr, nicht über das Ende einer Animation (das feuert im Jest-Umfeld sofort).
  useEffect(() => {
    if (!tear) return undefined;
    if (phase === "done") {
      if (perchId && tears.get(perchId) === tear) tears.delete(perchId);
      setTear(null);
      return undefined;
    }
    const boundary = phase === "tear" ? TEAR.goneAt : phase === "gone" ? TEAR.rebuildAt : TEAR.rebuildAt + TEAR.buildMs + 400;
    const timer = setTimeout(() => setTick((count) => count + 1), Math.max(0, boundary - (Date.now() - tear.at)));
    return () => clearTimeout(timer);
  }, [tear, phase, perchId]);
  useCardLift((detail) => {
    if (!perchId || detail.key !== perchId) return;
    const current = tears.get(perchId);
    if (current && tearPhase(Date.now() - current.at) !== "done") return;
    if (webRest.left(perchId) > 0) return;
    const token = startReaction();
    if (!token) return;
    webRest.take(perchId);
    const at = Date.now();
    const entry: Tear = { side, seed, radius, at, plan: tearPlan(box.lines, { seed: `${perchId}:${at}`, side, hub: box.hub }) };
    tears.set(perchId, entry);
    startedHere.current = true;
    setTear(entry);
    setTimeout(() => endReaction(token), TEAR.goneAt);
  }, Boolean(perchId));
  if (tear && phase === "tear") return startedHere.current ? <TornWeb tear={tear} /> : null;
  if (tear && phase === "gone") return null;
  if (tear && phase === "build") return <BuildingWeb tear={tear} />;
  return (
    <View pointerEvents="none" style={[styles.web, side === "tl" ? { left: 0 } : { right: 0 }, { width: box.width, height: box.height }]} testID="halloween-corner-web" data-side={side}>
      <Threads box={box} />
    </View>
  );
}

const styles = StyleSheet.create({
  web: { position: "absolute", top: 0, opacity: 0.75 },
  spider: { position: "absolute" },
});
