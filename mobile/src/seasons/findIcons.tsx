import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, RadialGradient, Rect, Ellipse, Stop } from "react-native-svg";
import { CatShape } from "./atmosphere";
import { SittingBatShape } from "./batArt";
import { Ghost, Pumpkin } from "./halloween";

// Die kleinen Figuren der Saison-Fundstücke (#678, Web #776): Fledermaus, Geist, Katze und Kürbis sind dieselben wie
// in der Deko der App - wer eine Fledermaus verscheucht hat, erkennt sie hier wieder. Schneeflocke, Türchen, Rakete
// und Ei sind im selben Strich gezeichnet wie im Web: dunkle Fläche, heller Rand in Silber-Türkis, nichts Grelles.
// Jede Figur sitzt auf einer Scheibe aus Mondlicht - ohne sie verschwänden die dunklen Silhouetten im Grund.

const INK = "#0b0a0f";
const RIM = "rgba(170,225,240,0.55)";
const SOFT = "rgba(170,225,240,0.26)";
export const DISC = 48;

function Flake({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="-16 -16 32 32">
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <G key={angle} rotation={angle} stroke="#dff6ff" strokeWidth={1.6} strokeLinecap="round" fill="none">
          <Line x1={0} y1={0} x2={0} y2={-13} />
          <Line x1={0} y1={-8} x2={-3.4} y2={-10.8} />
          <Line x1={0} y1={-8} x2={3.4} y2={-10.8} />
          <Line x1={0} y1={-4.5} x2={-2.2} y2={-6.2} />
          <Line x1={0} y1={-4.5} x2={2.2} y2={-6.2} />
        </G>
      ))}
      <Circle cx={0} cy={0} r={1.8} fill="#dff6ff" />
    </Svg>
  );
}

function Door({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Rect x={6} y={3} width={20} height={26} rx={1.5} fill="rgba(255,214,140,0.16)" stroke={SOFT} strokeWidth={1} />
      <Rect x={6} y={3} width={20} height={26} rx={1.5} fill={INK} stroke={RIM} strokeWidth={1.1} />
      <Rect x={9.5} y={6.5} width={13} height={8} rx={1} fill="none" stroke={SOFT} strokeWidth={0.9} />
      <Rect x={9.5} y={17.5} width={13} height={8} rx={1} fill="none" stroke={SOFT} strokeWidth={0.9} />
      <Circle cx={22.5} cy={16} r={1.2} fill="#ffd68c" />
    </Svg>
  );
}

function Rocket({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path d="M16 3 C20 7 21 13 20 20 H12 C11 13 12 7 16 3 Z" fill={INK} stroke={RIM} strokeWidth={1.1} strokeLinejoin="round" />
      <Path d="M12 16 L8 22 L12 21 Z M20 16 L24 22 L20 21 Z" fill={INK} stroke={RIM} strokeWidth={1} strokeLinejoin="round" />
      <Circle cx={16} cy={11.5} r={2} fill="#9be7ff" />
      <Path d="M13 20 H19" stroke={SOFT} strokeWidth={1} />
      <Path d="M14 21 C14 25 15 27 16 29 C17 27 18 25 18 21 Z" fill="#ffb347" opacity={0.85} />
    </Svg>
  );
}

function Egg({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path d="M16 3 C21.5 3 26 11 26 18.5 C26 24.5 21.5 29 16 29 C10.5 29 6 24.5 6 18.5 C6 11 10.5 3 16 3 Z" fill="#1b2a33" stroke={RIM} strokeWidth={1.1} />
      <Path d="M7.4 15 C10 13 12.5 17 15.5 15 S21 13 24.6 15" stroke="#9be7ff" strokeWidth={1.3} fill="none" strokeLinecap="round" />
      <Path d="M6.6 21 C9.5 19 12.5 23 15.5 21 S21.5 19 25.4 21" stroke="#ffd68c" strokeWidth={1.3} fill="none" strokeLinecap="round" />
      <Ellipse cx={12} cy={9.5} rx={2.4} ry={1.4} fill="rgba(255,255,255,0.14)" rotation={-30} origin="12, 9.5" />
    </Svg>
  );
}

const FIGURES: Record<string, () => React.ReactElement> = {
  bat: () => <SittingBatShape size={26} />,
  ghost: () => <Ghost size={23} />,
  cat: () => <CatShape size={33} />,
  pumpkin: () => <Pumpkin size={28} />,
  snowflake: () => <Flake />,
  door: () => <Door />,
  rocket: () => <Rocket />,
  egg: () => <Egg />,
};

export const FIND_ICONS = Object.keys(FIGURES);

type Motion = Animated.WithAnimatedObject<ViewStyle>;

/**
 * Was die Figur beim Antippen tut - wie beim Überfahren im Web: die Fledermaus breitet die Flügel, der Geist steigt
 * und wird blasser, die Schneeflocke dreht sich, das Türchen geht auf, die Rakete hebt ab, Ei und Katze wackeln. Nur
 * Drehung, Maß und Versatz um die Mitte der Figur - das kann der native Treiber auch auf Android sauber.
 */
export function findMotion(icon: string, poke: Animated.Value): Motion {
  const wobble = poke.interpolate({ inputRange: [0, 0.25, 0.6, 0.85, 1], outputRange: ["0deg", "-9deg", "7deg", "-3deg", "0deg"] });
  switch (icon) {
    case "bat":
      return { transform: [{ scaleX: poke.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [1, 1.22, 0.92, 1] }) }] };
    case "ghost":
      return { transform: [{ translateY: poke.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -4, 0] }) }], opacity: poke.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.8, 1] }) };
    case "snowflake":
      return { transform: [{ rotate: poke.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "60deg"] }) }] };
    case "door":
      return { transform: [{ scaleX: poke.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.62, 1] }) }] };
    case "rocket":
      return { transform: [{ translateY: poke.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -3, 0] }) }] };
    case "pumpkin":
      return { transform: [{ scale: poke.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.08, 1] }) }] };
    default:
      return { transform: [{ rotate: wobble }] };
  }
}

/** Die Figur zu einem Fundstück auf ihrer Scheibe. Unbekannte Schlüssel bekommen die Schneeflocke - nie eine Lücke. */
export function FindFigure({ icon, empty = false, poke }: { icon: string; empty?: boolean; poke?: Animated.Value }) {
  const key = FIGURES[icon] ? icon : "snowflake";
  const Figure = FIGURES[key];
  const idle = useRef(new Animated.Value(0)).current;
  const motion = findMotion(key, poke || idle);
  return (
    <View style={[styles.disc, empty && styles.empty]} testID={`find-figure-${key}`}>
      <Svg width={DISC} height={DISC} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="moon" cx="50%" cy="36%" r="50%">
            <Stop offset="0" stopColor="rgb(170,225,240)" stopOpacity={0.26} />
            <Stop offset="0.58" stopColor="rgb(120,190,215)" stopOpacity={0.1} />
            <Stop offset="1" stopColor="rgb(120,190,215)" stopOpacity={0.03} />
          </RadialGradient>
          <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.6" stopColor="#000" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.28} />
          </LinearGradient>
        </Defs>
        <Circle cx={DISC / 2} cy={DISC / 2} r={DISC / 2} fill="url(#moon)" />
        <Circle cx={DISC / 2} cy={DISC / 2} r={DISC / 2} fill="url(#shade)" />
        <Circle cx={DISC / 2} cy={DISC / 2} r={DISC / 2 - 0.5} fill="none" stroke="rgba(170,225,240,0.12)" strokeWidth={1} />
      </Svg>
      <Animated.View style={[styles.figure, motion]} testID={`find-figure-${key}-motion`}>
        <Figure />
      </Animated.View>
    </View>
  );
}

/** Ein Antippen: die Figur regt sich einmal (0,7 s, nativer Treiber). */
export function usePoke(reduced: boolean): [Animated.Value, () => void] {
  const poke = useRef(new Animated.Value(0)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => () => running.current?.stop(), []);
  const start = () => {
    if (reduced) return;
    running.current?.stop();
    poke.setValue(0);
    running.current = Animated.timing(poke, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    running.current.start();
  };
  return [poke, start];
}

const styles = StyleSheet.create({
  disc: { width: DISC, height: DISC, alignItems: "center", justifyContent: "center" },
  empty: { opacity: 0.38 },
  figure: { alignItems: "center", justifyContent: "center" },
});
