import { useId } from "react";
import { Motif, hasMotif } from "./badgeArt";
import { lookFor, rankNotches } from "./materials";
import { AchievementIcon } from "@/components/tls/AchievementIcon";
import "./badge.css";

// Erfolge II (E8, #618): das Abzeichen. Ein rundes Emblem in einem der neun Materialien, das Motiv der
// Gruppe als Relief in der Fläche, der Rand mit Rang-Kerben (1–7), Legendär mit Löwenkopf im Rand,
// Geheim mit Fragezeichen, das sich wegdreht. Nicht erreichte Stufen: Silhouette mit Fortschrittsring.
// Alles SVG und CSS, kein WebGL; Bewegung nur bei „animate“ und nie bei reduzierter Bewegung.

const SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 96, hero: 160 };

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx, cy, r, from, to) {
  const [sx, sy] = polar(cx, cy, r, from);
  const [ex, ey] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

// Kerben im Rand: eine je Rang, gleichmäßig über den oberen Bogen verteilt.
function Notches({ count, color }) {
  if (!count) return null;
  const spread = Math.min(120, 22 * (count - 1));
  const start = -spread / 2;
  return (
    <g data-notches={count} stroke={color} strokeWidth="2.4" strokeLinecap="round">
      {Array.from({ length: count }, (_, i) => {
        const deg = start + (count === 1 ? 0 : (spread / (count - 1)) * i);
        const [x1, y1] = polar(50, 50, 40.5, deg);
        const [x2, y2] = polar(50, 50, 46.5, deg);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
    </g>
  );
}

// Löwenkopf im Rand (Legendär): eine kleine Prägung oben, aus Bögen - kein Bild, keine Schrift.
function LionCrest({ color, accent }) {
  return (
    <g data-lion-crest transform="translate(50 9.5) scale(0.62)">
      <path d="M-11 -2 C-13 -9 -8 -12 -4 -9 C-2 -12 2 -12 4 -9 C8 -12 13 -9 11 -2 C13 3 10 8 6 9 L-6 9 C-10 8 -13 3 -11 -2 Z" fill={color} />
      <path d="M-6 -3 C-4 -5 -1 -5 0 -3 C1 -5 4 -5 6 -3" stroke={accent} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M-4 3 L0 6 L4 3" stroke={accent} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="-3.2" cy="-0.5" r="1.1" fill={accent} />
      <circle cx="3.2" cy="-0.5" r="1.1" fill={accent} />
    </g>
  );
}

function Facets({ id, color }) {
  return (
    <g data-facets clipPath={`url(#${id}-disc)`} fill={color} opacity="0.16">
      <polygon points="50,14 72,30 50,50" />
      <polygon points="50,14 28,30 50,50" opacity="0.5" />
      <polygon points="72,30 86,50 50,50" opacity="0.7" />
      <polygon points="28,30 14,50 50,50" opacity="0.3" />
      <polygon points="14,50 28,70 50,50" opacity="0.6" />
      <polygon points="86,50 72,70 50,50" opacity="0.4" />
      <polygon points="28,70 50,86 50,50" opacity="0.35" />
      <polygon points="72,70 50,86 50,50" opacity="0.55" />
    </g>
  );
}

function Texture({ kind, id, look }) {
  if (kind === "grain") {
    return (
      <g data-texture="grain" clipPath={`url(#${id}-disc)`} stroke={look.dark} strokeWidth="1.1" fill="none" opacity="0.45">
        <path d="M8 34 C 30 26, 60 26, 92 36" />
        <path d="M6 46 C 34 40, 66 40, 94 48" />
        <path d="M8 60 C 30 54, 70 56, 92 62" />
        <path d="M14 72 C 40 66, 62 70, 86 74" />
        <path d="M20 22 C 40 18, 60 18, 80 22" />
      </g>
    );
  }
  if (kind === "brushed") {
    return (
      <g data-texture="brushed" clipPath={`url(#${id}-disc)`} stroke={look.light} strokeWidth="0.7" fill="none" opacity="0.28">
        {Array.from({ length: 14 }, (_, i) => <line key={i} x1="6" y1={14 + i * 5.4} x2="94" y2={14 + i * 5.4} />)}
      </g>
    );
  }
  if (kind === "ice") {
    return (
      <g data-texture="ice" clipPath={`url(#${id}-disc)`} stroke={look.light} strokeWidth="1.2" strokeLinecap="round" opacity="0.5">
        <path d="M22 26 l6 0 M25 23 l0 6 M23 24 l4 4 M27 24 l-4 4" />
        <path d="M74 66 l6 0 M77 63 l0 6 M75 64 l4 4 M79 64 l-4 4" />
        <path d="M70 24 l4 0 M72 22 l0 4" />
        <path d="M26 72 l4 0 M28 70 l0 4" />
      </g>
    );
  }
  if (kind === "facets") return <Facets id={id} color={look.light} />;
  if (kind === "veil") {
    return (
      <g data-texture="veil" clipPath={`url(#${id}-disc)`} fill={look.dark} opacity="0.55">
        <path d="M0 62 C 20 50, 40 74, 60 60 S 90 52, 100 64 L100 100 L0 100 Z" />
      </g>
    );
  }
  return null;
}

export function Badge({
  material,
  level,
  rank,
  art,
  icon,
  earned = true,
  percent = 0,
  size = "md",
  animate = false,
  special = false,
  negative = false,
  title,
  className = "",
  testId,
}) {
  // React-IDs tragen Doppelpunkte oder Guillemets - in url(#…) nur Buchstaben, Ziffern, Strich.
  const id = `b${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const look = lookFor(material, level, { special, negative });
  const px = typeof size === "number" ? size : SIZES[size] || SIZES.md;
  const notches = rankNotches(rank, look.key);
  const locked = !earned;
  const progress = Math.max(0, Math.min(100, Number(percent || 0)));
  // Erst das Motiv der Gruppe (art), dann ein Verwandter des Symbols (icon), zuletzt das Lucide-Symbol selbst.
  const motifKey = hasMotif(art) ? art : icon;
  const inkColor = locked ? "rgba(255,255,255,0.28)" : look.ink;
  const classes = [
    "tls-badge",
    `tls-badge--${look.key}`,
    locked ? "tls-badge--locked" : "tls-badge--earned",
    animate && !locked ? "tls-badge--animate" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      width={px}
      height={px}
      className={classes}
      role="img"
      aria-label={title || `${look.name}${notches ? ` ${["", "I", "II", "III", "IV", "V", "VI", "VII"][notches]}` : ""}`}
      data-testid={testId}
      data-material={look.key}
      data-rank={notches || undefined}
      data-locked={locked ? "true" : undefined}
      style={{ "--badge-rim": look.rim, "--badge-glow": look.glow, "--badge-light": look.light }}
    >
      <defs>
        <radialGradient id={`${id}-disc-fill`} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor={locked ? "#2A2A2E" : look.light} stopOpacity={locked ? 1 : 0.95} />
          <stop offset="45%" stopColor={locked ? "#1B1B1F" : look.base} />
          <stop offset="100%" stopColor={locked ? "#0F0F12" : look.dark} />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={locked ? "#3A3A40" : look.light} />
          <stop offset="50%" stopColor={locked ? "#26262B" : look.rim} />
          <stop offset="100%" stopColor={locked ? "#141417" : look.dark} />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-disc`}><circle cx="50" cy="50" r="38" /></clipPath>
        <filter id={`${id}-relief`} x="-20%" y="-20%" width="140%" height="140%">
          <feOffset in="SourceAlpha" dx="0.9" dy="1.1" result="down" />
          <feFlood floodColor={look.dark} floodOpacity={locked ? 0.4 : 0.85} result="dark" />
          <feComposite in="dark" in2="down" operator="in" result="shadow" />
          <feOffset in="SourceAlpha" dx="-0.7" dy="-0.8" result="up" />
          <feFlood floodColor="#ffffff" floodOpacity={locked ? 0.05 : 0.45} result="lightc" />
          <feComposite in="lightc" in2="up" operator="in" result="highlight" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="highlight" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Schein hinter dem Abzeichen (nur erreicht) */}
      {!locked && <circle className="tls-badge__glow" cx="50" cy="50" r="46" fill={look.glow} opacity="0.12" />}

      {/* Rand */}
      <circle cx="50" cy="50" r="46" fill={`url(#${id}-rim)`} />
      <circle cx="50" cy="50" r="46" fill="none" stroke={locked ? "rgba(255,255,255,0.12)" : look.dark} strokeWidth="1" />
      {locked && <circle cx="50" cy="50" r="43" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="3 3" />}

      {/* Fläche */}
      <circle cx="50" cy="50" r="38" fill={`url(#${id}-disc-fill)`} />
      {!locked && <Texture kind={look.texture} id={id} look={look} />}
      {!locked && <circle cx="50" cy="50" r="38" fill="none" stroke={look.light} strokeOpacity="0.35" strokeWidth="1" />}
      {!locked && <circle cx="50" cy="50" r="35" fill="none" stroke={look.dark} strokeOpacity="0.5" strokeWidth="0.8" />}

      {/* Motiv als Relief */}
      <g className="tls-badge__motif" filter={locked ? undefined : `url(#${id}-relief)`} color={inkColor}>
        {hasMotif(motifKey)
          ? <Motif art={motifKey} x={26} y={26} size={48} />
          : <foreignObject x="30" y="30" width="40" height="40"><AchievementIcon name={icon || art} fallback="trophy" style={{ width: 40, height: 40, color: inkColor }} /></foreignObject>}
      </g>

      {/* Bewegte Effekte je Material (CSS steuert die Sichtbarkeit) */}
      {!locked && (look.motion === "sheen" || look.motion === "flash" || look.motion === "prism") && (
        <g clipPath={`url(#${id}-disc)`} className="tls-badge__sheen" data-motion={look.motion}>
          <rect x="-40" y="0" width="34" height="100" fill={`url(#${id}-sheen)`} transform="skewX(-20)" />
        </g>
      )}
      {!locked && look.motion === "sparkle" && (
        <g className="tls-badge__sparkles" fill={look.light}>
          <path d="M22 22 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6z" />
          <path d="M76 30 l1.2 2.6 2.6 1.2 -2.6 1.2 -1.2 2.6 -1.2 -2.6 -2.6 -1.2 2.6 -1.2z" />
          <path d="M70 74 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4z" />
        </g>
      )}
      {!locked && look.motion === "flame" && (
        <g className="tls-badge__flames" fill={look.accent || look.light} opacity="0.85">
          <path d="M18 74 c-2 -6 1 -9 3 -12 c0 4 3 5 3 9 c2 -3 1 -6 1 -8 c4 4 4 10 -1 13 c-3 2 -5 1 -6 -2z" />
          <path d="M79 72 c-2 -6 1 -9 3 -12 c0 4 3 5 3 9 c2 -3 1 -6 1 -8 c4 4 4 10 -1 13 c-3 2 -5 1 -6 -2z" />
        </g>
      )}
      {!locked && look.motion === "turn" && (
        <text className="tls-badge__question" x="72" y="30" fontSize="14" fontWeight="700" fill={look.light} textAnchor="middle">?</text>
      )}

      {/* Rang-Kerben und Wappen */}
      <Notches count={notches} color={locked ? "rgba(255,255,255,0.22)" : look.ink} />
      {!locked && look.key === "legendary" && <LionCrest color={look.dark} accent={look.accent || look.light} />}

      {/* Fortschrittsring auf der Silhouette */}
      {locked && progress > 0 && (
        <path data-progress={progress} d={arcPath(50, 50, 43, 0, Math.max(2, (progress / 100) * 359.9))} fill="none" stroke="var(--badge-rim)" strokeWidth="2.6" strokeLinecap="round" opacity="0.9" />
      )}
    </svg>
  );
}

export { SIZES as BADGE_SIZES };
