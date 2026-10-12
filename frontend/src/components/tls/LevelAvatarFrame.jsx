import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { FRAME_SIZES, LIST_PADDING, frameLayout, framePadding, frameSources, rankInfo, ringOf } from "@/lib/loewenRang";

const TLS_BLUE = "#29B6E8";
// Profil auf dem Handy (unter 640 px): kleineres Foto, sonst ragt der Rahmen über den Bildschirm.
const PROFILE_SMALL = 128;
const MAX_PRESTIGE = 5;

/* Löwen-Rang (#1454): 12 gezeichnete Rahmen statt der 30 Code-Looks. Der Rahmen wird so skaliert und verschoben,
   dass sein gemessener Ring genau auf dem runden Foto liegt - das Foto sitzt immer mittig. Kronen kommen weiter aus
   der Punktewertung. */
export function levelFrameConfig(levelInput) {
  const info = rankInfo(levelInput);
  const ring = ringOf(info.key);
  // Foto-Durchmesser 1 (Radius 0,5): Größe und Versatz der Grafik als Vielfache des Durchmessers.
  const { F: scale, ox, oy } = frameLayout(0.5, ring);
  return { ...info, ring, scale, ox, oy };
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

/** Kantenlänge der Grafik in CSS-Pixeln für ein Foto mit Durchmesser `d`. */
const artPx = (d, scale) => Math.round(d * scale);

/**
 * Profilbild mit dem Rahmen seines Löwen-Rangs.
 * size: "profile" (172 px, auf dem Handy 128), "card" (96) oder "list" (44); `compact` heißt "list".
 * In Listen bleibt nur die Grafik, ohne Glanz und ohne Schild. Die Kinder füllen das runde Foto.
 */
export function LevelAvatarFrame({ level, prestige = 0, crown = null, size, className = "", compact = false, showBadge = true, team = false, testId, children }) {
  const cfg = useMemo(() => levelFrameConfig(level), [level]);
  const variant = FRAME_SIZES[size] ? size : compact ? "list" : "profile";
  const still = variant === "list";
  const diameter = FRAME_SIZES[variant];
  const px = artPx(diameter, cfg.scale);
  const sizes = variant === "profile" ? `(min-width: 640px) ${px}px, ${artPx(PROFILE_SMALL, cfg.scale)}px` : `${px}px`;
  const sources = frameSources(cfg.key, px);
  const [loaded, setLoaded] = useState(false);
  const stars = Math.max(0, Math.min(MAX_PRESTIGE, Math.floor(Number(prestige) || 0)));
  const shown = Math.max(1, Math.floor(Number(level) || 1));
  const crownStyle = crown ? CROWN_STYLES[crown] : null;
  const plate = showBadge && !still;
  // Außenabstand aus der gemessenen Ausdehnung: Profil und Karte je Rang genau, Listen einheitlich für gleich hohe Zeilen.
  const [padTop, padRight, padBottom, padLeft] = still ? LIST_PADDING : framePadding(cfg.ring);
  // In Listen gibt es kein Schild - dort trägt der Rahmen selbst Level und Rang als zugänglichen Namen.
  const label = `${team ? "Team-Level" : "Level"} ${shown}, Rang ${cfg.name}${stars > 0 ? `, Prestige ${stars}` : ""}`;
  useEffect(() => { setLoaded(false); }, [cfg.key]);
  return (
    <div
      className={["tls-lvf", `tls-lvf--${variant}`, plate ? "tls-lvf--plate" : "", plate && stars > 0 ? "tls-lvf--stars" : "", team ? "tls-lvf--team" : "", className].filter(Boolean).join(" ")}
      role={still ? "img" : undefined}
      aria-label={still ? label : undefined}
      style={{
        "--lvf-scale": cfg.scale.toFixed(4),
        "--lvf-ox": cfg.ox.toFixed(4),
        "--lvf-oy": cfg.oy.toFixed(4),
        "--lvf-rc": cfg.color,
        "--lvf-shine": (0.35 + 0.55 * cfg.progress).toFixed(2),
        "--lvf-pt": padTop,
        "--lvf-pr": padRight,
        "--lvf-pb": padBottom,
        "--lvf-pl": padLeft,
      }}
      data-level={shown}
      data-rank={cfg.rank}
      data-rank-name={cfg.name}
      data-crown={crown || undefined}
      data-testid={testId}
    >
      <div className="tls-lvf-photo">{children}</div>
      <span className="tls-lvf-art" data-loaded={loaded ? "1" : undefined} aria-hidden="true">
        <img
          className="tls-lvf-img"
          src={sources.src}
          srcSet={sources.srcSet}
          sizes={sizes}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          alt=""
          draggable="false"
          onLoad={() => setLoaded(true)}
        />
        {!still && <span className="tls-lvf-shine" style={{ "--lvf-mask": `url("${sources.mask}")` }} />}
      </span>
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
      {plate && (
        <span className="tls-lvf-plate" data-testid="level-frame-badge">
          {stars > 0 && <span className="tls-lvf-stars" role="img" aria-label={`Prestige ${stars}`}>{"★".repeat(stars)}</span>}
          <span className="tls-lvf-tag">{team ? `TEAM LVL ${shown}` : cfg.max ? "LVL 60 · MAX" : `LVL ${shown}`}</span>
          <span className="tls-lvf-pips" role="img" aria-label={`${cfg.name}: ${cfg.filled} von ${cfg.pips}`}>
            {Array.from({ length: cfg.pips }, (_, i) => (
              <i key={i} className={`tls-lvf-pip${i < cfg.filled ? " is-on" : ""}`} />
            ))}
          </span>
        </span>
      )}
    </div>
  );
}
