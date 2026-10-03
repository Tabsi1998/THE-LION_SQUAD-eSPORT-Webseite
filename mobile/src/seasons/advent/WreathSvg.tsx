import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { BERRY_TRIAD, CANDLE_WIDTH, RING, VIEW, candleBurn, dripPath, ringPoint, type Bow as BowSpec, type Candle as CandleSpec, type Cluster as ClusterSpec, type WreathLayout } from "./wreath";

// Der Kranz als Zeichnung (S6, #637; W1, #727; S11, #642): Ring in zwei Grüntönen, Zweige hinten, Kerzen, Zweige
// vorne, Beeren zu dritt, Schleifen - dieselbe Geometrie wie im Web (frontend/src/seasons/advent/index.jsx). Jede
// Flamme flackert mit ihrer eigenen Dauer und Stärke, der Wind legt alle in dieselbe Richtung; beim Anzünden fängt die
// Flamme klein und zittrig, ein Streichholz-Schein leuchtet auf und verglüht. „Bewegung reduzieren“: alles steht, die
// Flammen mit Schein.
//
// Die Flammen liegen als eigene kleine Ebenen über dem Kranz und bewegen sich mit dem nativen Animationstreiber
// (kein JavaScript je Bild). Der Kasten jeder Flamme sitzt mittig auf dem Docht, denn Android dreht und skaliert eine
// Ansicht um ihre Mitte - ein `transformOrigin` in Prozent war bei der Halloween-Katze in der Sichtprobe nicht
// verlässlich (ein gedrehter Schwanz verschwand ganz). Bewegte Drehung und Skalierung direkt an SVG-Gruppen gehen auf
// Android nicht: react-native-svg setzt sie dort über die Matrix der Android-Ansicht (VirtualViewManager,
// setTransformProperty), deren Drehpunkt bei diesen Teil-Ansichten die Ecke der Zeichenfläche ist - ein `origin`
// und auch eine feste Verschiebung als Drehpunkt helfen nicht. In der Sichtprobe flog die Flamme beim Anzünden von
// links oben ein. Das Wiegen der Zweige (im Web ±0,3 Grad) liegt hier unter einem Pixel und entfällt.

/** Der Wind, solange die App kein Wetter hat (#771) - wie die Vorgabe `--season-wind` im Web. */
export const WIND = 0.6;
export const LIGHTING_MS = 1500;

export type WreathProps = {
  layout: WreathLayout;
  candles: number;
  daysLit?: Array<number | null>;
  lighting?: number[];
  calm?: number[];
  still?: boolean;
  wind?: number;
  width?: number;
  height?: number;
};

/** Auf drei Stellen gerundet und ohne -0 (bei Windstille sonst „-0 Grad“). */
function tidy(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}

/** Die Bilder des Flackerns (wie die CSS-Keyframes): Breite, Höhe und Drehung an fünf Stellen der Runde. */
export function flickerFrames(amp: number, wind: number): { input: number[]; scaleX: number[]; scaleY: number[]; rotation: number[] } {
  return {
    input: [0, 0.25, 0.5, 0.75, 1],
    scaleX: [1, 1 + 0.06 * amp, 1 - 0.05 * amp, 1 + 0.04 * amp, 1].map(tidy),
    scaleY: [1, 1 + 0.12 * amp, 1 - 0.08 * amp, 1 + 0.15 * amp, 1].map(tidy),
    rotation: [-2 * wind, 3 * wind, -1 * wind, 4 * wind, -2 * wind].map(tidy),
  };
}

/** Das Fangen der Flamme beim Anzünden: klein und zittrig, dann voll. */
export const CATCH = {
  input: [0, 0.3, 0.55, 0.75, 1],
  scaleX: [0.15, 0.6, 0.85, 1.05, 1],
  scaleY: [0.1, 0.45, 1.2, 0.9, 1],
  rotation: [0, -6, 5, 0, 0],
  opacity: [0, 0.8, 1, 1, 1],
};
/** Das Streichholz: leuchtet auf, wird groß und verglüht. */
export const MATCH = { input: [0, 0.2, 0.6, 1], scale: [0.2, 1.1, 1.4, 1.8], opacity: [0, 1, 0.6, 0] };

/** Wo die Zeichenfläche im Kasten liegt: Maßstab und Rand - wie `preserveAspectRatio` „xMidYMid meet“. */
export function viewFit(width: number, height: number): { k: number; ox: number; oy: number } {
  const k = Math.min(width / VIEW.width, height / VIEW.height);
  return { k, ox: (width - VIEW.width * k) / 2, oy: (height - VIEW.height * k) / 2 };
}

/** Ein Punkt über dem Kerzenrand, mit der Neigung der Kerze um ihren Fuß - in Einheiten der Zeichenfläche. */
export function abovePoint(candle: Pick<CandleSpec, "x" | "y" | "lean">, height: number, above: number): { x: number; y: number } {
  const theta = (candle.lean * Math.PI) / 180;
  const length = height + above;
  return { x: candle.x + Math.sin(theta) * length, y: candle.y - Math.cos(theta) * length };
}

/** Der Kasten der Flamme um den Docht (Einheiten): oben so hoch, dass die äußere Ellipse hineinpasst, unten gleich tief
 * - so liegt seine Mitte genau auf dem Docht, und um die Mitte dreht und skaliert Android die Ansicht. */
export const FLAME_BOX = { left: 2.1, right: 2.1, top: 8.4, bottom: 8.4 };
const GLOW_R = 8.5;
const MATCH_R = 6;

function Cluster({ cluster }: { cluster: ClusterSpec }) {
  const base = ringPoint(cluster.angle);
  return (
    <G>
      {cluster.needles.map((needle, index) => {
        // Abwechselnd nach außen und nach innen, damit der Ring buschig wirkt; nach außen etwas länger.
        const outward = index % 2 === 0;
        const direction = ((cluster.angle + (outward ? needle.spread : 180 + needle.tilt)) * Math.PI) / 180;
        const length = outward ? needle.length * 1.15 : needle.length * 0.85;
        return <Line key={index} x1={base.x} y1={base.y} x2={base.x + Math.cos(direction) * length} y2={base.y + Math.sin(direction) * length * 0.55} stroke={cluster.shade} strokeWidth={1} strokeLinecap="round" />;
      })}
    </G>
  );
}

function Bow({ bow }: { bow: BowSpec }) {
  const point = ringPoint(bow.angle);
  return (
    <G x={point.x} y={point.y} rotation={bow.tilt} scale={bow.size}>
      <Ellipse cx={-2.4} cy={-0.6} rx={2.4} ry={1.5} fill="#b8262e" rotation={-28} />
      <Ellipse cx={2.4} cy={-0.6} rx={2.4} ry={1.5} fill="#b8262e" rotation={28} />
      <Ellipse cx={-2.2} cy={-0.9} rx={1.2} ry={0.5} fill="#d9454d" opacity={0.7} rotation={-28} />
      <Ellipse cx={2.2} cy={-0.9} rx={1.2} ry={0.5} fill="#d9454d" opacity={0.7} rotation={28} />
      <Path d="M -0.6 0.4 l -1.8 3.8 l 1.6 -0.5 z M 0.6 0.4 l 1.8 3.8 l -1.6 -0.5 z" fill="#9d1f27" />
      <Circle cx={0} cy={0} r={1} fill="#d33a42" />
    </G>
  );
}

/** Die Kerze in der Zeichnung: Wachs, Spur, Zahl, Docht - die Flamme liegt als Ebene darüber. */
function Candle({ candle, height, drip, lit }: { candle: CandleSpec; height: number; drip: number; lit: boolean }) {
  const top = candle.y - height;
  const { x } = candle;
  const half = CANDLE_WIDTH / 2;
  return (
    <G rotation={candle.lean} origin={`${x}, ${candle.y}`} testID={`advent-candle-${candle.index + 1}`}>
      <Ellipse cx={x} cy={candle.y + 0.5} rx={half + 1.4} ry={1.2} fill="#0f2a15" opacity={0.5} />
      <Rect x={x - half} y={top} width={CANDLE_WIDTH} height={height} rx={0.8} fill={`url(#advWax${candle.index})`} />
      <Line x1={x - half + 0.8} y1={top + 1.2} x2={x - half + 0.8} y2={candle.y - 1} stroke="rgba(255, 255, 255, 0.35)" strokeWidth={0.55} strokeLinecap="round" />
      <Ellipse cx={x} cy={top} rx={half} ry={0.9} fill="#fbf3e3" />
      <Ellipse cx={x} cy={top} rx={half - 0.9} ry={0.45} fill="#eadcbf" opacity={0.6} />
      {drip > 0 ? <Path d={dripPath(x + candle.dripSide * (half - 0.6), top + 0.7, drip, candle.dripSide)} fill="#f4e8d0" opacity={0.95} testID="advent-drip" /> : null}
      <SvgText x={x} y={candle.y - 1.5} textAnchor="middle" fontSize={3.2} fill="#8a7457" opacity={0.85}>{String(candle.index + 1)}</SvgText>
      <Line x1={x} y1={top} x2={x} y2={top - 1.7} stroke={lit ? "#4a2f1a" : "#5f5a54"} strokeWidth={0.7} strokeLinecap="round" />
    </G>
  );
}

/** Was eine Flamme von ihrer Kerze braucht: Fuß und Neigung, Kennung und wie sie flackert (Kranz und Torte, #644). */
export type FireCandle = Pick<CandleSpec, "x" | "y" | "lean" | "index" | "flameDuration" | "flameDelay" | "flameAmp" | "wickGlow">;
type FireProps = { candle: FireCandle; height: number; lighting: boolean; calm: boolean; still: boolean; wind: number; fit: { k: number; ox: number; oy: number }; testID?: string };

/**
 * Schein, Flamme und Streichholz einer brennenden Kerze - drei kleine Ebenen über dem Bild, mit eigenem Takt. `fit`
 * rechnet SVG-Einheiten in Punkte um; der Kranz und die Geburtstagstorte (#644) teilen sich die Flamme.
 */
export function Fire({ candle, height, lighting, calm, still, wind, fit, testID = "advent-flame" }: FireProps) {
  const flicker = useRef(new Animated.Value(0)).current;
  const ignite = useRef(new Animated.Value(lighting && !still ? 0 : 1)).current;
  const igniting = lighting && !still;

  // Flackern: eine Runde je Flammendauer, in der ruhigen Phase langsamer; still: nichts.
  useEffect(() => {
    if (still) {
      flicker.stopAnimation();
      flicker.setValue(0);
      return undefined;
    }
    const duration = Math.max(400, Math.round(candle.flameDuration * 1000 * (calm ? 1.8 : 1)));
    const loop = Animated.loop(Animated.timing(flicker, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }));
    // Der Versatz je Kerze aus dem Seed, damit keine zwei Flammen im Gleichtakt beginnen.
    const delay = Math.round((Math.abs(candle.flameDelay) * 1000) % duration);
    const handle = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(handle);
      loop.stop();
    };
  }, [still, calm, candle.flameDuration, candle.flameDelay, flicker]);

  // Anzünden: einmal von 0 auf 1 in 1,5 s.
  useEffect(() => {
    if (!igniting) {
      ignite.setValue(1);
      return undefined;
    }
    ignite.setValue(0);
    const animation = Animated.timing(ignite, { toValue: 1, duration: LIGHTING_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [igniting, ignite]);

  const { k, ox, oy } = fit;
  const lean = candle.lean;
  const frames = useMemo(() => flickerFrames(calm ? 0.4 : candle.flameAmp, still ? 0 : wind), [calm, candle.flameAmp, still, wind]);
  const deg = (values: number[]) => values.map((value) => `${tidy(lean + value)}deg`);
  const flame = igniting
    ? {
        rotate: ignite.interpolate({ inputRange: CATCH.input, outputRange: deg(CATCH.rotation) }),
        scaleX: ignite.interpolate({ inputRange: CATCH.input, outputRange: CATCH.scaleX }),
        scaleY: ignite.interpolate({ inputRange: CATCH.input, outputRange: CATCH.scaleY }),
        opacity: ignite.interpolate({ inputRange: CATCH.input, outputRange: CATCH.opacity }),
      }
    : {
        rotate: flicker.interpolate({ inputRange: frames.input, outputRange: deg(frames.rotation) }),
        scaleX: flicker.interpolate({ inputRange: frames.input, outputRange: frames.scaleX }),
        scaleY: flicker.interpolate({ inputRange: frames.input, outputRange: frames.scaleY }),
        opacity: 1,
      };
  const glowOpacity = igniting ? ignite.interpolate({ inputRange: [0, 1], outputRange: [0, 0.85] }) : still ? 0.9 : flicker.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.75, 1, 0.75] });

  // Docht, Schein (3 Einheiten darüber), Glut und Streichholz - mit der Neigung der Kerze.
  const wick = abovePoint(candle, height, 1.4);
  const glow = abovePoint(candle, height, 4.4);
  const ember = abovePoint(candle, height, 1.6);
  const match = abovePoint(candle, height, 2);
  const box = FLAME_BOX;
  const boxWidth = box.left + box.right;
  const boxHeight = box.top + box.bottom;
  const index = candle.index;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={testID}>
      <Animated.View style={[styles.layer, { left: ox + (glow.x - GLOW_R) * k, top: oy + (glow.y - GLOW_R) * k, width: GLOW_R * 2 * k, height: GLOW_R * 2 * k, opacity: glowOpacity }]}>
        <Svg width={GLOW_R * 2 * k} height={GLOW_R * 2 * k} viewBox={`${-GLOW_R} ${-GLOW_R} ${GLOW_R * 2} ${GLOW_R * 2}`}>
          <Defs>
            <RadialGradient id={`advGlow${index}`} cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor="#ffb860" stopOpacity={0.55} />
              <Stop offset="0.6" stopColor="#ffaa50" stopOpacity={0.16} />
              <Stop offset="1" stopColor="#ffa046" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={0} cy={0} r={GLOW_R} fill={`url(#advGlow${index})`} />
          <Circle cx={ember.x - glow.x} cy={ember.y - glow.y} r={0.55} fill="#ff9a3c" opacity={candle.wickGlow} />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          styles.layer,
          {
            left: ox + (wick.x - box.left) * k,
            top: oy + (wick.y - box.top) * k,
            width: boxWidth * k,
            height: boxHeight * k,
            opacity: flame.opacity,
            transform: [{ rotate: flame.rotate }, { scaleX: flame.scaleX }, { scaleY: flame.scaleY }],
          },
        ]}
        testID={`advent-flame-body-${index + 1}`}
      >
        <Svg width={boxWidth * k} height={boxHeight * k} viewBox={`${-box.left} ${-box.top} ${boxWidth} ${boxHeight}`}>
          <Defs>
            <RadialGradient id={`advFlame${index}`} cx="50%" cy="68%" rx="60%" ry="60%">
              <Stop offset="0" stopColor="#fff1c2" />
              <Stop offset="0.55" stopColor="#ffb13b" />
              <Stop offset="1" stopColor="#ff7a1a" stopOpacity={0.85} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={0} cy={-3.6} rx={1.9} ry={4.6} fill={`url(#advFlame${index})`} />
          <Ellipse cx={0} cy={-3.1} rx={1.15} ry={3.2} fill="#ffd27a" opacity={0.95} />
          <Ellipse cx={0} cy={-2.4} rx={0.55} ry={1.8} fill="#fff8e6" />
          <Ellipse cx={0} cy={-0.7} rx={0.95} ry={0.75} fill="#7fb2ff" opacity={0.55} />
        </Svg>
      </Animated.View>
      {igniting ? (
        <Animated.View
          style={[
            styles.layer,
            {
              left: ox + (match.x - MATCH_R) * k,
              top: oy + (match.y - MATCH_R) * k,
              width: MATCH_R * 2 * k,
              height: MATCH_R * 2 * k,
              opacity: ignite.interpolate({ inputRange: MATCH.input, outputRange: MATCH.opacity }),
              transform: [{ scale: ignite.interpolate({ inputRange: MATCH.input, outputRange: MATCH.scale }) }],
            },
          ]}
          testID="advent-match"
        >
          <Svg width={MATCH_R * 2 * k} height={MATCH_R * 2 * k} viewBox={`${-MATCH_R} ${-MATCH_R} ${MATCH_R * 2} ${MATCH_R * 2}`}>
            <Defs>
              <RadialGradient id={`advMatch${index}`} cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor="#ffe1a0" stopOpacity={0.95} />
                <Stop offset="1" stopColor="#ffbe6e" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={0} cy={0} r={MATCH_R} fill={`url(#advMatch${index})`} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

export function Wreath({ layout, candles, daysLit = [], lighting = [], calm = [], still = false, wind = WIND, width = 72, height = 42 }: WreathProps) {
  const back = useMemo(() => layout.clusters.filter((cluster) => !cluster.front), [layout]);
  const front = useMemo(() => layout.clusters.filter((cluster) => cluster.front), [layout]);
  const burns = useMemo(() => layout.candles.map((candle) => candleBurn(candle, daysLit[candle.index])), [layout, daysLit]);
  const fit = viewFit(width, height);
  return (
    <View style={{ width, height }} testID="advent-wreath-box">
      <Svg width={width} height={height} viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} testID="advent-wreath-svg">
        <Defs>
          {layout.candles.map((candle) => (
            <LinearGradient key={candle.index} id={`advWax${candle.index}`} x1="0" x2="1" y1="0" y2="0">
              <Stop offset="0" stopColor="#fdf7ea" />
              <Stop offset="0.4" stopColor={candle.tint} />
              <Stop offset="1" stopColor="#cdb48c" />
            </LinearGradient>
          ))}
        </Defs>
        <Ellipse cx={RING.cx} cy={RING.cy + 0.8} rx={RING.rx} ry={RING.ry} fill="none" stroke="#12331a" strokeWidth={7} opacity={0.95} />
        <Ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} fill="none" stroke="#24552d" strokeWidth={4.5} />
        <G testID="advent-branches-back">
          {back.map((cluster, index) => <Cluster key={index} cluster={cluster} />)}
        </G>
        {layout.candles.map((candle) => (
          <Candle key={candle.index} candle={candle} height={candle.height - burns[candle.index].burnDown} drip={burns[candle.index].drip} lit={candle.index < candles} />
        ))}
        <G testID="advent-branches-front">
          {front.map((cluster, index) => <Cluster key={index} cluster={cluster} />)}
          {layout.berries.map((berry, index) => {
            const point = ringPoint(berry.angle, { ...RING, rx: RING.rx * berry.inset, ry: RING.ry * berry.inset });
            const turn = (berry.turn * Math.PI) / 180;
            return (
              <G key={index}>
                {BERRY_TRIAD.map(([dx, dy], n) => {
                  const ox = (dx * Math.cos(turn) - dy * Math.sin(turn)) * berry.radius;
                  const oy = (dx * Math.sin(turn) + dy * Math.cos(turn)) * berry.radius * 0.7;
                  return <Circle key={n} cx={point.x + ox} cy={point.y + oy} r={berry.radius * 0.72} fill="#c8323a" stroke="#7d151c" strokeWidth={0.25} />;
                })}
              </G>
            );
          })}
          {layout.bows.map((bow, index) => <Bow key={index} bow={bow} />)}
        </G>
      </Svg>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {layout.candles.filter((candle) => candle.index < candles).map((candle) => (
          <Fire
            key={candle.index}
            candle={candle}
            height={candle.height - burns[candle.index].burnDown}
            lighting={lighting.includes(candle.index)}
            calm={calm.includes(candle.index)}
            still={still}
            wind={wind}
            fit={fit}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute" },
});
