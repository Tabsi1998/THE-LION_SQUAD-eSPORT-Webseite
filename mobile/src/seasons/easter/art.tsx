import React, { useState } from "react";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from "react-native-svg";
import type { EggPattern } from "./plan";

// Die Bilder der Osterzeit in der App (#645, #753, #756) - dieselben wie im Web (EggShape.jsx, easter/art.jsx):
// zwölf Eier-Muster in gedeckten Frühlingsfarben, Hasenohren auf einem Haarreif in Vereinsblau, die Ohren eines
// Feldhasen, ein Zitronenfalter (Flügel einzeln, damit sie schlagen können), Blumen und Gras.

export const PALETTES: Record<EggPattern, [string, string]> = {
  stripes: ["#e8b4b8", "#b5525c"],
  dots: ["#a8c5da", "#3f6e8c"],
  zigzag: ["#f2d49b", "#b07d2a"],
  waves: ["#b8d8c2", "#3f7d57"],
  checks: ["#d6c4e6", "#6f4c94"],
  stars: ["#1f2a44", "#e9c46a"],
  flowers: ["#f4c7d0", "#5f8f4a"],
  leaves: ["#d9e4b4", "#5f7a2e"],
  hearts: ["#f3d6c6", "#c0504d"],
  spiral: ["#bfe0e0", "#2f7f86"],
  diamonds: ["#e6d2b5", "#8a5a2b"],
  lion: ["#2a2118", "#ffd700"],
};

const EGG = "M15 1.5 C22.6 1.5 28.5 13 28.5 23.2 C28.5 32 22.6 37 15 37 C7.4 37 1.5 32 1.5 23.2 C1.5 13 7.4 1.5 15 1.5 Z";

function star(x: number, y: number, r: number): string {
  return `M${x} ${y - r * 1.6} L${x + r * 0.5} ${y - r * 0.5} L${x + r * 1.6} ${y - r * 0.4} L${x + r * 0.75} ${y + r * 0.35} L${x + r} ${y + r * 1.5} L${x} ${y + r * 0.85} L${x - r} ${y + r * 1.5} L${x - r * 0.75} ${y + r * 0.35} L${x - r * 1.6} ${y - r * 0.4} L${x - r * 0.5} ${y - r * 0.5} Z`;
}

function Pattern({ pattern, ink }: { pattern: EggPattern; ink: string }) {
  switch (pattern) {
    case "stripes":
      return <G fill={ink}><Rect x={0} y={12} width={30} height={3.2} /><Rect x={0} y={19} width={30} height={3.2} /><Rect x={0} y={26} width={30} height={3.2} /></G>;
    case "dots":
      return <G fill={ink}>{[[9, 11], [19, 9], [14, 17], [7, 22], [22, 21], [12, 28], [20, 30]].map(([x, y]) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.7} />)}</G>;
    case "zigzag":
      return <G fill="none" stroke={ink} strokeWidth={1.8} strokeLinejoin="round"><Path d="M0 16 L5 12 L10 16 L15 12 L20 16 L25 12 L30 16" /><Path d="M0 26 L5 22 L10 26 L15 22 L20 26 L25 22 L30 26" /></G>;
    case "waves":
      return <G fill="none" stroke={ink} strokeWidth={1.6} strokeLinecap="round"><Path d="M0 14 Q4 11 7.5 14 T15 14 T22.5 14 T30 14" /><Path d="M0 21 Q4 18 7.5 21 T15 21 T22.5 21 T30 21" /><Path d="M0 28 Q4 25 7.5 28 T15 28 T22.5 28 T30 28" /></G>;
    case "checks":
      return <G fill={ink}>{Array.from({ length: 10 }, (_, i) => <Rect key={i} x={i * 3} y={i % 2 ? 18 : 21} width={3} height={3} />)}<Rect x={0} y={17} width={30} height={0.8} /><Rect x={0} y={24.2} width={30} height={0.8} /></G>;
    case "stars":
      return <G fill={ink}>{[[10, 12, 1.8], [20, 16, 1.4], [8, 24, 1.3], [18, 27, 1.9], [23, 9, 1]].map(([x, y, r]) => <Path key={`${x}-${y}`} d={star(x, y, r)} />)}</G>;
    case "flowers":
      return <G>{[[10, 14], [20, 22], [11, 29]].map(([x, y]) => <G key={`${x}-${y}`} fill="#fffaf2" opacity={0.92}>{[0, 72, 144, 216, 288].map((a) => <Ellipse key={a} cx={x} cy={y - 2.1} rx={1.2} ry={2} transform={`rotate(${a} ${x} ${y})`} />)}<Circle cx={x} cy={y} r={1} fill={ink} /></G>)}</G>;
    case "leaves":
      return <G fill={ink}>{[[9, 13, -30], [20, 17, 25], [10, 24, 35], [21, 28, -20]].map(([x, y, a]) => <Path key={`${x}-${y}`} d={`M${x - 3} ${y} Q${x} ${y - 3} ${x + 3} ${y} Q${x} ${y + 3} ${x - 3} ${y} Z`} transform={`rotate(${a} ${x} ${y})`} />)}</G>;
    case "hearts":
      return <G fill={ink}>{[[10, 14], [20, 19], [12, 26], [21, 29]].map(([x, y]) => <Path key={`${x}-${y}`} d={`M${x} ${y + 2.2} C${x - 3.5} ${y - 0.3} ${x - 2} ${y - 3} ${x} ${y - 1.2} C${x + 2} ${y - 3} ${x + 3.5} ${y - 0.3} ${x} ${y + 2.2} Z`} />)}</G>;
    case "spiral":
      return <Path d="M15 21 m0 0 a1.5 1.5 0 1 1 1.5 1.5 a3 3 0 1 1 -3 -3 a4.5 4.5 0 1 1 4.5 4.5 a6 6 0 1 1 -6 -6 a7.5 7.5 0 1 1 7.5 7.5" fill="none" stroke={ink} strokeWidth={1.4} strokeLinecap="round" />;
    case "diamonds":
      return <G fill={ink}>{[4, 11, 18, 25].map((x) => <Path key={x} d={`M${x} 20 L${x + 2.8} 16.5 L${x + 5.6} 20 L${x + 2.8} 23.5 Z`} />)}<Rect x={0} y={13.5} width={30} height={0.9} /><Rect x={0} y={25.6} width={30} height={0.9} /></G>;
    case "lion":
      return <G fill={ink}><Ellipse cx={15} cy={24} rx={4.2} ry={3.6} /><Circle cx={10} cy={18.5} r={1.8} /><Circle cx={13.3} cy={16} r={1.8} /><Circle cx={16.7} cy={16} r={1.8} /><Circle cx={20} cy={18.5} r={1.8} /></G>;
    default:
      return null;
  }
}

let eggIds = 0;

/** Ein Osterei: Muster, Glanz, Rand. `size` ist die Breite. */
export function EggArt({ pattern, size = 16 }: { pattern: EggPattern; size?: number }) {
  const [clip] = useState(() => `tls-egg-${(eggIds += 1)}`);
  const [base, ink] = PALETTES[pattern] || PALETTES.stripes;
  return (
    <Svg width={size} height={size * (38 / 30)} viewBox="0 0 30 38" testID={`easter-egg-art-${pattern}`}>
      <Defs>
        <ClipPath id={clip}><Path d={EGG} /></ClipPath>
      </Defs>
      <Path d={EGG} fill={base} />
      <G clipPath={`url(#${clip})`}><Pattern pattern={pattern} ink={ink} /></G>
      <Ellipse cx={10.5} cy={10.5} rx={2.4} ry={4} transform="rotate(-22 10.5 10.5)" fill="#ffffff" opacity={0.42} />
      <Path d={EGG} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth={0.7} />
    </Svg>
  );
}

/** Hasenohren auf einem Haarreif: das linke steht, das rechte knickt an der Spitze um (wie im Web). */
export function BunnyEarsArt({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.3} viewBox="0 0 40 52">
      <Path d="M11 46 C7 34 5 18 9.5 7 C11 3.5 14.5 4 15.5 8 C17.5 18 18 33 17 46 Z" fill="#f4efe8" stroke="rgba(0,0,0,0.28)" strokeWidth={0.8} />
      <Path d="M12.3 42 C10.2 32 9.2 20 11.3 11 C12.2 8.8 13.7 9.1 14.2 11.5 C15.5 20 15.7 32 15.2 42 Z" fill="#f2b3c2" />
      <Path d="M23 46 C23 34 24 22 27.5 12 C29 8 33 7.5 34 10.5 C35 13 34.5 15.5 33 17 C31.5 24 29.5 35 29 46 Z" fill="#f4efe8" stroke="rgba(0,0,0,0.28)" strokeWidth={0.8} />
      <Path d="M24.8 42 C25 33 25.8 23 28.4 15 C29.4 12.6 31.2 12.4 31.6 14.4 C30.4 22 28.4 33 27.6 42 Z" fill="#f2b3c2" />
      <Path d="M31.4 10.2 C33.6 9.6 35.8 11.8 35.2 15.6 C34 14.2 32.7 13.5 31.2 13.7 Z" fill="#e2dbd0" />
      <Path d="M5.5 47.5 Q20 40.5 34.5 47.5" stroke="#29B6E8" strokeWidth={3.6} fill="none" strokeLinecap="round" />
      <Path d="M8 46.2 Q20 41 32 46.2" stroke="#7fd6f5" strokeWidth={1} fill="none" strokeLinecap="round" opacity={0.7} />
    </Svg>
  );
}

/** Die Ohren eines Feldhasen (graubraun) - für den kurzen Blick hinter einer Karte hervor. */
export function HareEarsArt({ width = 24 }: { width?: number }) {
  return (
    <Svg width={width} height={width * 1.15} viewBox="0 0 26 30">
      <Path d="M6 30 C3.5 22 3 12 5.6 4 C6.6 1.4 9 1.6 9.6 4.4 C10.8 12 11 22 10.4 30 Z" fill="#b9a58f" stroke="rgba(0,0,0,0.35)" strokeWidth={0.7} />
      <Path d="M6.9 28 C5.4 21 5.2 13 6.6 6.6 C7.1 5.2 8.2 5.4 8.5 6.9 C9.3 13 9.4 21 9 28 Z" fill="#e3c4ae" />
      <Path d="M5 4.5 C5.8 2 8.6 1.8 9.4 4" stroke="#3d342b" strokeWidth={1.1} fill="none" strokeLinecap="round" />
      <Path d="M15.6 30 C15.6 22 16.8 12 19.6 5 C20.8 2.4 23.2 2.8 23.4 5.6 C23.2 13 21.4 22 20.2 30 Z" fill="#b9a58f" stroke="rgba(0,0,0,0.35)" strokeWidth={0.7} />
      <Path d="M16.8 28 C17.2 21 18.2 14 20.2 7.6 C20.8 6.4 21.9 6.6 21.9 8 C21.4 14 20.2 21 19.2 28 Z" fill="#e3c4ae" />
      <Path d="M19.3 5.2 C20.4 2.6 23 2.6 23.4 5.2" stroke="#3d342b" strokeWidth={1.1} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** Ein Flügelpaar des Zitronenfalters (eine Seite) - `side` spiegelt es. */
export function ButterflyWing({ size = 13, side }: { size?: number; side: "left" | "right" }) {
  return (
    <Svg width={size} height={size * 1.6} viewBox="0 0 15 24" style={side === "right" ? { transform: [{ scaleX: -1 }] } : undefined}>
      <Path d="M14.6 11 C10 2 2.5 1 1.5 5.5 C0.8 9 5 12 14.2 12.4 Z" fill="#f6dd6a" stroke="#c9a72c" strokeWidth={0.6} />
      <Path d="M14.4 12.8 C8 13.4 3.8 16.2 5.6 19.6 C7.2 22.4 11.6 19.4 14.6 13.8 Z" fill="#efcf52" stroke="#c9a72c" strokeWidth={0.6} />
      <Circle cx={7.4} cy={7.6} r={1} fill="#e08a2e" />
    </Svg>
  );
}

const FLOWER_COLORS: Record<string, [string, string]> = { daisy: ["#fffaf2", "#f2c14e"], tulip: ["#e98aa3", "#b3546f"], crocus: ["#b9a3e3", "#7b5cb8"], primrose: ["#f6e27a", "#e3a63a"] };

/** Eine Blume auf einem Stiel - `height` ist die ganze Höhe. */
export function FlowerArt({ kind = "daisy", height = 16 }: { kind?: string; height?: number }) {
  const [petal, heart] = FLOWER_COLORS[kind] || FLOWER_COLORS.daisy;
  return (
    <Svg width={Math.round(14 * (height / 24))} height={height} viewBox="0 0 14 24">
      <Path d="M7 24 C7 18 6.4 13 7 8.5" stroke="#5f8f4a" strokeWidth={1.3} fill="none" strokeLinecap="round" />
      {kind === "tulip" ? (
        <Path d="M3.6 4.2 L5.2 6.6 L7 3.2 L8.8 6.6 L10.4 4.2 C11 8.4 9.6 10.6 7 10.6 C4.4 10.6 3 8.4 3.6 4.2 Z" fill={petal} stroke={heart} strokeWidth={0.6} />
      ) : (
        <G>
          {[0, 60, 120, 180, 240, 300].map((angle) => <Ellipse key={angle} cx={7} cy={3.6} rx={1.5} ry={2.6} fill={petal} transform={`rotate(${angle} 7 6.6)`} />)}
          <Circle cx={7} cy={6.6} r={1.7} fill={heart} />
        </G>
      )}
    </Svg>
  );
}

/** Ein Grasstreifen: Halme über die ganze Breite, unten gerade. */
export function GrassStrip({ width, height = 8 }: { width: number; height?: number }) {
  const blades = Math.max(3, Math.round(width / 4));
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {Array.from({ length: blades }, (_, i) => {
        const x = (i + 0.5) * (width / blades);
        const lean = (i % 2 ? 1 : -1) * (1 + (i % 3) * 0.5);
        const top = 1 + ((i * 7) % 4);
        return <Path key={i} d={`M${x.toFixed(1)} ${height} Q${(x + lean * 0.4).toFixed(1)} ${(height + top) / 2} ${(x + lean).toFixed(1)} ${top}`} stroke={i % 2 ? "#6f9e4f" : "#5f8f4a"} strokeWidth={1.1} fill="none" strokeLinecap="round" />;
      })}
    </Svg>
  );
}
