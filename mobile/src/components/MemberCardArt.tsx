import React, { useEffect, useRef, useState } from "react";
import { Animated, Image, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { MOTION, motionEasing } from "../lib/motion";
import { colors } from "../theme";
import { useReduceMotion } from "./FadeIn";
import { Body, Muted } from "./Text";

// Die Mitgliedskarte (#1335, wie im Web: schwarz mit Gold): Format einer Bankkarte, feines Löwen-Muster, Vereinslogo in Gold,
// Lichtkante, Name, Mitgliedsnummer, Art und „gültig bis“. Dieselbe Karte steht auf „Mitgliedskarte“ (mit Prüfcode
// darunter), auf „Meine Mitgliedschaft“ und oben im Tab „Verein“ (#1336). Ein ruhiger Lichtlauf zieht einmal über die Karte,
// wenn sie erscheint - mit „Bewegung reduzieren“ nie.

const MASCOT = require("../../assets/brand/tls-mascot.png");
export const CARD_RATIO = 1.586;

/** „Nr. TLS-031 · seit 2024“ - was davon da ist. */
export function cardNumberLine(number?: string | null, since?: string | number | null): string {
  const year = /^\d{4}/.test(String(since ?? "")) ? String(since).slice(0, 4) : "";
  return [number ? `Nr. ${number}` : "", year ? `seit ${year}` : ""].filter(Boolean).join(" · ");
}

/** „gültig bis 31.12.2026“ aus einem Tag (JJJJ-MM-TT). */
export function validLine(validUntil?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(validUntil || ""));
  return match ? `gültig bis ${match[3]}.${match[2]}.${match[1]}` : "";
}

export function MemberCardArt({ name, number, since, typeLabel, validUntil, clubName = "The Lion Squad", style, testID = "member-card-art" }: {
  name: string;
  number?: string | null;
  since?: string | number | null;
  typeLabel?: string | null;
  validUntil?: string | null;
  clubName?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const swept = useRef(false);

  useEffect(() => {
    if (reduce || !width || swept.current) return undefined;
    swept.current = true;
    const animation = Animated.timing(sweep, { toValue: 1, duration: MOTION.slow * 3, easing: motionEasing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [reduce, width, sweep]);

  // Vor dem ersten Messen (und in Tests) mit einer üblichen Breite rechnen - die Texte stehen so von Anfang an da.
  const unit = (width || 320) / 100;
  const numberLine = cardNumberLine(number, since);
  const meta = [typeLabel, validLine(validUntil)].filter(Boolean).join(" · ");
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  return (
    <View style={[styles.card, style]} onLayout={onLayout} testID={testID} accessibilityLabel={[`Mitgliedskarte ${name}`, numberLine, meta].filter(Boolean).join(", ")}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="tlsCardBg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#1B1B1F" />
            <Stop offset="0.6" stopColor="#0B0B0D" />
            <Stop offset="1" stopColor="#16130A" />
          </LinearGradient>
          <LinearGradient id="tlsCardChip" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F8E08E" />
            <Stop offset="0.5" stopColor="#B8860B" />
            <Stop offset="1" stopColor="#F8E08E" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tlsCardBg)" />
        {unit ? <Rect x={6 * unit} y={22 * unit} width={12 * unit} height={9 * unit} rx={1.6 * unit} fill="url(#tlsCardChip)" /> : null}
      </Svg>
      {unit ? (
        <>
          <Image source={MASCOT} style={[styles.pattern, { width: 66 * unit, height: 66 * unit, right: -14 * unit, top: -22 * unit }]} resizeMode="contain" />
          <View style={[styles.head, { left: 6 * unit, top: 5.5 * unit, gap: 2.4 * unit }]}>
            <Image source={MASCOT} style={{ width: 9 * unit, height: 9 * unit, tintColor: colors.gold }} resizeMode="contain" testID={`${testID}-logo`} />
            <View>
              <Body style={[styles.club, { fontSize: 3.1 * unit }]}>{clubName.toUpperCase()}</Body>
              <Body style={[styles.club, styles.clubSub, { fontSize: 3.1 * unit }]}>MITGLIED</Body>
            </View>
          </View>
          <View style={[styles.body, { left: 6 * unit, right: 34 * unit, bottom: 6 * unit }]}>
            <Body style={[styles.name, { fontSize: 6.2 * unit, lineHeight: 7 * unit }]} numberOfLines={2} testID={`${testID}-name`}>{name}</Body>
            {numberLine ? <Body style={[styles.number, { fontSize: 3.5 * unit }]}>{numberLine}</Body> : null}
            {meta ? <Muted style={[styles.meta, { fontSize: 2.9 * unit }]}>{meta}</Muted> : null}
          </View>
          {!reduce ? (
            <Animated.View pointerEvents="none" style={[styles.shine, { width: 40 * unit, transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-60 * unit, 160 * unit] }) }, { skewX: "-18deg" }] }]} testID={`${testID}-shine`} />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: CARD_RATIO,
    backgroundColor: "#0B0B0D",
    borderColor: "rgba(255, 215, 0, 0.32)",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    width: "100%",
  },
  pattern: {
    opacity: 0.06,
    position: "absolute",
  },
  head: {
    alignItems: "center",
    flexDirection: "row",
    position: "absolute",
  },
  club: {
    color: colors.white,
    fontWeight: "800",
    letterSpacing: 2,
  },
  clubSub: {
    opacity: 0.7,
  },
  body: {
    gap: 2,
    position: "absolute",
  },
  name: {
    color: colors.white,
    fontWeight: "900",
  },
  number: {
    color: colors.white,
    fontFamily: "monospace",
    letterSpacing: 1.5,
    opacity: 0.85,
  },
  meta: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  shine: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    bottom: 0,
    position: "absolute",
    top: 0,
  },
});
