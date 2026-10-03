import React, { useId } from "react";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { MOTIFS, type MotifPart } from "./badgeArt.generated";
import { type Look, lookFor, rankNotches, resolveArt } from "./badgeArt";

// Erfolge II (E13, #623): das Abzeichen in der App - dasselbe runde Emblem wie im Web (Badge.jsx): neun
// Materialien, das Motiv der Gruppe als Relief, Rand mit Rang-Kerben, Legendär mit Löwenkopf, Geheim mit
// Fragezeichen; nicht erreichte Stufen als Silhouette mit Fortschrittsring. Das Relief entsteht ohne
// SVG-Filter (in der App nicht verlässlich) aus einer versetzten Schatten- und Lichtkopie des Motivs.

export const BADGE_SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 96, hero: 160 } as const;
export type BadgeSize = keyof typeof BADGE_SIZES | number;
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII"];
// Motiv ohne eigenes Bild (z. B. eine im Admin angelegte Gruppe ohne Motiv): ein Pokal.
const FALLBACK_MOTIF = "champion";

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [sx, sy] = polar(cx, cy, r, from);
  const [ex, ey] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

function MotifParts({ parts }: { parts: MotifPart[] }) {
  return (
    <>
      {parts.map(([tag, attrs], i) => {
        if (tag === "circle") return <Circle key={i} {...attrs} />;
        if (tag === "rect") return <Rect key={i} {...attrs} />;
        if (tag === "ellipse") return <Ellipse key={i} {...attrs} />;
        return <Path key={i} {...(attrs as { d: string })} />;
      })}
    </>
  );
}

/** Ein Motiv im 64er-Raster, an (x, y) in der Größe size - Striche in der Farbe „color“. */
export function Motif({ art, x = 0, y = 0, size = 64, color }: { art: string; x?: number; y?: number; size?: number; color: string }) {
  const key = resolveArt(art);
  if (!key) return null;
  return (
    <G transform={`translate(${x} ${y}) scale(${size / 64})`} color={color} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
      <MotifParts parts={MOTIFS[key]} />
    </G>
  );
}

/** Die Kerben als ein Pfad (ein Strich je Rang) - in Listen spart das bis zu sieben SVG-Knoten je Abzeichen. */
export function notchPath(count: number): string {
  if (!count) return "";
  const spread = Math.min(120, 22 * (count - 1));
  const start = -spread / 2;
  return Array.from({ length: count }, (_, i) => {
    const deg = start + (count === 1 ? 0 : (spread / (count - 1)) * i);
    const [x1, y1] = polar(50, 50, 40.5, deg);
    const [x2, y2] = polar(50, 50, 46.5, deg);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }).join(" ");
}

function Notches({ count, color }: { count: number; color: string }) {
  if (!count) return null;
  return <Path d={notchPath(count)} stroke={color} strokeWidth={2.4} strokeLinecap="round" fill="none" testID="badge-notches" />;
}

const BRUSHED = Array.from({ length: 14 }, (_, i) => `M 6 ${(14 + i * 5.4).toFixed(1)} L 94 ${(14 + i * 5.4).toFixed(1)}`).join(" ");

function LionCrest({ color, accent }: { color: string; accent: string }) {
  return (
    <G transform="translate(50 9.5) scale(0.62)" testID="badge-lion-crest">
      <Path d="M-11 -2 C-13 -9 -8 -12 -4 -9 C-2 -12 2 -12 4 -9 C8 -12 13 -9 11 -2 C13 3 10 8 6 9 L-6 9 C-10 8 -13 3 -11 -2 Z" fill={color} />
      <Path d="M-6 -3 C-4 -5 -1 -5 0 -3 C1 -5 4 -5 6 -3" stroke={accent} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Path d="M-4 3 L0 6 L4 3" stroke={accent} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={-3.2} cy={-0.5} r={1.1} fill={accent} />
      <Circle cx={3.2} cy={-0.5} r={1.1} fill={accent} />
    </G>
  );
}

function Texture({ look, clip }: { look: Look; clip: string }) {
  if (look.texture === "grain") {
    return (
      <G clipPath={clip} stroke={look.dark} strokeWidth={1.1} fill="none" opacity={0.45}>
        <Path d="M8 34 C 30 26, 60 26, 92 36" />
        <Path d="M6 46 C 34 40, 66 40, 94 48" />
        <Path d="M8 60 C 30 54, 70 56, 92 62" />
        <Path d="M14 72 C 40 66, 62 70, 86 74" />
        <Path d="M20 22 C 40 18, 60 18, 80 22" />
      </G>
    );
  }
  if (look.texture === "brushed") {
    return <Path clipPath={clip} d={BRUSHED} stroke={look.light} strokeWidth={0.7} fill="none" opacity={0.28} />;
  }
  if (look.texture === "ice") {
    return (
      <G clipPath={clip} stroke={look.light} strokeWidth={1.2} strokeLinecap="round" opacity={0.5}>
        <Path d="M22 26 l6 0 M25 23 l0 6 M23 24 l4 4 M27 24 l-4 4" />
        <Path d="M74 66 l6 0 M77 63 l0 6 M75 64 l4 4 M79 64 l-4 4" />
        <Path d="M70 24 l4 0 M72 22 l0 4" />
        <Path d="M26 72 l4 0 M28 70 l0 4" />
      </G>
    );
  }
  if (look.texture === "facets") {
    return (
      <G clipPath={clip} fill={look.light} opacity={0.16}>
        <Polygon points="50,14 72,30 50,50" />
        <Polygon points="50,14 28,30 50,50" opacity={0.5} />
        <Polygon points="72,30 86,50 50,50" opacity={0.7} />
        <Polygon points="28,30 14,50 50,50" opacity={0.3} />
        <Polygon points="14,50 28,70 50,50" opacity={0.6} />
        <Polygon points="86,50 72,70 50,50" opacity={0.4} />
        <Polygon points="28,70 50,86 50,50" opacity={0.35} />
        <Polygon points="72,70 50,86 50,50" opacity={0.55} />
      </G>
    );
  }
  if (look.texture === "veil") {
    return (
      <G clipPath={clip} fill={look.dark} opacity={0.55}>
        <Path d="M0 62 C 20 50, 40 74, 60 60 S 90 52, 100 64 L100 100 L0 100 Z" />
      </G>
    );
  }
  return null;
}

export type BadgeProps = {
  material?: string | null;
  level?: number | null;
  rank?: number | null;
  art?: string | null;
  icon?: string | null;
  earned?: boolean;
  percent?: number;
  size?: BadgeSize;
  negative?: boolean;
  title?: string;
  testID?: string;
};

// memo: in langen Listen zeichnet ein Abzeichen nur neu, wenn sich seine Angaben ändern.
export const Badge = React.memo(function Badge({ material, level, rank, art, icon, earned = true, percent = 0, size = "md", negative = false, title, testID }: BadgeProps) {
  // IDs für Verläufe und Ausschnitt: nur Buchstaben und Ziffern (react-native-svg sucht sie per url(#…)).
  const id = `b${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const look = lookFor(material, level, { negative });
  const px = typeof size === "number" ? size : BADGE_SIZES[size] || BADGE_SIZES.md;
  const notches = rankNotches(rank, look.key);
  const locked = !earned;
  const progress = Math.max(0, Math.min(100, Number(percent || 0)));
  const motif = resolveArt(art) || resolveArt(icon) || FALLBACK_MOTIF;
  const ink = locked ? "rgba(255,255,255,0.28)" : look.ink;
  const clip = `url(#${id}-disc)`;
  const relief = !locked && px >= 64;
  const label = title || `${look.name}${notches ? ` ${ROMAN[notches]}` : ""}${locked ? ", noch nicht erreicht" : ""}`;

  return (
    <Svg viewBox="0 0 100 100" width={px} height={px} accessibilityRole="image" accessibilityLabel={label} testID={testID}>
      {/* Gesperrt: flache Grautöne statt Verläufen - in langen Listen sind die meisten gesperrt, das spart Knoten. */}
      {!locked && (
        <Defs>
          <RadialGradient id={`${id}-disc-fill`} cx="38%" cy="32%" r="75%">
            <Stop offset="0%" stopColor={look.light} stopOpacity={0.95} />
            <Stop offset="45%" stopColor={look.base} />
            <Stop offset="100%" stopColor={look.dark} />
          </RadialGradient>
          <LinearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={look.light} />
            <Stop offset="50%" stopColor={look.rim} />
            <Stop offset="100%" stopColor={look.dark} />
          </LinearGradient>
          <ClipPath id={`${id}-disc`}><Circle cx={50} cy={50} r={38} /></ClipPath>
        </Defs>
      )}

      {!locked && <Circle cx={50} cy={50} r={46} fill={look.glow} opacity={0.12} />}
      <Circle cx={50} cy={50} r={46} fill={locked ? "#26262B" : `url(#${id}-rim)`} stroke={locked ? "rgba(255,255,255,0.12)" : look.dark} strokeWidth={1} />
      {locked && <Circle cx={50} cy={50} r={43} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={1} strokeDasharray="3 3" />}

      <Circle cx={50} cy={50} r={38} fill={locked ? "#18181C" : `url(#${id}-disc-fill)`} />
      {!locked && <Texture look={look} clip={clip} />}
      {!locked && <Circle cx={50} cy={50} r={38} fill="none" stroke={look.light} strokeOpacity={0.35} strokeWidth={1} />}
      {!locked && <Circle cx={50} cy={50} r={35} fill="none" stroke={look.dark} strokeOpacity={0.5} strokeWidth={0.8} />}

      {/* Motiv als Relief: Schatten unten rechts, Licht oben links, darüber das Motiv - erst ab 64 px, darunter
          wäre der Versatz kleiner als ein halbes Pixel und kostete in langen Listen nur Knoten. */}
      {relief && (
        <G opacity={0.85} transform="translate(0.9 1.1)">
          <Motif art={motif} x={26} y={26} size={48} color={look.dark} />
        </G>
      )}
      {relief && (
        <G opacity={0.45} transform="translate(-0.7 -0.8)">
          <Motif art={motif} x={26} y={26} size={48} color="#FFFFFF" />
        </G>
      )}
      <G testID="badge-motif">
        <Motif art={motif} x={26} y={26} size={48} color={ink} />
      </G>

      {!locked && look.motion === "flame" && (
        <G fill={look.accent || look.light} opacity={0.85}>
          <Path d="M18 74 c-2 -6 1 -9 3 -12 c0 4 3 5 3 9 c2 -3 1 -6 1 -8 c4 4 4 10 -1 13 c-3 2 -5 1 -6 -2z" />
          <Path d="M79 72 c-2 -6 1 -9 3 -12 c0 4 3 5 3 9 c2 -3 1 -6 1 -8 c4 4 4 10 -1 13 c-3 2 -5 1 -6 -2z" />
        </G>
      )}
      {!locked && look.motion === "turn" && (
        <SvgText x={72} y={30} fontSize={14} fontWeight="700" fill={look.light} textAnchor="middle">?</SvgText>
      )}

      <Notches count={notches} color={locked ? "rgba(255,255,255,0.22)" : look.ink} />
      {!locked && look.key === "legendary" && <LionCrest color={look.dark} accent={look.accent || look.light} />}

      {locked && progress > 0 && (
        <Path testID="badge-progress" d={arcPath(50, 50, 43, 0, Math.max(2, (progress / 100) * 359.9))} fill="none" stroke={look.rim} strokeWidth={2.6} strokeLinecap="round" opacity={0.9} />
      )}
    </Svg>
  );
});
