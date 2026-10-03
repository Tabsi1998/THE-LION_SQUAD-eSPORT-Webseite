import { useId } from "react";

// Ostereier mit eigener Persönlichkeit (#755 E3): zwölf Muster in gedeckten Frühlingsfarben, ein weicher Glanz oben
// links, unten ein paar Grashalme, in denen das Ei halb steckt (in den unteren Ecken - oben liegt es frei). Dieselben
// Muster zeigt der Korb auf /ostern und die App.

export const PALETTES = {
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
export const PATTERN_NAMES = Object.keys(PALETTES);
/** Wie die Verwaltung die Muster nennt. */
export const PATTERN_LABELS = {
  stripes: "Streifen", dots: "Punkte", zigzag: "Zickzack", waves: "Wellen", checks: "Karos", stars: "Sterne",
  flowers: "Blüten", leaves: "Blätter", hearts: "Herzen", spiral: "Spirale", diamonds: "Rauten", lion: "Löwenpfote",
};

const EGG = "M15 1.5 C22.6 1.5 28.5 13 28.5 23.2 C28.5 32 22.6 37 15 37 C7.4 37 1.5 32 1.5 23.2 C1.5 13 7.4 1.5 15 1.5 Z";

function Pattern({ pattern, ink }) {
  switch (pattern) {
    case "stripes":
      return <g fill={ink}><rect x="0" y="12" width="30" height="3.2" /><rect x="0" y="19" width="30" height="3.2" /><rect x="0" y="26" width="30" height="3.2" /></g>;
    case "dots":
      return <g fill={ink}>{[[9, 11], [19, 9], [14, 17], [7, 22], [22, 21], [12, 28], [20, 30]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />)}</g>;
    case "zigzag":
      return <g fill="none" stroke={ink} strokeWidth="1.8" strokeLinejoin="round"><path d="M0 16 L5 12 L10 16 L15 12 L20 16 L25 12 L30 16" /><path d="M0 26 L5 22 L10 26 L15 22 L20 26 L25 22 L30 26" /></g>;
    case "waves":
      return <g fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round"><path d="M0 14 Q4 11 7.5 14 T15 14 T22.5 14 T30 14" /><path d="M0 21 Q4 18 7.5 21 T15 21 T22.5 21 T30 21" /><path d="M0 28 Q4 25 7.5 28 T15 28 T22.5 28 T30 28" /></g>;
    case "checks":
      return <g fill={ink}>{Array.from({ length: 10 }, (_, i) => <rect key={i} x={i * 3} y={i % 2 ? 18 : 21} width="3" height="3" />)}<rect x="0" y="17" width="30" height="0.8" /><rect x="0" y="24.2" width="30" height="0.8" /></g>;
    case "stars":
      return <g fill={ink}>{[[10, 12, 1.8], [20, 16, 1.4], [8, 24, 1.3], [18, 27, 1.9], [23, 9, 1]].map(([x, y, r]) => <path key={`${x}-${y}`} d={`M${x} ${y - r * 1.6} L${x + r * 0.5} ${y - r * 0.5} L${x + r * 1.6} ${y - r * 0.4} L${x + r * 0.75} ${y + r * 0.35} L${x + r} ${y + r * 1.5} L${x} ${y + r * 0.85} L${x - r} ${y + r * 1.5} L${x - r * 0.75} ${y + r * 0.35} L${x - r * 1.6} ${y - r * 0.4} L${x - r * 0.5} ${y - r * 0.5} Z`} />)}</g>;
    case "flowers":
      return <g>{[[10, 14], [20, 22], [11, 29]].map(([x, y]) => <g key={`${x}-${y}`} fill="#fffaf2" opacity="0.92">{[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx={x} cy={y - 2.1} rx="1.2" ry="2" transform={`rotate(${a} ${x} ${y})`} />)}<circle cx={x} cy={y} r="1" fill={ink} /></g>)}</g>;
    case "leaves":
      return <g fill={ink}>{[[9, 13, -30], [20, 17, 25], [10, 24, 35], [21, 28, -20]].map(([x, y, a]) => <path key={`${x}-${y}`} d={`M${x - 3} ${y} Q${x} ${y - 3} ${x + 3} ${y} Q${x} ${y + 3} ${x - 3} ${y} Z`} transform={`rotate(${a} ${x} ${y})`} />)}</g>;
    case "hearts":
      return <g fill={ink}>{[[10, 14], [20, 19], [12, 26], [21, 29]].map(([x, y]) => <path key={`${x}-${y}`} d={`M${x} ${y + 2.2} C${x - 3.5} ${y - 0.3} ${x - 2} ${y - 3} ${x} ${y - 1.2} C${x + 2} ${y - 3} ${x + 3.5} ${y - 0.3} ${x} ${y + 2.2} Z`} />)}</g>;
    case "spiral":
      return <path d="M15 21 m0 0 a1.5 1.5 0 1 1 1.5 1.5 a3 3 0 1 1 -3 -3 a4.5 4.5 0 1 1 4.5 4.5 a6 6 0 1 1 -6 -6 a7.5 7.5 0 1 1 7.5 7.5" fill="none" stroke={ink} strokeWidth="1.4" strokeLinecap="round" />;
    case "diamonds":
      return <g fill={ink}>{[4, 11, 18, 25].map((x) => <path key={x} d={`M${x} 20 L${x + 2.8} 16.5 L${x + 5.6} 20 L${x + 2.8} 23.5 Z`} />)}<rect x="0" y="13.5" width="30" height="0.9" /><rect x="0" y="25.6" width="30" height="0.9" /></g>;
    case "lion":
      // Eine goldene Pfote - das Zeichen des Rudels.
      return <g fill={ink}><ellipse cx="15" cy="24" rx="4.2" ry="3.6" /><circle cx="10" cy="18.5" r="1.8" /><circle cx="13.3" cy="16" r="1.8" /><circle cx="16.7" cy="16" r="1.8" /><circle cx="20" cy="18.5" r="1.8" /></g>;
    default:
      return null;
  }
}

/** Ein Ei: Muster, Glanz, unten optional Gras. `size` ist die Breite in px; `palette` ersetzt die Farben (Widget). */
export function EggShape({ pattern = "stripes", size = 30, grass = false, className = "", palette = null }) {
  const ids = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [base, ink] = palette || PALETTES[pattern] || PALETTES.stripes;
  return (
    <svg className={`tls-egg__svg ${className}`} width={size} height={size * (38 / 30)} viewBox="0 0 30 38" aria-hidden="true" data-pattern={pattern}>
      <defs>
        <clipPath id={`${ids}-clip`}><path d={EGG} /></clipPath>
        <radialGradient id={`${ids}-shade`} cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.28" />
        </radialGradient>
      </defs>
      <path d={EGG} fill={base} />
      <g clipPath={`url(#${ids}-clip)`}><Pattern pattern={pattern} ink={ink} /></g>
      <path d={EGG} fill={`url(#${ids}-shade)`} />
      <ellipse className="tls-egg__glint" cx="10.5" cy="10.5" rx="2.4" ry="4" transform="rotate(-22 10.5 10.5)" fill="#ffffff" opacity="0.42" />
      <path d={EGG} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="0.7" />
      {grass ? (
        <g className="tls-egg__grass" fill="none" stroke="#6f9e4f" strokeWidth="1.3" strokeLinecap="round">
          <path d="M3 37.5 Q4 32 2.5 29" /><path d="M6 37.5 Q7.5 31.5 9 29.5" /><path d="M11 37.5 Q11.5 33 10 31" />
          <path d="M19 37.5 Q18.5 32.5 20 30.5" /><path d="M24 37.5 Q22.5 31.5 21 29.5" /><path d="M27 37.5 Q26 32 28 29" />
        </g>
      ) : null}
    </svg>
  );
}
