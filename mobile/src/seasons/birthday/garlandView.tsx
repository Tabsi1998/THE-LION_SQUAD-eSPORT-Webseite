import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { REST_MS, createRest } from "../cardLift";
import { easeDegrees } from "../frames";
import { useScreenFocused } from "../screenFocus";
import { useSeason } from "../SeasonProvider";
import { useCardLift } from "../useCardLift";
import { EDGE_GARLAND, PENNANT_FLUTTER, edgePennants, edgeString, pennantFrames, type Pennant } from "./garland";

// Die Wimpelkette an einer Kante (B2 #750, App S13 #644): ein Faden in zwei flachen Bögen von Rand zu Rand, daran Wimpel
// in Vereinsfarben, die kaum wehen - an der Begrüßungskarte (BirthdayEdge) und seit Jahreszeiten IV (#1094) an einigen
// weiteren Karten (CardGarland). Wird die Karte angetippt, flattert die Kette einmal durch: eine Welle läuft in einer
// Sekunde von links nach rechts (garland.ts). Jeder Wimpel dreht sich in Ebenen, deren Mitte auf seiner Aufhängung
// liegt - das Wehen außen, das Flattern innen (Android dreht Ansichten um ihre Mitte).

const flutterRest = createRest(REST_MS.small);

/** Nur für Tests: die Ruhezeiten vergessen. */
export function resetGarlandFlutter() {
  flutterRest.clear();
}

export type GarlandFlutter = { n: number; progress: Animated.Value };

/** Die Kette der Karte `cardKey` flattert, wenn die Karte angetippt wird - höchstens alle zehn Sekunden je Karte. */
export function useGarlandFlutter(cardKey: string | null, enabled = true): GarlandFlutter | null {
  const progress = useRef(new Animated.Value(0)).current;
  const [flutter, setFlutter] = useState<GarlandFlutter | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useCardLift((detail) => {
    if (!cardKey || detail.key !== cardKey || !flutterRest.take(cardKey)) return;
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: PENNANT_FLUTTER.ms, easing: Easing.linear, useNativeDriver: true }).start();
    setFlutter({ n: Date.now(), progress });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setFlutter(null);
    }, PENNANT_FLUTTER.ms + 60);
  }, Boolean(cardKey) && enabled);
  return flutter;
}

/**
 * Die Kette über ihre Breite: Faden und Wimpel. `drop` lässt sie beim ersten Mal einzeln erscheinen (1 = alle da),
 * `moving` lässt sie leise wehen, `flutter` flattert sie gerade durch.
 */
export function GarlandBand({ width, pennants, moving, drop = null, flutter = null, testID = "birthday-pennant" }: { width: number; pennants: Pennant[]; moving: boolean; drop?: Animated.Value | null; flutter?: GarlandFlutter | null; testID?: string }) {
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!moving) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [moving, sway]);
  const string = useMemo(() => edgeString(pennants, width), [pennants, width]);
  return (
    <>
      {width > 0 ? (
        <Svg width={width} height={EDGE_GARLAND.band} style={StyleSheet.absoluteFill}>
          <Path d={string} stroke="rgba(255, 255, 255, 0.45)" strokeWidth={0.8} fill="none" />
        </Svg>
      ) : null}
      {pennants.map((pennant, index) => {
        const reveal = drop ? drop.interpolate({ inputRange: [Math.min(0.95, index / (pennants.length + 2)), Math.min(1, (index + 3) / (pennants.length + 2))], outputRange: [0, 1], extrapolate: "clamp" }) : 1;
        // Drehen um den Aufhängepunkt: die Ebene ist doppelt so hoch und steht mit ihrer Mitte darauf.
        const rotate = sway.interpolate({ inputRange: [0, 1], outputRange: index % 2 ? ["-3deg", "3deg"] : ["3deg", "-3deg"] });
        const frames = pennantFrames(index, pennants.length);
        const shake = flutter ? flutter.progress.interpolate(easeDegrees(frames.inputRange, frames.outputRange.map((value) => parseFloat(value)))) : "0deg";
        return (
          <Animated.View key={index} style={[styles.pennant, { left: pennant.x - pennant.size / 2, top: pennant.y - pennant.size, width: pennant.size, height: pennant.size * 2, opacity: reveal, transform: [{ rotate }] }]} testID={testID}>
            <Animated.View style={{ width: pennant.size, height: pennant.size * 2, transform: [{ rotate: shake }] }}>
              <Svg width={pennant.size} height={pennant.size * 2}>
                <Path d={`M 0 ${pennant.size} L ${pennant.size} ${pennant.size} L ${pennant.size / 2} ${pennant.size * 1.9} Z`} fill={pennant.color} stroke="rgba(0, 0, 0, 0.25)" strokeWidth={0.5} />
              </Svg>
            </Animated.View>
          </Animated.View>
        );
      })}
    </>
  );
}

/** Eine Wimpelkette an einer Karte (#1094) - wie an der Begrüßungskarte, je Karte und Jahr eine eigene. */
export function CardGarland({ perchId, year }: { perchId: string; year: number }) {
  const { reducedMotion, byKey } = useSeason();
  const focused = useScreenFocused();
  const [width, setWidth] = useState(0);
  const pennants = useMemo(() => (width > 0 ? edgePennants(width, year, `card:${perchId}`) : []), [width, year, perchId]);
  const flutter = useGarlandFlutter(perchId, pennants.length > 0);
  const moving = (byKey?.club_birthday?.effective || "normal") !== "subtle" && !reducedMotion && focused;
  return (
    <View pointerEvents="none" style={styles.edge} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} testID="birthday-card-garland" data-flutter={flutter ? "1" : undefined}>
      <GarlandBand width={width} pennants={pennants} moving={moving} flutter={flutter} testID="birthday-card-pennant" />
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: "absolute", left: 0, right: 0, bottom: 0, height: EDGE_GARLAND.band },
  pennant: { position: "absolute" },
});
