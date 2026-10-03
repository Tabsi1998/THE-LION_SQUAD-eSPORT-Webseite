import * as Haptics from "expo-haptics";
import React, { useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Polyline, Stop, Text as SvgText } from "react-native-svg";
import { requestConfettiBurst } from "../carnival";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { yearsOf } from "./index";

// Die Geburtstagsmütze in der App (#856), dieselbe wie im Web (frontend/src/seasons/birthday/hat.jsx): goldener Kegel,
// blaues Zickzack, weißer Bommel, vorne die Zahl der Jahre. Im Dashboard-Kopf: antippen → wippen, leichtes Tippen, eine
// Handvoll Konfetti aus der Mütze - höchstens alle zehn Sekunden. Am Tab „Mehr“ als Symbol. Bei „dezent“ und
// „Bewegung reduzieren“ nur ein Bild.

export const HAT_COOLDOWN_MS = 10000;
export const WIGGLE_MS = 700;

/** Die Zahl passt bis zwei Ziffern auf den Kegel; darüber ein Stern (wie im Web). */
export function hatNumber(years: number | null | undefined): string {
  const count = Math.round(Number(years));
  if (!Number.isFinite(count) || count < 1) return "";
  const text = String(count);
  return text.length <= 2 ? text : "";
}

let hatIds = 0;

export function BirthdayHatArt({ size = 24, years = null }: { size?: number; years?: number | null }) {
  const [ids] = useState(() => `tls-bday-hat-${(hatIds += 1)}`);
  const number = hatNumber(years);
  return (
    <Svg width={size} height={size * 1.3} viewBox="0 0 40 52" testID="birthday-hat-art">
      <Defs>
        <LinearGradient id={`${ids}-gold`} x1="0" x2="1" y1="0" y2="0">
          <Stop offset="0" stopColor="#c9a800" />
          <Stop offset="0.38" stopColor="#ffe66b" />
          <Stop offset="0.62" stopColor="#FFD700" />
          <Stop offset="1" stopColor="#b89400" />
        </LinearGradient>
        <ClipPath id={`${ids}-cone`}><Path d="M20 7 L34.5 45 Q20 50 5.5 45 Z" /></ClipPath>
      </Defs>
      <Path d="M20 7 L34.5 45 Q20 50 5.5 45 Z" fill={`url(#${ids}-gold)`} />
      <G clipPath={`url(#${ids}-cone)`}>
        <Polyline points="2,41 6,37.4 10,41 14,37.4 18,41 22,37.4 26,41 30,37.4 34,41 38,37.4" fill="none" stroke="#29B6E8" strokeWidth={2.4} strokeLinejoin="round" />
        <Circle cx={14.5} cy={19} r={1.3} fill="#ffffff" />
        <Circle cx={25.5} cy={23} r={1.2} fill="#29B6E8" />
        <Circle cx={11} cy={31} r={1.1} fill="#ffffff" />
        <Circle cx={29} cy={32.5} r={1.1} fill="#ffffff" />
        {!number ? <Path d="M20 22 l1.6 3.4 3.7 0.4 -2.8 2.5 0.8 3.6 -3.3 -1.9 -3.3 1.9 0.8 -3.6 -2.8 -2.5 3.7 -0.4 Z" fill="#ffffff" /> : null}
      </G>
      {number ? (
        <SvgText x={20} y={number.length > 1 ? 33 : 34} textAnchor="middle" fontSize={number.length > 1 ? 10.5 : 13} fontWeight="900"
          fill="#0b2233" stroke="#fff6e0" strokeWidth={1.3} testID="birthday-hat-number">{number}</SvgText>
      ) : null}
      <Path d="M5.5 45 Q20 50 34.5 45" stroke="#29B6E8" strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <Circle cx={20} cy={6.5} r={4.7} fill="#f7f4ee" />
      <Circle cx={18.6} cy={5} r={1.5} fill="#ffffff" />
      <Path d="M15.6 3 l-1.8 -1.8 M20 1.2 v-1.4 M24.4 3 l1.8 -1.8" stroke="#29B6E8" strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  );
}

/** Die Mütze als Symbol des Tabs „Mehr“ - etwas schmaler, damit sie mit Bommel in die Leiste passt. */
export function BirthdayHatTabIcon({ size }: { size: number }) {
  return (
    <View style={{ transform: [{ rotate: "-10deg" }] }} testID="birthday-tab-hat">
      <BirthdayHatArt size={Math.round(size * 0.82)} />
    </View>
  );
}

/** Die Mütze im Dashboard-Kopf: antippen → wippen, leichtes Tippen, Konfetti aus der Mütze. */
export function BirthdayHatWidget({ season }: { season: ActiveSeason; screen: string }) {
  const { reducedMotion } = useSeason();
  const ref = useRef<View>(null);
  const last = useRef(0);
  const wiggle = useRef(new Animated.Value(0)).current;
  const years = yearsOf(season);
  const still = reducedMotion || season.effective === "subtle";
  if (still) {
    return (
      <View style={styles.widget} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="birthday-hat-widget">
        <View style={styles.tilt}><BirthdayHatArt size={24} years={years} /></View>
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
    <Pressable ref={ref} onPress={onPress} accessibilityRole="button" accessibilityLabel="Geburtstagsmütze – Konfetti werfen" hitSlop={8} style={styles.widget} testID="birthday-hat-widget">
      <Animated.View style={{ transform: [{ translateY }, { rotate }] }} testID="birthday-hat">
        <BirthdayHatArt size={24} years={years} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  widget: { width: 34, height: 40, alignItems: "center", justifyContent: "center" },
  tilt: { transform: [{ rotate: "-12deg" }] },
});
