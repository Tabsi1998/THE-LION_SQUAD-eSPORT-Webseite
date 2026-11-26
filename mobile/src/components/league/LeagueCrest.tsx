import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { crestTier } from "../../lib/leagueMoments";

// Das Liga-Wappen in der App (#2584, Web: components/tls/league/LeagueBadge.jsx und leagueBadge.css, #1638): dieselben Formen und Farben.
// Die Stufe zeigt sich über die Form - Liga 1 mit Krone und doppeltem Rand, Liga 2 mit doppeltem Rand, ab Liga 3 schlicht (nur Kontur).
// Cyan ist die Markenfarbe, Gold nur für den Season-Meister; der Saisonende-Moment zeigt den Abstieg in ruhigem Grau-Blau (F.8).
// Hier nur die Zeichnung - die Bewegung des Moments steht in SeasonMoment.tsx.

export type CrestMetal = "cyan" | "gold" | "calm";
export type CrestTier = "top" | "mid" | "base";

export const CREST_METALS: Record<CrestMetal, { light: string; base: string; dark: string }> = {
  cyan: { light: "#B8ECFF", base: "#29B6E8", dark: "#0E5C7A" },
  gold: { light: "#FFF2A8", base: "#FFD700", dark: "#8A6A12" },
  calm: { light: "#D5DDE7", base: "#94A3B8", dark: "#475569" },
};

export const SHIELD = "M10 20h44v24c0 17-10 27-22 33C20 71 10 61 10 44z";
const FIELD = "M15.5 25.5h33v18.5c0 12.6-7.4 20.4-16.5 25.4-9.1-5-16.5-12.8-16.5-25.4z";
const RIM = "M13 23h38v21c0 15-9 24-19 29.6C22 68 13 59 13 44z";
const CROWN = "M21 18.5L18.6 8l6.6 4.6L32 5l6.8 7.6L45.4 8 43 18.5z";
/** Das Feld des Wappens im Raster 64 × 80 - dort steht die Zahl. */
export const FIELD_BOX = { x: 15.5, y: 25.5, width: 33, height: 44 };

function Metal({ id, metal }: { id: string; metal: CrestMetal }) {
  const paint = CREST_METALS[metal];
  return (
    <LinearGradient id={id} x1="0" x2="1" y1="0" y2="1">
      <Stop offset="0" stopColor={paint.dark} />
      <Stop offset="0.42" stopColor={paint.light} />
      <Stop offset="0.62" stopColor={paint.base} />
      <Stop offset="1" stopColor={paint.dark} />
    </LinearGradient>
  );
}

/** Die Form des Wappens - ohne Zahl und Krone, im Raster 64 × 80. */
export function ShieldArt({ tier, metal, size, id }: { tier: CrestTier; metal: CrestMetal; size: number; id: string }) {
  const paint = CREST_METALS[metal];
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 64 80">
      <Defs><Metal id={`${id}-metal`} metal={metal} /></Defs>
      {tier === "base" ? (
        // Ab Liga 3 schlicht: nur die Kontur im Metall, keine Fläche, kein zweiter Rand.
        <Path d={SHIELD} fill="#0D0D0D" stroke={paint.base} strokeWidth={2.4} strokeLinejoin="round" />
      ) : (
        <G>
          <Path d={SHIELD} fill={`url(#${id}-metal)`} />
          <Path d={FIELD} fill="#0A0A0A" opacity={0.82} />
          <Path d={RIM} fill="none" stroke={paint.light} strokeWidth={0.9} opacity={tier === "top" ? 0.75 : 0.5} />
        </G>
      )}
    </Svg>
  );
}

/** Die Krone der Liga 1 - im selben Raster wie das Wappen, damit sie genau darauf sitzt. */
export function CrownArt({ metal, size, id }: { metal: CrestMetal; size: number; id: string }) {
  const paint = CREST_METALS[metal];
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 64 80">
      <Defs><Metal id={`${id}-crown`} metal={metal} /></Defs>
      <Path d={CROWN} fill={`url(#${id}-crown)`} stroke={paint.dark} strokeWidth={0.6} strokeLinejoin="round" />
      <Rect x={20.6} y={17} width={22.8} height={3} rx={1} fill={paint.base} />
      <Path d="M18.6 6.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3zM32 3.3a1.7 1.7 0 1 1 0 3.4a1.7 1.7 0 1 1 0-3.4zM45.4 6.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z" fill={paint.light} />
    </Svg>
  );
}

/** Der goldene Pokal des Meisters (Web: TrophyCup in TrophyShelf.jsx), im Raster 64 × 72. */
export function CupArt({ width, id }: { width: number; id: string }) {
  const paint = CREST_METALS.gold;
  return (
    <Svg width={width} height={width * (72 / 64)} viewBox="0 0 64 72">
      <Defs>
        <LinearGradient id={`${id}-cup`} x1="0" x2="1" y1="0" y2="0">
          <Stop offset="0" stopColor={paint.dark} />
          <Stop offset="0.42" stopColor={paint.light} />
          <Stop offset="0.6" stopColor={paint.base} />
          <Stop offset="1" stopColor={paint.dark} />
        </LinearGradient>
      </Defs>
      <Path d="M16 10h-7c0 9 4.5 13.5 10 14.5M48 10h7c0 9-4.5 13.5-10 14.5" fill="none" stroke={paint.base} strokeWidth={3} strokeLinecap="round" />
      <Path d="M16 6h32v16a16 16 0 0 1-32 0z" fill={`url(#${id}-cup)`} />
      <Rect x={29} y={38} width={6} height={12} fill={paint.dark} />
      <Rect x={21} y={50} width={22} height={7} rx={1.5} fill={`url(#${id}-cup)`} />
      <Rect x={16} y={57} width={32} height={8} rx={1.5} fill={paint.dark} />
    </Svg>
  );
}

/** Die Zahl im Feld des Wappens - eine Stelle groß, zwei Stellen kleiner (wie im Web 23 bzw. 17 im Raster). */
export function crestNumberSize(level: number | string | null | undefined, size: number): number {
  return (String(level ?? "").length > 1 ? 17 : 23) * (size / 64);
}

/**
 * Das Liga-Abzeichen ohne Bewegung - für den Hinweis „Saisonende“ an Profil und Team. Es ist Zier: Liga N steht als Text daneben, darum
 * schweigt es für Screenreader. Ohne gültige Liga N zeichnet es nichts.
 */
export function CrestBadge({ badge, size = 36, metal, testID }: { badge?: { level?: number | null; champion?: boolean } | null; size?: number; metal?: CrestMetal; testID?: string }) {
  const tier = crestTier(badge?.level);
  if (!tier) return null;
  const tone: CrestMetal = metal || (badge?.champion ? "gold" : "cyan");
  const paint = CREST_METALS[tone];
  const id = `badge-${tier}-${tone}-${badge?.level}`;
  return (
    <View style={{ width: size, height: size * 1.25 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={testID}>
      <ShieldArt tier={tier} metal={tone} size={size} id={id} />
      <View style={[styles.field, { left: FIELD_BOX.x * (size / 64), top: FIELD_BOX.y * (size / 64), width: FIELD_BOX.width * (size / 64), height: FIELD_BOX.height * (size / 64) }]}>
        <Text allowFontScaling={false} style={[styles.number, { color: tier === "base" ? paint.base : paint.light, fontSize: crestNumberSize(badge?.level, size), lineHeight: crestNumberSize(badge?.level, size) * 1.15 }]}>
          {String(badge?.level)}
        </Text>
      </View>
      {tier === "top" ? <View style={StyleSheet.absoluteFill}><CrownArt metal={tone} size={size} id={id} /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { alignItems: "center", justifyContent: "center", overflow: "hidden", position: "absolute" },
  number: { fontWeight: "900", includeFontPadding: false, letterSpacing: -0.4, textAlign: "center" },
});
