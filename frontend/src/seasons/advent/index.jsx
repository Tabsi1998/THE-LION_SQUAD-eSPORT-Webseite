import { useEffect, useId, useMemo, useRef, useState } from "react";
import { seasonYear } from "../rng";
import { useSeason } from "../SeasonContext";
import { adventSundays, candlesLit, daysToChristmas, todayIso } from "./calendar";
import { BERRY_TRIAD, CANDLE_WIDTH, RING, VIEW, adventLabel, candleBurn, daysLitFor, ringPoint, wreathLayout } from "./wreath";
import { CALM_MS, LIGHTING_MS, dueIgnitions, markIgnited } from "./ignition";
import "./advent.css";

// Adventkranz (Jahreszeiten II S6, #637; Advent & Winter W1, #727): vier Kerzen auf einem Ring aus Tannenzweigen
// neben dem Logo, angezündet je Adventsonntag - der Server sagt, wie viele brennen. Jede Kerze ist anders (Höhe,
// Neigung, Flammenfrequenz, Docht, Wachs), alles aus dem Jahres-Seed (C4). Der Wind des Wetters (`--season-wind`)
// bewegt Zweige und Flammen gemeinsam. Am Sonntag, an dem eine Kerze dazukommt, brennt sie beim ersten Aufruf des
// Tages sichtbar an (Streichholz-Schein, die Flamme fängt, dann eine ruhige Phase). Klick: „2. Advent – noch 13 Tage
// bis Weihnachten“. „Bewegung reduzieren“: Flammen stehen mit Schein, kein Wind; „dezent“: der Kranz ohne Wind.

export const ACCENT = "rgba(255, 176, 96, 0.28)";

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Was der Kranz wissen muss - aus der Antwort des Servers, sonst aus der Uhr (Vorschau, alte Antwort). */
export function adventData(season, now = new Date()) {
  const today = todayIso(now);
  const year = seasonYear({ key: "advent", starts_at: season?.starts_at || "" }, now);
  const data = season?.data || {};
  const sundays = Array.isArray(data.sundays) && data.sundays.length === 4 ? data.sundays.map((sunday) => String(sunday).slice(0, 10)) : adventSundays(year);
  const fromServer = number(data.candles);
  const candles = fromServer === null ? candlesLit(today, sundays) : Math.max(0, Math.min(4, Math.round(fromServer)));
  const days = number(data.days_to_christmas);
  return { year, today, sundays, candles, daysToChristmas: days === null ? daysToChristmas(today, year) : Math.max(0, Math.round(days)) };
}

function reducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && Boolean(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/** Eine Wachsspur an der Kerzenseite: ein schmaler Tropfen, der mit den Tagen länger wird. */
export function dripPath(x, y, length, side) {
  const s = side < 0 ? -1 : 1;
  const l = Math.max(0.5, length);
  return [
    `M ${x} ${y}`,
    `c ${s * 1.0} ${(l * 0.35).toFixed(2)}, ${s * 1.0} ${(l * 0.7).toFixed(2)}, ${s * 0.45} ${l.toFixed(2)}`,
    `c ${-s * 0.25} ${(l * 0.12).toFixed(2)}, ${-s * 0.75} ${(l * 0.12).toFixed(2)}, ${-s * 1.0} 0`,
    `c ${-s * 0.15} ${(-l * 0.35).toFixed(2)}, ${s * 0.1} ${(-l * 0.7).toFixed(2)}, ${s * 0.55} ${(-l).toFixed(2)}`,
    "z",
  ].join(" ");
}

function Cluster({ cluster }) {
  const base = ringPoint(cluster.angle);
  const lines = cluster.needles.map((needle, index) => {
    // Abwechselnd nach außen und nach innen, damit der Ring buschig wirkt; nach außen etwas länger.
    const outward = index % 2 === 0;
    const direction = ((cluster.angle + (outward ? needle.spread : 180 + needle.tilt)) * Math.PI) / 180;
    const length = outward ? needle.length * 1.15 : needle.length * 0.85;
    return <line key={index} x1={base.x} y1={base.y} x2={base.x + Math.cos(direction) * length} y2={base.y + Math.sin(direction) * length * 0.55} stroke={cluster.shade} strokeWidth="1" strokeLinecap="round" />;
  });
  return <g>{lines}</g>;
}

function Bow({ bow }) {
  const point = ringPoint(bow.angle);
  return (
    <g transform={`translate(${point.x} ${point.y}) rotate(${bow.tilt}) scale(${bow.size})`}>
      <ellipse cx="-2.4" cy="-0.6" rx="2.4" ry="1.5" fill="#b8262e" transform="rotate(-28)" />
      <ellipse cx="2.4" cy="-0.6" rx="2.4" ry="1.5" fill="#b8262e" transform="rotate(28)" />
      <ellipse cx="-2.2" cy="-0.9" rx="1.2" ry="0.5" fill="#d9454d" opacity="0.7" transform="rotate(-28)" />
      <ellipse cx="2.2" cy="-0.9" rx="1.2" ry="0.5" fill="#d9454d" opacity="0.7" transform="rotate(28)" />
      <path d="M -0.6 0.4 l -1.8 3.8 l 1.6 -0.5 z M 0.6 0.4 l 1.8 3.8 l -1.6 -0.5 z" fill="#9d1f27" />
      <circle cx="0" cy="0" r="1" fill="#d33a42" />
    </g>
  );
}

function Candle({ candle, lit, daysLit, lighting, calm, ids }) {
  const { burnDown, drip } = candleBurn(candle, daysLit);
  const height = candle.height - burnDown;
  const top = candle.y - height;
  const { x } = candle;
  const half = CANDLE_WIDTH / 2;
  const fireClass = `tls-advent__fire${lighting ? " tls-advent__fire--lighting" : ""}${calm ? " tls-advent__fire--calm" : ""}`;
  return (
    <g className={`tls-advent__candle${lit ? " tls-advent__candle--lit" : ""}`} transform={`rotate(${candle.lean} ${x} ${candle.y})`} data-testid="advent-candle" data-lit={lit ? "1" : "0"} data-index={candle.index + 1}>
      <ellipse cx={x} cy={candle.y + 0.5} rx={half + 1.4} ry="1.2" fill="#0f2a15" opacity="0.5" />
      <rect x={x - half} y={top} width={CANDLE_WIDTH} height={height} rx="0.8" fill={`url(#${ids}-wax-${candle.index})`} />
      <line x1={x - half + 0.8} y1={top + 1.2} x2={x - half + 0.8} y2={candle.y - 1} stroke="rgba(255, 255, 255, 0.35)" strokeWidth="0.55" strokeLinecap="round" />
      <ellipse cx={x} cy={top} rx={half} ry="0.9" fill="#fbf3e3" />
      <ellipse cx={x} cy={top} rx={half - 0.9} ry="0.45" fill="#eadcbf" opacity="0.6" />
      {drip > 0 && <path d={dripPath(x + candle.dripSide * (half - 0.6), top + 0.7, drip, candle.dripSide)} fill="#f4e8d0" opacity="0.95" />}
      <text x={x} y={candle.y - 1.5} textAnchor="middle" fontSize="3.2" fill="#8a7457" opacity="0.85" fontFamily="system-ui, sans-serif">{candle.index + 1}</text>
      <line x1={x} y1={top} x2={x} y2={top - 1.7} stroke={lit ? "#4a2f1a" : "#5f5a54"} strokeWidth="0.7" strokeLinecap="round" />
      {lit && (
        <g className={fireClass} style={{ "--flame-dur": `${candle.flameDuration}s`, "--flame-delay": `${candle.flameDelay}s`, "--flame-amp": candle.flameAmp, "--glow-dur": `${candle.glowDuration}s`, "--wick-glow": candle.wickGlow }} data-testid="advent-flame">
          <circle className="tls-advent__glow" cx={x} cy={top - 4.4} r="8.5" fill={`url(#${ids}-glow)`} />
          <circle className="tls-advent__ember" cx={x} cy={top - 1.6} r="0.55" fill="#ff9a3c" />
          <g className="tls-advent__flame" style={{ transformOrigin: `${x}px ${top - 1.4}px` }}>
            <ellipse cx={x} cy={top - 5} rx="1.9" ry="4.6" fill={`url(#${ids}-flame)`} />
            <ellipse cx={x} cy={top - 4.5} rx="1.15" ry="3.2" fill="#ffd27a" opacity="0.95" />
            <ellipse cx={x} cy={top - 3.8} rx="0.55" ry="1.8" fill="#fff8e6" />
            <ellipse cx={x} cy={top - 2.1} rx="0.95" ry="0.75" fill="#7fb2ff" opacity="0.55" />
          </g>
          {lighting && <circle className="tls-advent__match" cx={x} cy={top - 2} r="6" fill={`url(#${ids}-match)`} data-testid="advent-match" />}
        </g>
      )}
    </g>
  );
}

/** Der Kranz als SVG: Ring in zwei Grüntönen, Zweige hinten, Kerzen, Zweige vorne, Beeren zu dritt, Schleifen. */
export function Wreath({ layout, candles, daysLit = [], lighting = [], calm = [] }) {
  const ids = useId().replace(/[^a-zA-Z0-9]/g, "");
  const back = layout.clusters.filter((cluster) => !cluster.front);
  const front = layout.clusters.filter((cluster) => cluster.front);
  return (
    <svg className="tls-advent__svg" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} aria-hidden="true" data-year={layout.year}>
      <defs>
        {layout.candles.map((candle) => (
          <linearGradient key={candle.index} id={`${ids}-wax-${candle.index}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fdf7ea" />
            <stop offset="0.4" stopColor={candle.tint} />
            <stop offset="1" stopColor="#cdb48c" />
          </linearGradient>
        ))}
        <radialGradient id={`${ids}-flame`} cx="50%" cy="68%" r="60%">
          <stop offset="0" stopColor="#fff1c2" />
          <stop offset="0.55" stopColor="#ffb13b" />
          <stop offset="1" stopColor="#ff7a1a" stopOpacity="0.85" />
        </radialGradient>
        <radialGradient id={`${ids}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="rgba(255, 184, 96, 0.55)" />
          <stop offset="0.6" stopColor="rgba(255, 170, 80, 0.16)" />
          <stop offset="1" stopColor="rgba(255, 160, 70, 0)" />
        </radialGradient>
        <radialGradient id={`${ids}-match`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="rgba(255, 225, 160, 0.95)" />
          <stop offset="1" stopColor="rgba(255, 190, 110, 0)" />
        </radialGradient>
      </defs>
      <ellipse cx={RING.cx} cy={RING.cy + 0.8} rx={RING.rx} ry={RING.ry} fill="none" stroke="#12331a" strokeWidth="7" opacity="0.95" />
      <ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} fill="none" stroke="#24552d" strokeWidth="4.5" />
      <g className="tls-advent__branches tls-advent__branches--back">
        {back.map((cluster, index) => <Cluster key={index} cluster={cluster} />)}
      </g>
      {layout.candles.map((candle) => (
        <Candle key={candle.index} candle={candle} lit={candle.index < candles} daysLit={daysLit[candle.index]} lighting={lighting.includes(candle.index)} calm={calm.includes(candle.index)} ids={ids} />
      ))}
      <g className="tls-advent__branches tls-advent__branches--front">
        {front.map((cluster, index) => <Cluster key={index} cluster={cluster} />)}
        {layout.berries.map((berry, index) => {
          const point = ringPoint(berry.angle, { ...RING, rx: RING.rx * berry.inset, ry: RING.ry * berry.inset });
          const turn = (berry.turn * Math.PI) / 180;
          return (
            <g key={index}>
              {BERRY_TRIAD.map(([dx, dy], n) => {
                const ox = (dx * Math.cos(turn) - dy * Math.sin(turn)) * berry.radius;
                const oy = (dx * Math.sin(turn) + dy * Math.cos(turn)) * berry.radius * 0.7;
                return <circle key={n} cx={point.x + ox} cy={point.y + oy} r={berry.radius * 0.72} fill="#c8323a" stroke="#7d151c" strokeWidth="0.25" />;
              })}
            </g>
          );
        })}
        {layout.bows.map((bow, index) => <Bow key={index} bow={bow} />)}
      </g>
    </svg>
  );
}

/** Der Kranz neben dem Logo (Slot `SeasonWidgetSlot`): klickbar, mit Tastatur erreichbar, Text als Hinweis. */
export function Widget({ season, now = null, storage = typeof window === "undefined" ? null : window.localStorage }) {
  const info = useMemo(() => adventData(season, now || new Date()), [season, now]);
  const layout = useMemo(() => wreathLayout(info.year), [info.year]);
  const daysLit = useMemo(() => daysLitFor(info.sundays, info.candles, info.today), [info.sundays, info.candles, info.today]);
  const [open, setOpen] = useState(false);
  const [lighting, setLighting] = useState([]);
  const [calm, setCalm] = useState([]);
  const noteTimer = useRef(0);
  const timers = useRef([]);
  useEffect(() => () => {
    window.clearTimeout(noteTimer.current);
    timers.current.forEach((handle) => window.clearTimeout(handle));
  }, []);
  // Anzünden am Sonntag der Kerze - einmal je Tag (Speicher); ohne Bewegung brennt sie einfach.
  useEffect(() => {
    const due = dueIgnitions({ year: info.year, sundays: info.sundays, candles: info.candles, today: info.today, storage });
    if (!due.length) return undefined;
    due.forEach((index) => markIgnited(storage, info.year, index, info.today));
    if (reducedMotion()) return undefined;
    setLighting(due);
    const first = window.setTimeout(() => {
      setLighting([]);
      setCalm(due);
    }, LIGHTING_MS);
    const second = window.setTimeout(() => setCalm([]), LIGHTING_MS + CALM_MS);
    timers.current.push(first, second);
    return undefined;
  }, [info.year, info.sundays, info.candles, info.today, storage]);
  // Läuft der Adventkalender (#641), sagt der Kranz auch, welches Türchen offen ist.
  const calendar = useSeason().byKey?.advent_calendar?.data;
  const door = calendar?.ready && !calendar.catch_up ? Math.round(Number(calendar.today_door) || 0) : 0;
  const label = door > 0 ? `${adventLabel(info)} · Türchen ${door} ist offen` : adventLabel(info);
  const onClick = () => {
    setOpen(true);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setOpen(false), 4000);
  };
  const subtle = season?.effective === "subtle";
  return (
    <span className={`relative tls-advent${subtle ? " tls-advent--subtle" : ""}`} data-testid="advent-widget" data-candles={info.candles}>
      <button type="button" onClick={onClick} className={`tls-advent__button${open ? " tls-advent__button--open" : ""}`} aria-label={label} title={label} data-testid="advent-wreath">
        <Wreath layout={layout} candles={info.candles} daysLit={daysLit} lighting={lighting} calm={calm} />
      </button>
      {open && <span className="tls-advent__note" role="status" data-testid="advent-note">{label}</span>}
    </span>
  );
}

export const season = { key: "advent", accent: ACCENT, Widget };
