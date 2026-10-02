import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { MascotBadge } from "@/components/tls/Logo";
import { Flame, FlameDefs } from "../advent/flame";
import { CLUB_PALETTE } from "../carnival/confetti";
import { createConfettiLayer, requestBurst } from "../carnival/layer";
import { readPreviewToken } from "../preview";
import { openSpot } from "../space";
import { hashString, seasonYear } from "../rng";
import { useSeason } from "../SeasonContext";
import { markToastShown, toastShownToday } from "../SeasonStage";
import { BOTTOM, CAKE_VIEW, CLUB, PLATE, TOP, cakePlan, ignitionOrder } from "./cake";
import { GARLAND_PAD, SAGS, garlandPlan, garlandSpan, pennants, probePoints, stringPath } from "./garland";
import { StickerClaim } from "./StickerClaim";
import "./birthday.css";

// Vereinsgeburtstag (Jahreszeiten III S13 #644; B1–B3 #749–#751): am Gründungstag „X Jahre THE LION SQUAD“. Einmal am
// Tag kommt die Karte mit der Torte - Kerzen nach Jahren, die eine nach der anderen angehen, vorne das Maskottchen auf
// der Zuckerplatte; sind alle an, fliegt Konfetti in Vereinsfarben aus der Torte. Mitglieder holen sich dort ihren
// Jahres-Sticker. Unter der Kopfzeile hängen Wimpelketten, die sich beim ersten Aufruf des Tages entfalten und danach
// kaum bewegen. „dezent“ und „Bewegung reduzieren“: die Kerzen brennen gleich, kein Konfetti, die Ketten hängen still.

export const GREETING_KEY = "club-birthday-greeting";
export const UNFOLD_KEY = "tls-birthday-unfold";
export const CARD_DELAY_MS = 1200;
export const CARD_MS = 20000;
export const IGNITE_DELAY_MS = 700;
export const IGNITE_STEP_MS = 220;
export const LIGHTING_MS = 1500;
const BURST = 34;
const CARD_CAKE_WIDTH = 172;

/**
 * Der Text unter „8 Jahre“: der Gruß aus dem Admin - beginnt er selbst mit den Jahren („8 Jahre THE LION SQUAD –
 * danke …“), steht nur der Rest da, damit nichts doppelt steht. Ein eigener Text bleibt ganz.
 */
export function cardText(greeting, years) {
  const text = String(greeting || "").trim();
  const lead = `${years} Jahr`;
  if (!years || !text.toLowerCase().startsWith(lead.toLowerCase())) return text;
  const dash = text.search(/\s[–-]\s/);
  const rest = dash > 0 ? text.slice(dash + 3).trim() : "";
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : text;
}

export function yearOf(season) {
  return seasonYear({ key: "club_birthday", starts_at: season?.starts_at || "" });
}

export function yearsOf(season) {
  const years = Number(season?.data?.years);
  return Number.isFinite(years) && years > 0 ? Math.round(years) : null;
}

/** Konfetti nur aus der Torte (kein Regen), in Vereinsfarben - und nur mit Bewegung und Budget. */
export function skyLayers({ season, budget = 0, reducedMotion = false }) {
  if (reducedMotion || season.effective === "subtle" || !budget) return [];
  return [createConfettiLayer({ budget, effective: season.effective, seed: hashString(`birthday:${yearOf(season)}`), palette: CLUB_PALETTE, burst: BURST })];
}

/** Einmal am Tag je Gerät (das Entfalten) - in der Vorschau jedes Mal, ohne den Tag zu verbrauchen. */
export function firstTimeToday(key, storage = typeof window === "undefined" ? null : window.localStorage, now = new Date()) {
  if (readPreviewToken()) return true;
  const pad = (value) => String(value).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  try {
    if (storage?.getItem(key) === day) return false;
    storage?.setItem(key, day);
    return true;
  } catch {
    return true;
  }
}

function Candle({ candle, lit, lighting, ids }) {
  const top = candle.base - candle.height;
  const { x } = candle;
  return (
    <g transform={`rotate(${candle.lean} ${x} ${candle.base})`} data-testid="birthday-candle" data-lit={lit ? "1" : "0"}>
      <rect x={x - 1.3} y={top} width="2.6" height={candle.height} rx="0.6" fill={`url(#${ids}-stripe-${candle.stripe})`} stroke="rgba(0, 0, 0, 0.25)" strokeWidth="0.2" />
      <line x1={x} y1={top} x2={x} y2={top - 1.3} stroke={lit ? "#3b2414" : "#5f5a54"} strokeWidth="0.55" strokeLinecap="round" />
      {lit && (
        <g transform={`translate(${x} ${top}) scale(0.72) translate(${-x} ${-top})`}>
          <Flame x={x} top={top} ids={ids} look={candle} lighting={lighting} testId="birthday-flame" matchTestId="birthday-match" />
        </g>
      )}
    </g>
  );
}

function NumberCandle({ candle, lit, lighting, ids }) {
  const top = candle.base - 14.2;
  const { x } = candle;
  return (
    <g transform={`rotate(${candle.lean} ${x} ${candle.base})`} data-testid="birthday-candle" data-lit={lit ? "1" : "0"} data-digit={candle.digit}>
      <text x={x} y={candle.base} textAnchor="middle" fontSize="19" fontWeight="900" fontFamily="system-ui, sans-serif" fill={`url(#${ids}-wax-${candle.color})`} stroke="#0b2233" strokeWidth="0.6" paintOrder="stroke">{candle.digit}</text>
      <line x1={x} y1={top} x2={x} y2={top - 1.4} stroke={lit ? "#3b2414" : "#5f5a54"} strokeWidth="0.6" strokeLinecap="round" />
      {lit && (
        <g transform={`translate(${x} ${top}) scale(0.8) translate(${-x} ${-top})`}>
          <Flame x={x} top={top} ids={ids} look={candle} lighting={lighting} testId="birthday-flame" matchTestId="birthday-match" />
        </g>
      )}
    </g>
  );
}

/** Die Torte als SVG; `lit` und `lighting` sind Mengen von Kerzen-Indizes. Das Maskottchen liegt als Bild darüber. */
export function Cake({ plan, lit = new Set(), lighting = new Set(), width = CARD_CAKE_WIDTH }) {
  const ids = `tls-cake-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const height = (width * CAKE_VIEW.height) / CAKE_VIEW.width;
  // Das Maskottchen ganz in der Zuckerplatte: ein Quadrat, das in den Kreis passt - nichts wird beschnitten.
  const plateSize = ((PLATE.r * Math.SQRT2) / CAKE_VIEW.width) * width;
  return (
    <div className="tls-birthday-cake" style={{ width, height }} data-testid="birthday-cake" data-years={plan.years}>
      <svg viewBox={`0 0 ${CAKE_VIEW.width} ${CAKE_VIEW.height}`} width={width} height={height} aria-hidden="true">
        <defs>
          <FlameDefs ids={ids} />
          <linearGradient id={`${ids}-low`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#0a1e2c" />
            <stop offset="0.45" stopColor="#123f59" />
            <stop offset="1" stopColor="#081822" />
          </linearGradient>
          <linearGradient id={`${ids}-high`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#e6e0d4" />
            <stop offset="0.4" stopColor={CLUB.white} />
            <stop offset="1" stopColor="#d4ccbd" />
          </linearGradient>
          <linearGradient id={`${ids}-gold`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffe66b" />
            <stop offset="1" stopColor="#d9a900" />
          </linearGradient>
          <linearGradient id={`${ids}-cyan`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#7fd6f5" />
            <stop offset="1" stopColor={CLUB.cyan} />
          </linearGradient>
          <linearGradient id={`${ids}-wax-cyan`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#bfeaf9" />
            <stop offset="0.5" stopColor={CLUB.cyan} />
            <stop offset="1" stopColor="#1c86ab" />
          </linearGradient>
          <linearGradient id={`${ids}-wax-gold`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff2a8" />
            <stop offset="0.5" stopColor={CLUB.gold} />
            <stop offset="1" stopColor="#c9a800" />
          </linearGradient>
          {["cyan", "gold"].map((name) => (
            <pattern key={name} id={`${ids}-stripe-${name}`} width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
              <rect width="2.4" height="2.4" fill="#fbf7ef" />
              <rect width="1" height="2.4" fill={CLUB[name]} />
            </pattern>
          ))}
        </defs>
        <ellipse cx="60" cy="95" rx="53" ry="6.5" fill="#141a26" />
        <ellipse cx="60" cy="94" rx="51" ry="5.6" fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="0.6" />
        <path d={`M ${BOTTOM.cx - BOTTOM.rx} ${BOTTOM.y} L ${BOTTOM.cx - BOTTOM.rx} ${BOTTOM.y + BOTTOM.height} A ${BOTTOM.rx} ${BOTTOM.ry} 0 0 0 ${BOTTOM.cx + BOTTOM.rx} ${BOTTOM.y + BOTTOM.height} L ${BOTTOM.cx + BOTTOM.rx} ${BOTTOM.y} Z`} fill={`url(#${ids}-low)`} />
        {plan.band === "dots"
          ? Array.from({ length: 13 }, (_, i) => <circle key={i} cx={22 + i * 6.3} cy={BOTTOM.y + BOTTOM.height + 3.4 - Math.abs(6 - i) * 0.35} r="1.1" fill={CLUB.white} opacity="0.9" />)
          : <polyline points={Array.from({ length: 15 }, (_, i) => `${20 + i * 5.7},${BOTTOM.y + BOTTOM.height + (i % 2 ? 1.2 : 4.2) - Math.abs(7 - i) * 0.3}`).join(" ")} fill="none" stroke={CLUB.cyan} strokeWidth="1.1" strokeLinejoin="round" />}
        <path d={plan.bottomDrips} fill={`url(#${ids}-gold)`} />
        <path d={`M ${TOP.cx - TOP.rx} ${TOP.y} L ${TOP.cx - TOP.rx} ${TOP.y + TOP.height} A ${TOP.rx} ${TOP.ry} 0 0 0 ${TOP.cx + TOP.rx} ${TOP.y + TOP.height} L ${TOP.cx + TOP.rx} ${TOP.y} Z`} fill={`url(#${ids}-high)`} />
        <path d={plan.topDrips} fill={`url(#${ids}-cyan)`} />
        {plan.sprinkles.map((dot, index) => <rect key={index} x={dot.x - 0.9} y={dot.y - 0.3} width="1.8" height="0.6" rx="0.3" fill={dot.color} transform={`rotate(${dot.angle} ${dot.x} ${dot.y})`} />)}
        {/* Die Zuckerplatte ist dunkel: das Maskottchen ist hell und soll unverändert darauf stehen. */}
        <circle cx={PLATE.cx} cy={PLATE.cy} r={PLATE.r} fill="#0b1520" stroke={`url(#${ids}-gold)`} strokeWidth="1.6" />
        {plan.candles.map((candle) => <Candle key={candle.index} candle={candle} lit={lit.has(candle.index)} lighting={lighting.has(candle.index)} ids={ids} />)}
        {plan.digits.map((candle) => <NumberCandle key={candle.index} candle={candle} lit={lit.has(candle.index)} lighting={lighting.has(candle.index)} ids={ids} />)}
      </svg>
      <span className="tls-birthday-cake__plate" style={{ left: `${((PLATE.cx / CAKE_VIEW.width) * width) - plateSize / 2}px`, top: `${((PLATE.cy / CAKE_VIEW.height) * height) - plateSize / 2}px`, width: plateSize, height: plateSize }}>
        <MascotBadge className="w-full h-full" />
      </span>
    </div>
  );
}

/** Kerzen nacheinander anzünden; `onDone`, wenn alle brennen. Ohne Bewegung brennen alle sofort, ohne Feier. */
export function useIgnition(plan, moving, onDone) {
  const items = plan.numbers ? plan.digits : plan.candles;
  const [lit, setLit] = useState(() => (moving ? new Set() : new Set(items.map((item) => item.index))));
  const [lighting, setLighting] = useState(() => new Set());
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!moving) {
      setLit(new Set(items.map((item) => item.index)));
      return undefined;
    }
    const timers = [];
    const order = ignitionOrder(plan, IGNITE_STEP_MS);
    order.forEach(({ index, at }) => {
      timers.push(window.setTimeout(() => {
        setLit((current) => new Set(current).add(index));
        setLighting((current) => new Set(current).add(index));
      }, IGNITE_DELAY_MS + at));
      timers.push(window.setTimeout(() => setLighting((current) => {
        const next = new Set(current);
        next.delete(index);
        return next;
      }), IGNITE_DELAY_MS + at + LIGHTING_MS));
    });
    const last = order.length ? order[order.length - 1].at : 0;
    timers.push(window.setTimeout(() => done.current?.(), IGNITE_DELAY_MS + last + 500));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, moving]);
  return { lit, lighting };
}

/** Die Karte einmal am Tag: Torte, Jahre, der Gruß aus dem Admin, der Jahres-Sticker für Mitglieder. */
export function Toast({ season }) {
  const { reducedMotion } = useSeason();
  const moving = season.effective !== "subtle" && !reducedMotion;
  const [open, setOpen] = useState(false);
  const cakeRef = useRef(null);
  const years = yearsOf(season);
  const plan = useMemo(() => cakePlan(years, yearOf(season)), [years, season]);
  const [cakeWidth] = useState(() => (typeof window !== "undefined" && window.innerWidth < 420 ? 124 : CARD_CAKE_WIDTH));
  const greeting = season.texts?.greeting || (years ? `${years} Jahre THE LION SQUAD – danke, dass ihr dabei seid` : "Der Verein hat Geburtstag – danke, dass ihr dabei seid");
  useEffect(() => {
    if (typeof window === "undefined" || toastShownToday(GREETING_KEY)) return undefined;
    const show = window.setTimeout(() => {
      markToastShown(GREETING_KEY);
      setOpen(true);
    }, CARD_DELAY_MS);
    return () => window.clearTimeout(show);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const hide = window.setTimeout(() => setOpen(false), CARD_MS);
    return () => window.clearTimeout(hide);
  }, [open]);
  const celebrate = () => {
    // Alle Kerzen brennen: Konfetti aus der Torte, links und rechts.
    const box = cakeRef.current?.getBoundingClientRect();
    if (!box || !moving) return;
    requestBurst({ x: box.left + box.width * 0.3, y: box.top + box.height * 0.3 });
    requestBurst({ x: box.left + box.width * 0.7, y: box.top + box.height * 0.3 });
  };
  if (!open) return null;
  return (
    <div className="tls-season-toast tls-birthday-card" role="status" data-testid="birthday-card">
      <div ref={cakeRef} className="tls-birthday-card__cake">
        <IgnitedCake plan={plan} moving={moving} onDone={celebrate} width={cakeWidth} />
      </div>
      <div className="tls-birthday-card__body">
        <div className="tls-birthday-card__eyebrow">Vereinsgeburtstag</div>
        <div className="tls-birthday-card__years">{years ? `${years} ${years === 1 ? "Jahr" : "Jahre"}` : "Geburtstag"}</div>
        <p className="tls-birthday-card__text">{cardText(greeting, years)}</p>
        <StickerClaim />
      </div>
      <button type="button" className="tls-birthday-card__close" onClick={() => setOpen(false)} aria-label="Gruß schließen">×</button>
    </div>
  );
}

function IgnitedCake({ plan, moving, onDone, width }) {
  const { lit, lighting } = useIgnition(plan, moving, onDone);
  return <Cake plan={plan} lit={lit} lighting={lighting} width={width} />;
}

/** Eine Kette: Faden und Wimpel; beim ersten Aufruf des Tages entfalten sie sich, danach wehen sie kaum. */
function Garland({ chain, span, top, sag, unfold, moving }) {
  const list = pennants(chain, span.x0, span.x1, top, sag);
  const d = stringPath(span.x0, span.x1, top, sag);
  const length = Math.round((span.x1 - span.x0) * 1.15 + sag);
  // Nur so groß wie die Kette selbst; der Ausschnitt rechnet weiter in Seitenkoordinaten.
  const box = { x: Math.floor(span.x0 - GARLAND_PAD), y: Math.floor(top - 2), width: Math.ceil(span.x1 - span.x0 + GARLAND_PAD * 2), height: Math.ceil(sag + chain.size + GARLAND_PAD + 2) };
  return (
    <svg className={`tls-garland${unfold ? " tls-garland--unfold" : ""}${moving ? " tls-garland--sway" : ""}`} style={{ left: box.x, top: box.y, "--length": length, animationDelay: `${chain.delay}ms` }} width={box.width} height={box.height} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} data-testid="birthday-garland">
      <path className="tls-garland__string" d={d} fill="none" stroke="rgba(255, 255, 255, 0.55)" strokeWidth="1.1" />
      {list.map((pennant) => (
        <g key={pennant.index} transform={`translate(${pennant.x} ${pennant.y}) rotate(${pennant.angle})`}>
          <path className="tls-garland__pennant" style={{ "--i": pennant.index, "--sway": `${chain.sway}s` }} d={`M ${-chain.size / 2} 0 L ${chain.size / 2} 0 L 0 ${chain.size} Z`} fill={pennant.color} stroke="rgba(0, 0, 0, 0.25)" strokeWidth="0.6" data-testid="birthday-pennant" />
        </g>
      ))}
    </svg>
  );
}

/**
 * Wimpelketten unter der Kopfzeile (Seitenkoordinaten - sie scrollen mit): je Seite eine, so tief wie möglich, aber nie
 * über Schrift, Bildern, Bedienelementen oder Kästen (dieselbe Probe wie die Luftschlangen am Fasching).
 */
export function Corners({ season }) {
  const location = useLocation();
  const { reducedMotion } = useSeason();
  const moving = season.effective !== "subtle" && !reducedMotion;
  const plan = useMemo(() => garlandPlan(yearOf(season), location.pathname), [season, location.pathname]);
  const [placed, setPlaced] = useState([]);
  const [unfold] = useState(() => moving && firstTimeToday(UNFOLD_KEY));
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const measure = () => {
      const header = document.querySelector("header");
      const viewTop = header ? header.getBoundingClientRect().bottom : 0;
      const width = document.documentElement.clientWidth || window.innerWidth;
      const column = header?.firstElementChild?.getBoundingClientRect() || null;
      const next = [];
      for (const chain of plan) {
        const span = garlandSpan(chain, width, column);
        if (span.x1 - span.x0 < 60) continue;
        const sag = SAGS.find((depth) => probePoints(chain, span.x0, span.x1, viewTop + 2, depth).every((point) => openSpot(document, point.x, point.y, width)));
        if (sag) next.push({ chain, span, sag, top: viewTop + 2 + (window.scrollY || 0) });
      }
      setPlaced(next);
    };
    const timer = window.setTimeout(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [plan]);
  if (!placed.length || typeof document === "undefined") return null;
  return createPortal(
    <div className="tls-garlands" aria-hidden="true" data-testid="birthday-garlands">
      {placed.map(({ chain, span, sag, top }) => <Garland key={chain.side} chain={chain} span={span} top={top} sag={sag} unfold={unfold} moving={moving} />)}
    </div>,
    document.body,
  );
}

export const season = { key: "club_birthday", Corners, Toast, skyLayers };
