import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { lazyPage } from "@/lib/chunkReload";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { FRAME_SIZES, PROFILE_SMALL, frameFit, frameLayout, framePadding, frameSources, rankInfo, ringOf } from "@/lib/loewenRang";
import { ASCENT_TIMING, burstDelay } from "@/lib/loewenAufstieg";

const TLS_BLUE = "#29B6E8";
const MAX_PRESTIGE = 5;
// Signatur des Rangs (#1455): Partikel-Canvas nur im Profilkopf, erst bei Bedarf geladen.
const LoewenRangSignature = lazyPage(() => import("./LoewenRangSignature"));

/* Löwen-Rang (#1454): 12 gezeichnete Rahmen statt der 30 Code-Looks. Jede Größe hat eine feste Fläche für Rahmen und
   Foto; das Foto wird je Rang so groß, dass die ganze Grafik hineinpasst, und der Rahmen so skaliert und verschoben,
   dass sein gemessener Ring genau auf dem runden Foto liegt. Kronen kommen weiter aus der Punktewertung. */
export function levelFrameConfig(levelInput) {
  const info = rankInfo(levelInput);
  const ring = ringOf(info.key);
  // Foto-Durchmesser 1 (Radius 0,5): Größe und Versatz der Grafik als Vielfache des Durchmessers.
  const { F: scale, ox, oy } = frameLayout(0.5, ring);
  return { ...info, ring, scale, ox, oy, fit: frameFit(ring), pad: framePadding(ring) };
}

/* ---- Kronen: Platz 1–3 der Punktewertung (Gold, Silber, Bronze) und Onyx ab Level 30 (#1458) ---- */
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
  onyx: { from: "#2A333D", to: "#05070A", stroke: TLS_BLUE, gem: TLS_BLUE, glow: "rgba(41,182,232,1)" },
};

/** Ältere Antworten kennen die Onyx-Krone noch als „obsidian“ - der Name gehört heute Rang 10 (#1458). */
export function crownVariant(crown) {
  if (!crown) return null;
  return crown === "obsidian" ? "onyx" : crown;
}

export const CROWN_LABELS = {
  gold: "Punkte-König · Platz 1",
  silver: "Platz 2 der Punktewertung",
  bronze: "Platz 3 der Punktewertung",
  onyx: "Onyx · Level 30+",
};

export function CrownIcon({ variant: rawVariant, className = "" }) {
  const variant = crownVariant(rawVariant) || "gold";
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

/** Kantenlänge der Grafik in CSS-Pixeln für eine Fläche mit Kantenlänge `area`. */
const artPx = (area, cfg) => Math.round(area * cfg.fit.photo * cfg.scale);
const STILL = new Set(["list", "mini"]);

/**
 * Profilbild mit dem Rahmen seines Löwen-Rangs, in einer festen Fläche für alle Ränge.
 * size: "profile" (285 px, auf dem Handy 220), "card" (150), "list" (92) oder "mini" (64, etwa das Podest);
 * `compact` heißt "list". In Listen und klein bleibt nur die Grafik, ohne Glanz und ohne Schild.
 * Nur im Profil läuft die Signatur des Rangs (#1455) - ab dem zweiten Level im Rang, nicht mit „Bewegung reduzieren“.
 * `ascent` (aus ascentMoment, lib/loewenAufstieg.js) spielt einmal den Aufstiegs-Moment (#1456): beim Level im Rang
 * springen die neuen Rauten auf und ein Glanz läuft durch, beim Rangwechsel blitzt der alte Rahmen weg und der neue
 * rastet ein - dazu der kleine bzw. große Moment der Signatur. Mit reduzierter Bewegung nur Ein- und Ausblenden.
 * Die Kinder füllen das runde Foto.
 */
export function LevelAvatarFrame({ level, prestige = 0, crown: rawCrown = null, size, className = "", compact = false, showBadge = true, team = false, ascent = null, testId, children }) {
  const cfg = useMemo(() => levelFrameConfig(level), [level]);
  const variant = FRAME_SIZES[size] ? size : compact ? "list" : "profile";
  const still = STILL.has(variant);
  const px = artPx(FRAME_SIZES[variant], cfg);
  const sizes = variant === "profile" ? `(min-width: 640px) ${px}px, ${artPx(PROFILE_SMALL, cfg)}px` : `${px}px`;
  const sources = frameSources(cfg.key, px);
  const [loaded, setLoaded] = useState(false);
  const stars = Math.max(0, Math.min(MAX_PRESTIGE, Math.floor(Number(prestige) || 0)));
  const shown = Math.max(1, Math.floor(Number(level) || 1));
  const crown = crownVariant(rawCrown);
  const plate = showBadge && !still;
  const reducedMotion = useReducedMotion();
  // Gleiche Regel wie signatureEnabled (lib/loewenSignatur.js), ohne die Datei ins Haupt-Bundle zu ziehen: beim ersten
  // Level eines Rangs glänzt nur der Rahmen.
  const moment = ascent && !still && Number(ascent.level) === cfg.level ? ascent : null;
  const motion = Boolean(moment?.particles) && !reducedMotion;
  const signature = (variant === "profile" && !reducedMotion && cfg.progress > 0) || motion;
  const oldCfg = useMemo(() => (moment?.kind === "rank" ? levelFrameConfig(moment.previous) : null), [moment?.kind, moment?.previous]);
  const oldSources = oldCfg ? frameSources(oldCfg.key, artPx(FRAME_SIZES[variant], oldCfg)) : null;
  const pops = useMemo(() => new Map((moment?.pops || []).map((index, order) => [index, order])), [moment]);
  // Beim Rangwechsel wartet der Moment, bis der alte Rahmen weggeblitzt ist; beim Level im Rang kommt er gleich.
  const burst = useMemo(() => (motion ? { id: moment.id, strong: moment.strong, delay: burstDelay(moment.kind) } : null), [motion, moment]);
  const [jolt, setJolt] = useState(false);
  const joltTimer = useRef(0);
  const onJolt = useCallback(() => {
    setJolt(true);
    window.clearTimeout(joltTimer.current);
    joltTimer.current = window.setTimeout(() => setJolt(false), 400);
  }, []);
  useEffect(() => () => window.clearTimeout(joltTimer.current), []);
  // In Listen gibt es kein Schild - dort trägt der Rahmen selbst Level und Rang als zugänglichen Namen.
  const label = `${team ? "Team-Level" : "Level"} ${shown}, Rang ${cfg.name}${stars > 0 ? `, Prestige ${stars}` : ""}`;
  useEffect(() => { setLoaded(false); }, [cfg.key]);
  return (
    <div
      className={[
        "tls-lvf", `tls-lvf--${variant}`, still ? "tls-lvf--still" : "", plate ? "tls-lvf--plate" : "", plate && stars > 0 ? "tls-lvf--stars" : "", team ? "tls-lvf--team" : "",
        moment ? `tls-lvf--ascent tls-lvf--ascent-${moment.kind}` : "", moment && !motion ? "tls-lvf--ascent-calm" : "", jolt ? "tls-lvf--jolt" : "", className,
      ].filter(Boolean).join(" ")}
      role={still ? "img" : undefined}
      aria-label={still ? label : undefined}
      style={{
        "--lvf-fit": cfg.fit.photo,
        "--lvf-left": cfg.fit.left.toFixed(4),
        "--lvf-top": cfg.fit.top.toFixed(4),
        "--lvf-scale": cfg.scale.toFixed(4),
        "--lvf-ox": cfg.ox.toFixed(4),
        "--lvf-oy": cfg.oy.toFixed(4),
        "--lvf-pt": cfg.pad[0].toFixed(4),
        "--lvf-pb": cfg.pad[2].toFixed(4),
        "--lvf-rc": cfg.color,
        "--lvf-shine": (0.35 + 0.55 * cfg.progress).toFixed(2),
        ...(moment ? { "--lvf-hold": `${ASCENT_TIMING.hold}ms` } : null),
      }}
      data-level={shown}
      data-rank={cfg.rank}
      data-rank-name={cfg.name}
      data-crown={crown || undefined}
      data-ascent={moment?.kind}
      data-testid={testId}
    >
      <div className="tls-lvf-core">
        <div className="tls-lvf-photo">{children}</div>
        {oldCfg && (
          <span
            className="tls-lvf-art tls-lvf-art--old"
            data-loaded="1"
            data-rank={oldCfg.rank}
            data-testid="loewen-ascent-old"
            aria-hidden="true"
            style={{ "--lvf-scale": oldCfg.scale.toFixed(4), "--lvf-ox": oldCfg.ox.toFixed(4), "--lvf-oy": oldCfg.oy.toFixed(4) }}
          >
            <img className="tls-lvf-img" src={oldSources.src} srcSet={oldSources.srcSet} sizes={sizes} alt="" draggable="false" decoding="async" />
          </span>
        )}
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
            title={CROWN_LABELS[crown]}
            data-testid="avatar-crown"
            aria-hidden="true"
          >
            <CrownIcon variant={crown} />
          </span>
        )}
        {plate && (
          <span className="tls-lvf-plate" data-testid="level-frame-badge">
            {stars > 0 && <span className="tls-lvf-stars" role="img" aria-label={`Prestige ${stars}`}>{"★".repeat(stars)}</span>}
            <span className="tls-lvf-tag">{team ? `TEAM LVL ${shown}` : cfg.max ? "LVL 60 · MAX" : `LVL ${shown}`}</span>
            <span className="tls-lvf-pips" role="img" aria-label={`${cfg.name}: ${cfg.filled} von ${cfg.pips}`}>
              {Array.from({ length: cfg.pips }, (_, i) => (
                <i key={i} className={`tls-lvf-pip${i < cfg.filled ? " is-on" : ""}${pops.has(i) ? " is-pop" : ""}`} style={pops.has(i) ? { "--lvf-pop": pops.get(i) } : undefined} />
              ))}
            </span>
          </span>
        )}
      </div>
      {signature && (
        <Suspense fallback={null}>
          <LoewenRangSignature level={shown} fit={cfg.fit} scale={cfg.scale} ox={cfg.ox} oy={cfg.oy} ring={cfg.ring} burst={burst} onJolt={burst ? onJolt : null} />
        </Suspense>
      )}
    </div>
  );
}
