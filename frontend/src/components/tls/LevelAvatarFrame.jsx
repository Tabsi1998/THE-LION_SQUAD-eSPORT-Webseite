import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

const TLS_BLUE = "#29B6E8";

/* 30 unique frame styles — every level gets its own color + effect mix.
   No hard cap: 30+ keeps the apex stage. Crowns are NOT level based anymore,
   they come from the dynamic points leaderboard (useCrownFor / crown prop). */
const LEVEL_STYLES = {
  1:  { color: TLS_BLUE,  color2: "#7FDBFF", speed: 9 },
  2:  { color: TLS_BLUE,  color2: "#7FDBFF", speed: 8, breathe: true },
  3:  { color: "#00FF88", color2: "#8CFFC7", speed: 8, breathe: true, corners: true },
  4:  { color: "#00FF88", color2: "#8CFFC7", speed: 7.4, sweep: true, echo: true },
  5:  { color: "#22D3EE", color2: "#A5F3FC", speed: 7, sweep: true, corners: true },
  6:  { color: "#22D3EE", color2: "#A5F3FC", speed: 6.4, sweep: true, sheen: true, orbits: 1 },
  7:  { color: "#2DD4BF", color2: "#99F6E4", speed: 6, dashed: true, orbits: 1, corners: true },
  8:  { color: "#A855F7", color2: "#D8B4FE", speed: 6, sweep: true, aura: 1 },
  9:  { color: "#A855F7", color2: "#D8B4FE", speed: 5.6, sweep: true, echo: true, orbits: 1, sheen: true, aura: 1 },
  10: { color: "#A855F7", color2: "#E9D5FF", speed: 5.2, sweep: true, dual: true, orbits: 2, aura: 1 },
  11: { color: "#8B5CF6", color2: "#C4B5FD", speed: 4.8, dashed: true, dual: true, corners: true, sheen: true, aura: 1 },
  12: { color: "#FFD700", color2: "#FFE97A", speed: 4.8, lasers: true, aura: 1 },
  13: { color: "#FFD700", color2: "#FFF3B0", speed: 4.5, sweep: true, lasers: true, corners: true, aura: 1 },
  14: { color: "#F59E0B", color2: "#FCD34D", speed: 4.2, sweep: true, dual: true, orbits: 1, scan: true, aura: 2 },
  15: { color: "#FFD700", color2: "#FFF3B0", speed: 4, sweep: true, lasers: true, orbits: 2, sheen: true, echo: true, aura: 2 },
  16: { color: "#FF3B30", color2: "#FF8A80", speed: 4, sweep: true, bolts: 2, aura: 2 },
  17: { color: "#FF3B30", color2: "#FF8A80", speed: 3.7, sweep: true, dual: true, bolts: 3, corners: true, aura: 2 },
  18: { color: "#E11D48", color2: "#FB7185", speed: 3.4, sweep: true, lasers: true, bolts: 3, scan: true, aura: 2 },
  19: { color: "#FF3B30", color2: "#FCA5A5", speed: 3.1, sweep: true, dual: true, lasers: true, bolts: 4, orbits: 2, echo: true, aura: 2 },
  20: { color: "#FF7A00", color2: "#FFB566", speed: 3.4, sweep: true, flames: true, bolts: 2, aura: 2 },
  21: { color: "#FF7A00", color2: "#FFD8A8", speed: 3.1, sweep: true, dual: true, flames: true, lasers: true, orbits: 1, aura: 2 },
  22: { color: "#FF2E88", color2: "#FF9EC7", speed: 3, sweep: true, glitch: true, orbits: 2, sheen: true, aura: 2 },
  23: { color: "#FF2E88", color2: "#FFC2DB", speed: 2.8, sweep: true, glitch: true, lasers: true, bolts: 3, corners: true, aura: 2 },
  24: { color: "#E8F1FF", color2: "#9DB8D6", speed: 2.8, sweep: true, dual: true, stars: true, sheen: true, aura: 2 },
  25: { color: "#E8F1FF", color2: "#C7DCF5", speed: 2.6, sweep: true, stars: true, lasers: true, echo: true, orbits: 2, aura: 3 },
  26: { color: "#00FF88", color2: "#5EFFC0", speed: 2.5, sweep: true, dual: true, bolts: 3, stars: true, scan: true, aura: 3 },
  27: { color: "#38BDF8", color2: "#BAE6FD", speed: 2.4, sweep: true, hue: true, lasers: true, stars: true, corners: true, aura: 3 },
  28: { color: "#38BDF8", color2: "#7DD3FC", speed: 2.2, sweep: true, hue: true, bolts: 4, orbits: 2, echo: true, aura: 3 },
  29: { color: TLS_BLUE,  color2: "#9BE7FF", speed: 2.1, sweep: true, dual: true, lasers: true, bolts: 4, flames: true, stars: true, sheen: true, aura: 3 },
  30: { color: TLS_BLUE,  color2: "#DFF5FF", speed: 1.9, sweep: true, dual: true, hue: true, lasers: true, bolts: 6, orbits: 3, stars: true, flames: true, echo: true, sheen: true, aura: 3, maxed: true },
};

export function levelFrameConfig(levelInput) {
  const lvl = Math.max(1, Math.floor(Number(levelInput || 1)));
  const style = LEVEL_STYLES[Math.min(lvl, 30)] || LEVEL_STYLES[1];
  return {
    level: lvl,
    color: TLS_BLUE, color2: "#7FDBFF", speed: 8,
    sweep: false, dual: false, orbits: 0, lasers: false, bolts: 0,
    aura: 0, sheen: false, breathe: false, corners: false, echo: false,
    dashed: false, scan: false, flames: false, glitch: false, stars: false,
    hue: false, maxed: false,
    ...style,
  };
}

/* ---- Dynamic crowns (points leaderboard rank 1-3 + obsidian for level 30+) ---- */
let crownsCache = null;
let crownsPromise = null;
const crownsListeners = new Set();

async function loadCrowns() {
  if (crownsCache) return crownsCache;
  if (!crownsPromise) {
    crownsPromise = api.get("/achievements/crowns")
      .then(({ data }) => {
        crownsCache = data?.crowns || {};
        crownsListeners.forEach((fn) => fn(crownsCache));
        return crownsCache;
      })
      .catch(() => ({}))
      .finally(() => { crownsPromise = null; });
  }
  return crownsPromise;
}

export function useCrowns() {
  const [crowns, setCrowns] = useState(crownsCache);
  useEffect(() => {
    if (crownsCache) { setCrowns(crownsCache); return undefined; }
    let active = true;
    const listener = (next) => { if (active) setCrowns(next); };
    crownsListeners.add(listener);
    loadCrowns();
    return () => { active = false; crownsListeners.delete(listener); };
  }, []);
  return crowns;
}

export function useCrownFor(userId) {
  const crowns = useCrowns();
  if (!userId || !crowns) return null;
  return crowns[userId] || null;
}

const BOLT_SPOTS = [
  { style: { top: "-13px", left: "-9px", transform: "rotate(-18deg)" }, delay: 0 },
  { style: { top: "-13px", right: "-9px", transform: "rotate(20deg) scaleX(-1)" }, delay: 0.7 },
  { style: { top: "36%", left: "-15px", transform: "rotate(-72deg)" }, delay: 1.3 },
  { style: { top: "42%", right: "-15px", transform: "rotate(72deg)" }, delay: 0.4 },
  { style: { bottom: "-13px", left: "5%", transform: "rotate(158deg)" }, delay: 1.8 },
  { style: { bottom: "-13px", right: "5%", transform: "rotate(-158deg) scaleX(-1)" }, delay: 1.05 },
];

function Bolt({ spot }) {
  return (
    <svg viewBox="0 0 24 36" className="tls-lvf-bolt" style={{ ...spot.style, animationDelay: `${spot.delay}s` }} aria-hidden="true">
      <path d="M14 1 L4 20 h6 L8 35 L21 13 h-7 L18 1 Z" fill="currentColor" />
    </svg>
  );
}

const CROWN_STYLES = {
  bronze: { from: "#F0B27A", to: "#8C5A2B", stroke: "#5C3A18", gem: "#FFDCB0", glow: "rgba(205,127,50,0.9)" },
  silver: { from: "#FFFFFF", to: "#97A6B5", stroke: "#5F6E7D", gem: "#EAF3FB", glow: "rgba(221,229,238,0.95)" },
  gold: { from: "#FFE97A", to: "#C9A100", stroke: "#8A6D00", gem: "#FFF7CE", glow: "rgba(255,215,0,1)" },
  obsidian: { from: "#2A333D", to: "#05070A", stroke: TLS_BLUE, gem: TLS_BLUE, glow: "rgba(41,182,232,1)" },
};

export const CROWN_LABELS = {
  gold: "Punkte-König · Platz 1",
  silver: "Platz 2 der Punktewertung",
  bronze: "Platz 3 der Punktewertung",
  obsidian: "Obsidian · Level 30+",
};

export function CrownIcon({ variant, className = "" }) {
  const c = CROWN_STYLES[variant] || CROWN_STYLES.gold;
  const gid = `tls-lvf-crown-grad-${variant}`;
  return (
    <svg viewBox="0 0 64 46" className={className || "w-full h-auto"} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.from} />
          <stop offset="100%" stopColor={c.to} />
        </linearGradient>
      </defs>
      <path d="M6 35 L10 11 L22 23 L32 3 L42 23 L54 11 L58 35 Z" fill={`url(#${gid})`} stroke={c.stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="6" y="36" width="52" height="5.5" rx="1.6" fill={`url(#${gid})`} stroke={c.stroke} strokeWidth="1.2" />
      <circle cx="32" cy="26" r="3.1" fill={c.gem} />
      <circle cx="17.5" cy="29.5" r="2" fill={c.gem} />
      <circle cx="46.5" cy="29.5" r="2" fill={c.gem} />
      <circle cx="32" cy="38.8" r="1.7" fill={c.gem} />
    </svg>
  );
}

export function LevelAvatarFrame({ level, crown = null, className = "", compact = false, showBadge = true, testId, children }) {
  const cfg = useMemo(() => levelFrameConfig(level), [level]);
  const boltSpots = compact ? [] : BOLT_SPOTS.slice(0, cfg.bolts);
  const auraLevel = compact ? Math.min(cfg.aura, 1) : cfg.aura;
  const crownStyle = crown ? CROWN_STYLES[crown] : null;
  return (
    <div
      className={`tls-lvf ${compact ? "tls-lvf--compact" : ""} ${cfg.maxed ? "tls-lvf--max" : ""} ${auraLevel ? `tls-lvf-aura-${auraLevel}` : ""} ${cfg.hue ? "tls-lvf--hue" : ""} ${className}`}
      style={{ "--lvf-c": cfg.color, "--lvf-c2": cfg.color2, "--lvf-speed": `${cfg.speed}s` }}
      data-level={cfg.level}
      data-crown={crown || undefined}
      data-testid={testId}
    >
      {cfg.sweep && <span className="tls-lvf-ring" aria-hidden="true" />}
      {cfg.dual && !compact && <span className="tls-lvf-ring tls-lvf-ring--rev" aria-hidden="true" />}
      {cfg.dashed && <span className="tls-lvf-dashed" aria-hidden="true" />}
      {cfg.corners && (
        <span className="tls-lvf-corners" aria-hidden="true"><i /><i /><i /><i /></span>
      )}
      {cfg.echo && !compact && <span className="tls-lvf-echo" aria-hidden="true" />}
      {!compact && cfg.lasers && (
        <span className="tls-lvf-lasers" aria-hidden="true"><i /><i /><i /><i /></span>
      )}
      {boltSpots.length > 0 && (
        <span className="tls-lvf-boltwrap" aria-hidden="true">
          {boltSpots.map((spot, i) => <Bolt key={i} spot={spot} />)}
        </span>
      )}
      {!compact && Array.from({ length: cfg.orbits }).map((_, i) => (
        <span
          key={i}
          className="tls-lvf-orbit"
          style={{
            animationDuration: `${3.2 + i * 1.1}s`,
            animationDelay: `${i * -1.4}s`,
            animationDirection: i % 2 ? "reverse" : "normal",
            inset: `${-10 - i * 5}px`,
          }}
          aria-hidden="true"
        />
      ))}
      <div className={`tls-lvf-inner ${cfg.breathe ? "tls-lvf-inner--breathe" : ""} ${cfg.glitch && !compact ? "tls-lvf-inner--glitch" : ""}`}>
        {children}
        {cfg.scan && !compact && <span className="tls-lvf-scan" aria-hidden="true" />}
        {cfg.stars && !compact && <span className="tls-lvf-stars" aria-hidden="true"><i /><i /><i /></span>}
      </div>
      {cfg.flames && !compact && <span className="tls-lvf-flames" aria-hidden="true" />}
      {!compact && cfg.sheen && <span className="tls-lvf-sheen" aria-hidden="true" />}
      {crown && (
        <span
          className={`tls-lvf-crown tls-lvf-crown--${crown}`}
          style={{ "--crown-glow": crownStyle?.glow }}
          title={CROWN_LABELS[crown]}
          data-testid="avatar-crown"
          aria-hidden="true"
        >
          <CrownIcon variant={crown} />
        </span>
      )}
      {showBadge && !compact && (
        <span className="tls-lvf-badge" data-testid="level-frame-badge">LVL {cfg.level}</span>
      )}
    </div>
  );
}
