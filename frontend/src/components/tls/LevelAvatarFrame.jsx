import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

const TLS_BLUE = "#29B6E8";

/* 30 level ARCHETYPES — each level has its own named look with unique geometry
   and motion, not just recolors. Crowns come from the dynamic points leaderboard. */
const LEVEL_ARCHETYPES = {
  1:  { name: "Rookie",         color: TLS_BLUE,  color2: "#7FDBFF", speed: 9,   fx: ["ring"] },
  2:  { name: "Puls",           color: TLS_BLUE,  color2: "#7FDBFF", speed: 8,   fx: ["breathe", "echo"] },
  3:  { name: "Fokus",          color: "#00FF88", color2: "#8CFFC7", speed: 7.6, fx: ["corners", "reticle"] },
  4:  { name: "Radar",          color: "#00FF88", color2: "#8CFFC7", speed: 7.2, fx: ["radar", "ring"] },
  5:  { name: "Scanline",       color: "#22D3EE", color2: "#A5F3FC", speed: 6.8, fx: ["scan", "lasers"] },
  6:  { name: "Komet",          color: "#22D3EE", color2: "#A5F3FC", speed: 6.4, fx: ["comet", "ring"] },
  7:  { name: "Rotor",          color: "#2DD4BF", color2: "#99F6E4", speed: 6,   fx: ["dashed", "dashed2", "corners"] },
  8:  { name: "Arkanum",        color: "#A855F7", color2: "#D8B4FE", speed: 5.8, fx: ["runes", "breathe"], aura: 1 },
  9:  { name: "Hex-Schild",     color: "#A855F7", color2: "#D8B4FE", speed: 5.4, fx: ["hexa", "corners"], aura: 1 },
  10: { name: "Doppelhelix",    color: "#8B5CF6", color2: "#C4B5FD", speed: 5,   fx: ["ring", "ring2"], orbits: 2, aura: 1 },
  11: { name: "Glitch-Core",    color: "#8B5CF6", color2: "#C4B5FD", speed: 4.8, fx: ["glitch", "rgb", "scan"], aura: 1 },
  12: { name: "Gold-Zirkel",    color: "#FFD700", color2: "#FFE97A", speed: 4.6, fx: ["ring", "lasers", "corners"], aura: 1 },
  13: { name: "Sternenstaub",   color: "#FFD700", color2: "#FFF3B0", speed: 4.4, fx: ["stars", "rise", "sheen"], aura: 1 },
  14: { name: "Solar-Flare",    color: "#F59E0B", color2: "#FCD34D", speed: 4.2, fx: ["flare", "ring"], aura: 2 },
  15: { name: "Krongold",       color: "#FFD700", color2: "#FFF3B0", speed: 4,   fx: ["ring", "lasers", "stars", "flare", "sheen"], aura: 2 },
  16: { name: "Blutmond",       color: "#E11D48", color2: "#FB7185", speed: 3.8, fx: ["eclipse", "echo", "runes"], aura: 2 },
  17: { name: "Sturmjäger",     color: "#FF3B30", color2: "#FF8A80", speed: 3.6, fx: ["shake", "scan", "ring"], bolts: 3, aura: 2 },
  18: { name: "Inferno",        color: "#FF7A00", color2: "#FFB566", speed: 3.4, fx: ["flames", "rise", "ring"], aura: 2 },
  19: { name: "Neon-Raser",     color: "#FF2E88", color2: "#FF9EC7", speed: 3.2, fx: ["speed", "ring2", "lasers"], aura: 2 },
  20: { name: "Magma",          color: "#FF7A00", color2: "#FFD8A8", speed: 3.2, fx: ["flames", "eclipse", "dashed"], bolts: 2, aura: 2 },
  21: { name: "Plasma",         color: "#22D3EE", color2: "#A5F3FC", speed: 3,   fx: ["plasma", "ring"], orbits: 1, aura: 2 },
  22: { name: "Vortex",         color: "#8B5CF6", color2: "#E9D5FF", speed: 2.9, fx: ["vortex", "ring", "runes"], aura: 2 },
  23: { name: "Nachtklinge",    color: "#FF2E88", color2: "#FFC2DB", speed: 2.8, fx: ["glitch", "rgb", "speed", "lasers"], aura: 2 },
  24: { name: "Frost",          color: "#BAE6FD", color2: "#E0F2FE", speed: 2.8, fx: ["fall", "hexa", "corners"], aura: 2 },
  25: { name: "Diamant",        color: "#E8F1FF", color2: "#FFFFFF", speed: 2.6, fx: ["prism", "stars", "sheen"], aura: 3 },
  26: { name: "Toxin",          color: "#00FF88", color2: "#5EFFC0", speed: 2.5, fx: ["plasma", "rise", "scan", "dashed2"], bolts: 2, aura: 2 },
  27: { name: "Aurora",         color: "#38BDF8", color2: "#BAE6FD", speed: 2.4, fx: ["aurora", "stars", "ring", "hue"], aura: 3 },
  28: { name: "Quantum",        color: TLS_BLUE,  color2: "#9BE7FF", speed: 2.2, fx: ["reticle", "radar", "rgb", "ring2"], orbits: 2, aura: 3 },
  29: { name: "Galaxis",        color: "#A855F7", color2: "#E9D5FF", speed: 2.1, fx: ["vortex", "stars", "comet", "hue", "ring"], orbits: 2, aura: 3 },
  30: { name: "Apex",           color: TLS_BLUE,  color2: "#DFF5FF", speed: 1.9, fx: ["ring", "ring2", "prism", "flare", "vortex", "stars", "rise", "sheen", "shake"], bolts: 4, orbits: 3, aura: 3, maxed: true },
};

/* effects that survive compact mode (lists, small cards) */
const COMPACT_FX = new Set(["ring", "dashed", "corners", "reticle", "radar", "eclipse", "hexa", "runes", "breathe", "prism", "rgb"]);

export function levelFrameConfig(levelInput) {
  const lvl = Math.max(1, Math.floor(Number(levelInput || 1)));
  const style = LEVEL_ARCHETYPES[Math.min(lvl, 30)] || LEVEL_ARCHETYPES[1];
  return {
    level: lvl,
    color: TLS_BLUE, color2: "#7FDBFF", speed: 8,
    bolts: 0, orbits: 0, aura: 0, maxed: false,
    name: "Rookie",
    ...style,
    fx: new Set(style.fx || []),
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

export async function refreshCrowns() {
  crownsCache = null;
  return loadCrowns();
}

export function useCrowns() {
  const [crowns, setCrowns] = useState(crownsCache);
  useEffect(() => {
    let active = true;
    const listener = (next) => { if (active) setCrowns(next); };
    crownsListeners.add(listener);
    if (crownsCache) setCrowns(crownsCache);
    else loadCrowns();
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

const RISE_SPOTS = [
  { left: "12%", delay: 0, dur: 2.6 }, { left: "32%", delay: 0.8, dur: 3.1 },
  { left: "55%", delay: 1.6, dur: 2.4 }, { left: "74%", delay: 0.4, dur: 3.4 },
  { left: "88%", delay: 2.1, dur: 2.8 },
];
const FALL_SPOTS = [
  { left: "10%", delay: 0, dur: 3.4 }, { left: "28%", delay: 1.2, dur: 4.2 },
  { left: "48%", delay: 0.5, dur: 3 }, { left: "66%", delay: 2, dur: 3.8 },
  { left: "84%", delay: 0.9, dur: 3.2 },
];

export function LevelAvatarFrame({ level, crown = null, className = "", compact = false, showBadge = true, team = false, testId, children }) {
  const cfg = useMemo(() => levelFrameConfig(level), [level]);
  const has = (key) => cfg.fx.has(key) && (!compact || COMPACT_FX.has(key));
  const boltSpots = compact ? [] : BOLT_SPOTS.slice(0, cfg.bolts);
  const auraLevel = compact ? Math.min(cfg.aura, 1) : cfg.aura;
  const crownStyle = crown ? CROWN_STYLES[crown] : null;
  return (
    <div
      className={[
        "tls-lvf",
        compact ? "tls-lvf--compact" : "",
        cfg.maxed ? "tls-lvf--max" : "",
        team ? "tls-lvf--team" : "",
        auraLevel ? `tls-lvf-aura-${auraLevel}` : "",
        has("hue") ? "tls-lvf--hue" : "",
        has("shake") ? "tls-lvf--shake" : "",
        className,
      ].filter(Boolean).join(" ")}
      style={{ "--lvf-c": cfg.color, "--lvf-c2": cfg.color2, "--lvf-speed": `${cfg.speed}s` }}
      data-level={cfg.level}
      data-archetype={cfg.name}
      data-crown={crown || undefined}
      data-testid={testId}
    >
      {has("ring") && <span className="tls-lvf-ring" aria-hidden="true" />}
      {has("ring2") && !compact && <span className="tls-lvf-ring tls-lvf-ring--rev" aria-hidden="true" />}
      {has("prism") && <span className="tls-lvf-prism" aria-hidden="true" />}
      {has("dashed") && <span className="tls-lvf-dashed" aria-hidden="true" />}
      {has("dashed2") && <span className="tls-lvf-dashed tls-lvf-dashed--rev" aria-hidden="true" />}
      {has("runes") && <span className="tls-lvf-runes" aria-hidden="true" />}
      {has("reticle") && (
        <span className="tls-lvf-reticle" aria-hidden="true"><i /><i /><i /><i /></span>
      )}
      {has("hexa") && (
        <svg className="tls-lvf-hexa" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points="50,1 95,25 95,75 50,99 5,75 5,25" fill="none" stroke="var(--lvf-c)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {has("corners") && (
        <span className="tls-lvf-corners" aria-hidden="true"><i /><i /><i /><i /></span>
      )}
      {has("echo") && !compact && <span className="tls-lvf-echo" aria-hidden="true" />}
      {has("eclipse") && <span className="tls-lvf-eclipse" aria-hidden="true" />}
      {has("flare") && !compact && <span className="tls-lvf-flare" aria-hidden="true" />}
      {has("lasers") && (
        <span className="tls-lvf-lasers" aria-hidden="true"><i /><i /><i /><i /></span>
      )}
      {boltSpots.length > 0 && (
        <span className="tls-lvf-boltwrap" aria-hidden="true">
          {boltSpots.map((spot, i) => <Bolt key={i} spot={spot} />)}
        </span>
      )}
      {has("comet") && !compact && <span className="tls-lvf-comet" aria-hidden="true"><i /></span>}
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
      <div className={`tls-lvf-inner ${has("breathe") ? "tls-lvf-inner--breathe" : ""} ${has("glitch") && !compact ? "tls-lvf-inner--glitch" : ""} ${has("rgb") ? "tls-lvf-inner--rgb" : ""}`}>
        {children}
        {has("radar") && <span className="tls-lvf-radar" aria-hidden="true" />}
        {has("vortex") && !compact && <span className="tls-lvf-vortex" aria-hidden="true" />}
        {has("aurora") && !compact && <span className="tls-lvf-aurora" aria-hidden="true" />}
        {has("scan") && !compact && <span className="tls-lvf-scan" aria-hidden="true" />}
        {has("speed") && !compact && <span className="tls-lvf-speed" aria-hidden="true"><i /><i /><i /></span>}
        {has("plasma") && !compact && <span className="tls-lvf-plasma" aria-hidden="true"><i /><i /></span>}
        {has("stars") && !compact && <span className="tls-lvf-stars" aria-hidden="true"><i /><i /><i /></span>}
        {has("rise") && !compact && (
          <span className="tls-lvf-rise" aria-hidden="true">
            {RISE_SPOTS.map((s, i) => (
              <i key={i} style={{ left: s.left, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }} />
            ))}
          </span>
        )}
        {has("fall") && !compact && (
          <span className="tls-lvf-fall" aria-hidden="true">
            {FALL_SPOTS.map((s, i) => (
              <i key={i} style={{ left: s.left, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }} />
            ))}
          </span>
        )}
      </div>
      {has("flames") && !compact && <span className="tls-lvf-flames" aria-hidden="true" />}
      {has("sheen") && !compact && <span className="tls-lvf-sheen" aria-hidden="true" />}
      {crown && (
        <span
          className={`tls-lvf-crown tls-lvf-crown--${crown}`}
          style={{ "--crown-glow": crownStyle?.glow }}
          title={CROWN_LABELS[crown]}
          data-testid="avatar-crown"
          aria-hidden="true"
        >
          <span className="tls-lvf-crown-rays" />
          <CrownIcon variant={crown} />
        </span>
      )}
      {showBadge && !compact && (
        <span className="tls-lvf-badge" data-testid="level-frame-badge">
          {team ? `TEAM LVL ${cfg.level}` : `LVL ${cfg.level}`}
        </span>
      )}
    </div>
  );
}
