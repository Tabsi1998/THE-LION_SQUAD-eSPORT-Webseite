import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { MOTION, motionEasing } from "../../lib/motion";
import type { PathTile } from "../../lib/references";
import { colors, roles, surfaces } from "../../theme";
import { useReduceMotion } from "../FadeIn";
import { Body, Muted } from "../Text";

// Bausteine der Referenzen in der App (#1945, Entwurf „Referenzen Neugestaltung“ vom 21.10.2026, wie im Web #1878):
// Platz-Ring (Gold, Silber, Bronze nur als Ring und Schrift), Medaillen-Zeichen, Abschnittskopf, Filter-Chip, der
// Liga-Weg zum Wischen und das Aufklappen einer Zeile. Bewegung nur als Hinweis auf einen Zustand und kurz; mit
// „Bewegung reduzieren“ steht alles sofort da.

export const ink = {
  text: "#F4F4F5",
  soft: "#E4E4E7",
  second: "#C8C8CF",
  muted: colors.muted,
  quiet: roles.quiet,
  line: "rgba(255,255,255,0.08)",
  rowLine: "rgba(255,255,255,0.07)",
  cardLine: "rgba(255,255,255,0.09)",
};

const MEDAL_TONES: Record<number, { ring: string; fg: string; bg: string; label: string }> = {
  1: { ring: roles.honor, fg: roles.honor, bg: "rgba(255,215,0,0.1)", label: "Gold" },
  2: { ring: roles.silver, fg: "#E2E5EA", bg: "rgba(201,206,214,0.1)", label: "Silber" },
  3: { ring: roles.bronze, fg: "#E7A774", bg: "rgba(208,138,78,0.1)", label: "Bronze" },
};

export function medalTone(placement: number | null | undefined) {
  return placement ? MEDAL_TONES[placement] || null : null;
}

/** Die Platzierung im Ring: Ring und Zahl in Medaillenfarbe (1–3), sonst neutral; ohne Platz „–“. */
export function PlaceRing({ placement, size = 40, testID }: { placement: number | null | undefined; size?: number; testID?: string }) {
  const tone = medalTone(placement);
  return (
    <View
      style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderWidth: size >= 52 ? 3 : 2 }, tone ? { borderColor: tone.ring, backgroundColor: tone.bg } : null]}
      accessibilityLabel={placement ? `${placement}. Platz` : "ohne Platz"}
      testID={testID}
    >
      <Body style={[styles.ringText, { fontSize: Math.round(size * 0.45), lineHeight: Math.round(size * 0.56) }, tone ? { color: tone.fg } : null]}>{placement ? `${placement}.` : "–"}</Body>
    </View>
  );
}

/** Ring mit Pokal für die Ehrentafel - in der Farbe der Medaille. */
export function MedalMark({ placement, size = 26 }: { placement: number; size?: number }) {
  const color = medalTone(placement)?.ring || ink.muted;
  return (
    <Svg width={size} height={size} viewBox="0 0 34 34" fill="none">
      <Circle cx={17} cy={17} r={15} stroke={color} strokeWidth={2.5} />
      <Path d="M12 13h10l-1.5 9h-7z" fill={color} opacity={0.9} />
    </Svg>
  );
}

/** Kleine Zeile über einem Abschnitt („Vitrine“, „Läuft gerade“) - Gold für Ehre, sonst grau; optional mit Puls. */
export function SectionLabel({ children, tone = "muted", pulse = false }: { children: string; tone?: "muted" | "honor"; pulse?: boolean }) {
  return (
    <View style={styles.sectionRow} accessibilityRole="header">
      {pulse ? <PulseDot /> : null}
      <Muted style={[styles.sectionLabel, tone === "honor" && { color: roles.honor }]}>{children}</Muted>
    </View>
  );
}

/** Goldener Punkt mit leisem Puls (heute steht etwas an) - ohne Bewegung mit „Bewegung reduzieren“. */
export function PulseDot() {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 2000, easing: motionEasing, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  return (
    <View style={styles.pulseWrap} testID="reference-pulse">
      <Animated.View style={[styles.pulseHalo, { opacity: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 3, 3] }) }] }]} />
      <View style={styles.pulseDot} />
    </View>
  );
}

/** Filter-Chip (Spiel, Wertung): gewählt mit Cyan-Rand und Hauch, sonst leise. */
export function FilterChip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && styles.pressed]}
      testID={testID}
    >
      <Body style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Body>
    </Pressable>
  );
}

const TILE_TONES: Record<PathTile["tone"], { fg: string; border: string; bg: string }> = {
  up: { fg: roles.ok, border: "rgba(31,208,142,0.38)", bg: surfaces.s2 },
  honor: { fg: roles.honor, border: "rgba(255,215,0,0.38)", bg: surfaces.s2 },
  current: { fg: colors.cyan, border: "rgba(41,182,232,0.45)", bg: "rgba(41,182,232,0.08)" },
  plain: { fg: ink.muted, border: "rgba(255,255,255,0.1)", bg: surfaces.s2 },
};

/** Der Liga-Weg zum Wischen: je Saison eine Kachel mit Saison, Stufe und Platz samt Vermerk. */
export function PathStrip({ tiles, compact = false, testID }: { tiles: PathTile[]; compact?: boolean; testID?: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} accessibilityLabel="Liga-Weg" testID={testID}>
      {tiles.map((tile) => {
        const tone = TILE_TONES[tile.tone];
        return (
          <View
            key={tile.key}
            style={[styles.tile, compact && styles.tileCompact, { borderColor: tone.border, backgroundColor: tone.bg }]}
            accessible
            accessibilityLabel={`${tile.season}, ${tile.tier}, ${tile.result}`}
            testID="reference-path-tile"
          >
            <Muted style={styles.tileSeason}>{tile.season}</Muted>
            <Body style={[styles.tileTier, compact && styles.tileTierCompact]}>{tile.tier}</Body>
            <Muted style={[styles.tileResult, { color: tone.fg }]}>{tile.result}</Muted>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** Pfeil, der beim Aufklappen umklappt (200 ms, Ende weich) - mit „Bewegung reduzieren“ ohne Drehung dazwischen. */
export function Chevron({ open }: { open: boolean }) {
  const reduce = useReduceMotion();
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) {
      turn.setValue(open ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(turn, { toValue: open ? 1 : 0, duration: 200, easing: motionEasing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [open, reduce, turn]);
  return (
    <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }) }] }}>
      <Ionicons name="chevron-down" color={colors.cyan} size={18} />
    </Animated.View>
  );
}

/**
 * Aufgeklappter Inhalt: blendet aus 4 Punkten darüber ein (240 ms) - mit „Bewegung reduzieren“ sofort. `trigger` spielt
 * das Einblenden erneut ab, ohne den Inhalt neu aufzubauen (ein geladener Turnierweg bleibt geladen).
 */
export function Reveal({ children, style, trigger, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; trigger?: unknown; testID?: string }) {
  const reduce = useReduceMotion();
  const value = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) {
      value.setValue(1);
      return undefined;
    }
    value.setValue(0);
    const animation = Animated.timing(value, { toValue: 1, duration: MOTION.mid, easing: motionEasing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [reduce, trigger, value]);
  return (
    <Animated.View testID={testID} style={[style, { opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Der Balken „Läuft gerade“: füllt sich einmal von links (900 ms, wie im Entwurf) - mit „Bewegung reduzieren“ sofort. */
export function ProgressFill({ share, label }: { share: number; label: string }) {
  const reduce = useReduceMotion();
  const fill = useRef(new Animated.Value(0)).current;
  const target = Math.max(0, Math.min(1, share));
  useEffect(() => {
    if (reduce) {
      fill.setValue(target);
      return undefined;
    }
    const animation = Animated.timing(fill, { toValue: target, duration: 900, easing: motionEasing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [fill, reduce, target]);
  return (
    <View style={styles.bar} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}>
      <Animated.View style={[styles.barFill, { transform: [{ scaleX: fill }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: "center", borderColor: "rgba(255,255,255,0.28)", flexShrink: 0, justifyContent: "center" },
  ringText: { color: ink.text, fontVariant: ["tabular-nums"], fontWeight: "800" },
  sectionRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  sectionLabel: { color: ink.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2.4, textTransform: "uppercase" },
  pulseWrap: { alignItems: "center", height: 8, justifyContent: "center", width: 8 },
  pulseHalo: { backgroundColor: roles.honor, borderRadius: 4, height: 8, position: "absolute", width: 8 },
  pulseDot: { backgroundColor: roles.honor, borderRadius: 4, height: 8, width: 8 },
  chip: { borderColor: "rgba(255,255,255,0.14)", borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 14 },
  chipOn: { backgroundColor: "rgba(41,182,232,0.14)", borderColor: colors.cyan },
  chipText: { color: ink.second, fontSize: 14, fontWeight: "600" },
  chipTextOn: { color: ink.text, fontWeight: "700" },
  pressed: { opacity: 0.72 },
  strip: { gap: 8, paddingBottom: 4, paddingRight: 4 },
  tile: { borderRadius: 8, borderWidth: 1, gap: 1, minWidth: 112, paddingHorizontal: 12, paddingVertical: 10 },
  tileCompact: { borderRadius: 6, minWidth: 0, paddingHorizontal: 10, paddingVertical: 6 },
  tileSeason: { color: ink.quiet, fontSize: 11, lineHeight: 15 },
  tileTier: { color: ink.text, fontSize: 14, fontWeight: "700", lineHeight: 19 },
  tileTierCompact: { fontSize: 13, lineHeight: 18 },
  tileResult: { fontSize: 12, fontWeight: "700", lineHeight: 16 },
  bar: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 99, height: 4, overflow: "hidden" },
  barFill: { backgroundColor: colors.cyan, height: "100%", transformOrigin: "left", width: "100%" },
});
