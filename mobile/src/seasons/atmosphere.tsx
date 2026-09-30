import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Stop } from "react-native-svg";
import { INK, RIM } from "./batArt";
import { recordSignal } from "./signals";

// Atmosphäre der App (A4, #718 - wie H14/H16 im Web): Nebel in einer oder zwei sehr leisen Ebenen unten im Bild als
// Screen-Mischung (hellt nur dunkle Flächen auf), still - auf dem Handy kein Drift; und die Katze, die auf
// ausgewählten Screens über der Tab-Leiste sitzt, den Schwanz wedelt, blinzelt und beim Antippen ein Stück
// weitertrottet. Beides nimmt keine Berührungen außer dem Antippen der Katze.

const FOG_FAR = "rgba(150, 205, 225, 1)";
const FOG_NEAR = "rgba(170, 225, 240, 1)";
export const CAT_WALK_MS = 1400;
export const CAT_COOLDOWN_MS = 8000;

/** `level`: none | far | near - eine oder zwei Ebenen unten im Bild, `mixBlendMode: screen`, wo es das gibt. */
export function Fog({ level, width, height, bottom }: { level: "none" | "far" | "near"; width: number; height: number; bottom: number }) {
  if (level === "none" || width <= 0 || height <= 0) return null;
  const layerHeight = Math.round(height * 0.42);
  const blend = { mixBlendMode: "screen" } as unknown as Record<string, unknown>;
  return (
    <View pointerEvents="none" style={[styles.fog, { height: layerHeight, bottom }, blend]} testID="halloween-fog" data-level={level}>
      <Svg width={width} height={layerHeight}>
        <Defs>
          <RadialGradient id="tls-fog-far" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={FOG_FAR} stopOpacity={0.085} />
            <Stop offset="0.7" stopColor={FOG_FAR} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="tls-fog-near" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={FOG_NEAR} stopOpacity={0.11} />
            <Stop offset="0.7" stopColor={FOG_NEAR} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={width * 0.3} cy={layerHeight * 0.85} rx={width * 0.42} ry={layerHeight * 0.5} fill="url(#tls-fog-far)" />
        <Ellipse cx={width * 0.78} cy={layerHeight * 0.92} rx={width * 0.4} ry={layerHeight * 0.42} fill="url(#tls-fog-far)" />
        {level === "near" ? (
          <G>
            <Ellipse cx={width * 0.18} cy={layerHeight} rx={width * 0.34} ry={layerHeight * 0.55} fill="url(#tls-fog-near)" />
            <Ellipse cx={width * 0.64} cy={layerHeight} rx={width * 0.36} ry={layerHeight * 0.48} fill="url(#tls-fog-near)" />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}

/** Die sitzende Katze von der Seite (wie art.jsx im Web): Ohren, Rücken, aufgerollter Schwanz, Augen im Türkis der Saison. */
export function CatShape({ size = 56, tailRotate, eyesScale, pupilX }: { size?: number; tailRotate?: Animated.AnimatedInterpolation<number>; eyesScale?: Animated.AnimatedInterpolation<string>; pupilX?: number }) {
  const body = "M18 78 C 9 66, 12 48, 28 42 C 36 38, 50 38, 58 44 C 71 52, 71 68, 63 78 Z";
  const tail = "M60 76 C 79 74, 87 58, 75 46 C 70 42, 63 44, 65 50";
  const width = size;
  const height = size * 0.9;
  const AnimatedG = Animated.createAnimatedComponent(G);
  return (
    <Svg width={width} height={height} viewBox="0 0 90 81">
      <AnimatedG rotation={tailRotate} origin="60, 76">
        <Path d={tail} stroke={RIM} strokeWidth={7.6} fill="none" strokeLinecap="round" />
        <Path d={tail} stroke={INK} strokeWidth={6} fill="none" strokeLinecap="round" />
      </AnimatedG>
      <Path d={body} fill={RIM} transform="translate(0.6 -0.9)" />
      <Path d={body} fill={INK} />
      <G>
        <Path d="M24 21 L20 4 L33 16 Z M44 21 L48 4 L35 16 Z" fill={RIM} transform="translate(0 -1)" />
        <Circle cx={34} cy={30} r={13.8} fill={RIM} />
        <Path d="M24 21 L20 4 L33 16 Z M44 21 L48 4 L35 16 Z" fill={INK} />
        <Circle cx={34} cy={30} r={13} fill={INK} />
        <Path d="M23 18 L21 9 L28 15 Z M45 18 L47 9 L40 15 Z" fill="rgba(170, 225, 240, 0.12)" />
        <AnimatedG scale={eyesScale} origin="34, 30">
          <Ellipse cx={28} cy={30} rx={3.2} ry={2.6} fill="#9be7ff" />
          <Ellipse cx={40} cy={30} rx={3.2} ry={2.6} fill="#9be7ff" />
          <Ellipse cx={28 + (pupilX || 0)} cy={30} rx={1} ry={2.3} fill={INK} />
          <Ellipse cx={40 + (pupilX || 0)} cy={30} rx={1} ry={2.3} fill={INK} />
        </AnimatedG>
        <Path d="M12 33 l13 1 M12 37 l13 -1 M56 33 l-13 1 M56 37 l-13 -1" stroke="rgba(170, 225, 240, 0.3)" strokeWidth={0.7} />
      </G>
    </Svg>
  );
}

/**
 * Die Katze über der Tab-Leiste (rechts, damit die Gräber links Platz haben): Schwanz wedelt langsam, Augen blinzeln
 * alle sechs Sekunden; Antippen lässt sie ein Stück weitertrotten (leichte Haptik, danach acht Sekunden Ruhe).
 * Ohne Bewegung sitzt sie still.
 */
export const CAT_SIGNAL = "halloween_cat_petted";

export function CatOnEdge({ size = 56, bottom, width, moving, testID = "halloween-cat" }: { size?: number; bottom: number; width: number; moving: boolean; testID?: string }) {
  const tail = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const walk = useRef(new Animated.Value(0)).current;
  const [offset, setOffset] = useState(0);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [walking, setWalking] = useState(false);
  const lastWalk = useRef(0);
  useEffect(() => {
    if (!moving) return undefined;
    const tailLoop = Animated.loop(Animated.sequence([
      Animated.timing(tail, { toValue: 1, duration: 2250, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(tail, { toValue: 0, duration: 2250, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    const blinkLoop = Animated.loop(Animated.sequence([
      Animated.delay(5600),
      Animated.timing(blink, { toValue: 0.06, duration: 90, useNativeDriver: false }),
      Animated.timing(blink, { toValue: 1, duration: 140, useNativeDriver: false }),
    ]));
    tailLoop.start();
    blinkLoop.start();
    return () => {
      tailLoop.stop();
      blinkLoop.stop();
      tail.setValue(0);
      blink.setValue(1);
    };
  }, [moving, tail, blink]);
  const onPress = () => {
    const now = Date.now();
    if (!moving || walking || now - lastWalk.current < CAT_COOLDOWN_MS) return;
    lastWalk.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Die Katze anstupsen zählt für die Saison-Fundstücke (#678) - der Server deckelt je Tag.
    void recordSignal(CAT_SIGNAL, { onceIf: false });
    const room = Math.max(60, width - size - 40);
    const target = offset > room * 0.5 ? Math.max(0, offset - 90 - Math.random() * 60) : Math.min(room, offset + 90 + Math.random() * 60);
    setFacing(target < offset ? -1 : 1);
    setWalking(true);
    walk.setValue(0);
    Animated.timing(walk, { toValue: 1, duration: CAT_WALK_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(() => {
      setOffset(target);
      setWalking(false);
      walk.setValue(0);
    });
    walkTarget.current = target;
  };
  const walkTarget = useRef(0);
  const tailRotate = tail.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const eyesScale = blink.interpolate({ inputRange: [0.06, 1], outputRange: ["1, 0.06", "1, 1"] });
  const translateX = walk.interpolate({ inputRange: [0, 1], outputRange: [0, walking ? walkTarget.current - offset : 0] });
  const bob = walk.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -2, 0, -2, 0] });
  return (
    <Animated.View style={[styles.cat, { bottom, right: 18 + offset, transform: [{ translateX: Animated.multiply(translateX, -1) }, { translateY: bob }, { scaleX: facing === 1 ? -1 : 1 }] }]} testID={testID} data-walking={walking ? "1" : "0"}>
      <Pressable accessibilityRole="button" accessibilityLabel="Katze" onPress={onPress} hitSlop={6} testID="halloween-cat-press">
        <CatShape size={size} tailRotate={tailRotate} eyesScale={eyesScale} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fog: { position: "absolute", left: 0, right: 0, opacity: 0.9 },
  cat: { position: "absolute" },
});
