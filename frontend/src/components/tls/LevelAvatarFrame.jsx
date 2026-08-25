import { useMemo } from "react";

const TLS_BLUE = "#29B6E8";

export function levelFrameConfig(levelInput) {
  const lvl = Math.max(1, Math.floor(Number(levelInput || 1)));
  const base = {
    level: lvl, color: TLS_BLUE, color2: "#7FDBFF", speed: 8,
    sweep: false, dual: false, orbits: 0, lasers: false, bolts: 0,
    crown: null, aura: 0, sheen: false, breathe: false, maxed: false,
  };
  if (lvl >= 25) return { ...base, color: TLS_BLUE, color2: "#0E7CA6", speed: 2.1, sweep: true, dual: true, orbits: 3, lasers: true, bolts: 6, crown: "obsidian", aura: 3, sheen: true, maxed: true };
  if (lvl === 24) return { ...base, color: "#FFD700", color2: "#FFF3B0", speed: 2.5, sweep: true, dual: true, orbits: 2, lasers: true, bolts: 4, crown: "gold", aura: 3, sheen: true };
  if (lvl >= 22) {
    const s = lvl - 22;
    return { ...base, color: "#DDE5EE", color2: "#8FA3B8", speed: 3.1 - s * 0.4, sweep: true, dual: true, orbits: 1 + s, lasers: true, bolts: 2 + s, crown: "silver", aura: 2, sheen: true };
  }
  if (lvl >= 20) {
    const s = lvl - 20;
    return { ...base, color: "#CD7F32", color2: "#F0B27A", speed: 3.6 - s * 0.4, sweep: true, dual: s >= 1, orbits: 1, lasers: s >= 1, bolts: 2 + s, crown: "bronze", aura: 2, sheen: true };
  }
  if (lvl >= 16) {
    const s = lvl - 16;
    return { ...base, color: "#FF3B30", color2: "#FF8A80", speed: 4.4 - s * 0.5, sweep: true, dual: s >= 1, orbits: s >= 3 ? 2 : 0, lasers: s >= 2, bolts: 2 + s, aura: 2, sheen: s >= 2 };
  }
  if (lvl >= 12) {
    const s = lvl - 12;
    return { ...base, color: "#FFD700", color2: "#FFE97A", speed: 5.4 - s * 0.5, sweep: s >= 1, dual: s >= 2, orbits: s >= 2 ? 1 : 0, lasers: true, aura: 1 + (s >= 2 ? 1 : 0), sheen: s >= 3 };
  }
  if (lvl >= 8) {
    const s = lvl - 8;
    return { ...base, color: "#A855F7", color2: "#D8B4FE", speed: 6.6 - s * 0.6, sweep: true, dual: s >= 2, orbits: s >= 1 ? Math.min(2, s) : 0, aura: 1, sheen: s >= 3 };
  }
  if (lvl >= 5) {
    const s = lvl - 5;
    return { ...base, color: TLS_BLUE, color2: "#9BE7FF", speed: 8 - s * 1.4, sweep: true, orbits: s >= 2 ? 1 : 0, aura: s >= 1 ? 1 : 0, sheen: s >= 1 };
  }
  if (lvl >= 3) return { ...base, color: "#00FF88", color2: "#8CFFC7", speed: 7, breathe: true, aura: lvl === 4 ? 1 : 0, sweep: lvl === 4 };
  if (lvl === 2) return { ...base, breathe: true };
  return base;
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
  bronze: { from: "#F0B27A", to: "#8C5A2B", stroke: "#5C3A18", gem: "#FFDCB0" },
  silver: { from: "#FFFFFF", to: "#97A6B5", stroke: "#5F6E7D", gem: "#EAF3FB" },
  gold: { from: "#FFE97A", to: "#C9A100", stroke: "#8A6D00", gem: "#FFF7CE" },
  obsidian: { from: "#2A333D", to: "#05070A", stroke: TLS_BLUE, gem: TLS_BLUE },
};

function Crown({ variant }) {
  const c = CROWN_STYLES[variant] || CROWN_STYLES.gold;
  const gid = `tls-lvf-crown-grad-${variant}`;
  return (
    <svg viewBox="0 0 64 46" className="w-full h-auto" aria-hidden="true">
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

export function LevelAvatarFrame({ level, className = "", compact = false, showBadge = true, testId, children }) {
  const cfg = useMemo(() => levelFrameConfig(level), [level]);
  const boltSpots = compact ? [] : BOLT_SPOTS.slice(0, cfg.bolts);
  const auraLevel = compact ? Math.min(cfg.aura, 1) : cfg.aura;
  return (
    <div
      className={`tls-lvf ${compact ? "tls-lvf--compact" : ""} ${cfg.maxed ? "tls-lvf--max" : ""} ${auraLevel ? `tls-lvf-aura-${auraLevel}` : ""} ${className}`}
      style={{ "--lvf-c": cfg.color, "--lvf-c2": cfg.color2, "--lvf-speed": `${cfg.speed}s` }}
      data-level={cfg.level}
      data-testid={testId}
    >
      {cfg.sweep && <span className="tls-lvf-ring" aria-hidden="true" />}
      {cfg.dual && !compact && <span className="tls-lvf-ring tls-lvf-ring--rev" aria-hidden="true" />}
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
      <div className={`tls-lvf-inner ${cfg.breathe ? "tls-lvf-inner--breathe" : ""}`}>{children}</div>
      {!compact && cfg.sheen && <span className="tls-lvf-sheen" aria-hidden="true" />}
      {cfg.crown && (
        <span className={`tls-lvf-crown tls-lvf-crown--${cfg.crown}`} aria-hidden="true">
          <Crown variant={cfg.crown} />
        </span>
      )}
      {showBadge && !compact && (
        <span className="tls-lvf-badge" data-testid="level-frame-badge">LVL {cfg.level}</span>
      )}
    </div>
  );
}
