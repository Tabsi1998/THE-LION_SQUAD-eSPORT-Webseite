import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { measureAnchors } from "../anchors";
import { BAND_HEIGHT, COLORS, FOOTER_FREE, FOOTER_OFFSET, GLOW, GLOW_FACTOR, HEADER_BAND, MIN_WIDTH, chainLayout } from "./lights";
import { SWING } from "./swing";

// Die Lichterkette an echten Kanten (X1, #734): unter der Kopfzeile in deren freier Unterkante (klebt sie oben, hängt
// die Kette am Fenster) und oben in der Fußzeile, wenn dort genug freier Abstand ist. Nie über Menü, Logo, Knöpfen
// oder Schrift: was in das Bild der Kette ragt (Draht, Lämpchen, Schein), wird zur Lücke ohne Lämpchen; nie klickbar. Der Wind (`--season-wind`) lässt die Kette minimal schwingen; ohne Bewegung
// hängt sie still und leuchtet ruhig. Seit Jahreszeiten IV (#1091) hängen Ketten auch an Karten (CardChains.jsx) und
// schwingen dort nach, wenn sich ihre Karte hebt - dieselbe Kette (`Chain`), nur mit `swing`.

const REFRESH_DELAYS = [300, 1200, 3000];
/** Was im Bild der Kette eine Lücke erzwingt: Bilder und Bedienung mit ihrem Kasten - und jedes Element mit eigener Schrift. */
const CONTROL_SELECTOR = "img, picture, video, svg, canvas, button, a, input, select, textarea, label, time, [role='img'], [role='button']";
/** Abstand eines Lämpchens zu einem Kasten: sein Schein plus ein wenig Luft. */
const GAP_MARGIN = GLOW + 3;

function hasOwnText(node) {
  return Array.from(node.childNodes || []).some((child) => child.nodeType === 3 && child.textContent.trim().length > 0);
}

/** Je Lämpchen die Custom Properties für Glimmen und Flackern - Schein und Kolben teilen sich denselben Takt. */
function bulbVars(bulb) {
  return { "--glow-dur": `${bulb.glowDuration}s`, "--glow-delay": `${bulb.glowDelay}s`, "--brightness": bulb.brightness, "--flicker-delay": `${bulb.flickerDelay}s` };
}

/**
 * Ein Lämpchen hängt in einer eigenen Gruppe (`tls-lights__hang`): beim Nachschwingen (#1091) zieht der Durchhang sie
 * um `--h` mit und sie pendelt um ihre Fassung. Ohne Schwingen bleibt die Gruppe, wo sie ist.
 */
function hangStyle(bulb, swing) {
  const plan = swing && swing.plan ? swing.plan.bulbs.find((entry) => entry.index === bulb.index) : null;
  return { transformOrigin: `${bulb.x}px ${(bulb.y - bulb.radius - 1).toFixed(1)}px`, ...(plan ? { "--h": `${plan.h}px`, "--tilt": `${plan.tilt}deg` } : {}) };
}

/** Der Schein eines Lämpchens - unter dem Draht, wie in der App. */
function BulbGlow({ bulb, ids, swing }) {
  const blink = swing && swing.plan && swing.plan.blink === bulb.index;
  return (
    <g className="tls-lights__hang" style={hangStyle(bulb, swing)}>
      <circle className={`tls-lights__glow${bulb.flicker ? " tls-lights__glow--flicker" : ""}${blink ? " tls-lights__glow--blink" : ""}`} style={bulbVars(bulb)} cx={bulb.x} cy={bulb.y} r={Math.min(GLOW, bulb.radius * GLOW_FACTOR)} fill={`url(#${ids}-glow-${bulb.color})`} />
    </g>
  );
}

/** Fassung, Kolben und Glanz: Glimmen und Flackern über Custom Properties je Lämpchen. */
function Bulb({ bulb, swing }) {
  const color = COLORS[bulb.color] || COLORS.warm;
  const blink = swing && swing.plan && swing.plan.blink === bulb.index;
  return (
    <g className="tls-lights__hang" style={hangStyle(bulb, swing)}>
      <g className={`tls-lights__bulb${bulb.flicker ? " tls-lights__bulb--flicker" : ""}${blink ? " tls-lights__bulb--blink" : ""}`} style={bulbVars(bulb)} data-testid="christmas-bulb" data-color={bulb.color} data-blink={blink ? "1" : undefined}>
        <rect x={bulb.x - 1.1} y={bulb.y - bulb.radius - 1.6} width="2.2" height="1.8" rx="0.4" fill="#2a2a2a" />
        <ellipse className="tls-lights__bulbBody" cx={bulb.x} cy={bulb.y} rx={bulb.radius * 0.85} ry={bulb.radius} fill={color} />
        <ellipse cx={bulb.x - bulb.radius * 0.3} cy={bulb.y - bulb.radius * 0.35} rx={bulb.radius * 0.28} ry={bulb.radius * 0.4} fill="rgba(255, 255, 255, 0.55)" />
      </g>
    </g>
  );
}

/**
 * Eine Kette als SVG: Scheine, Draht mit Stielen, Nägel, Lämpchen. `swing` (#1091): die Kette schwingt nach - {kind:
 * „lift“ | „leave“, n, plan} -, der Draht hängt tiefer und federt (Keyframes in christmas.css), die Lämpchen pendeln,
 * eines flackert. `card` ist der Kartenschlüssel einer Kette an einer Karte: sie fährt dann mit der Karte hoch.
 */
export function Chain({ chain, layout, swing = null, card = null, testId = "christmas-lights", hidden = false }) {
  const ids = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rig = swing ? `tls-lights__rig tls-lights--swing tls-lights--swing-${swing.kind}` : "tls-lights__rig";
  return (
    <svg
      className={`tls-lights__chain tls-lights__chain--${chain.anchor}${hidden ? " tls-lights__chain--yield" : ""}`}
      style={{ position: chain.fixed ? "fixed" : "absolute", left: `${chain.x.toFixed(1)}px`, top: `${chain.y.toFixed(1)}px`, width: `${layout.width}px`, height: `${layout.height}px` }}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      data-testid={testId}
      data-anchor={chain.anchor}
      data-bulbs={layout.bulbs.length}
      data-gaps={chain.gaps.length}
      data-season-card={card || undefined}
      data-swing={swing ? swing.kind : undefined}
      data-yield={hidden ? "1" : undefined}
    >
      <defs>
        {Object.entries(COLORS).map(([name, hex]) => (
          <radialGradient key={name} id={`${ids}-glow-${name}`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor={hex} stopOpacity="0.55" />
            <stop offset="0.5" stopColor={hex} stopOpacity="0.16" />
            <stop offset="1" stopColor={hex} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {/* Dieselbe Gruppe bleibt - sonst begänne das Glimmen aller Lämpchen neu. Anheben und Loslassen haben eigene
          Keyframes, damit das zweite Schwingen von vorn beginnt. */}
      <g className={rig} style={swing ? { "--amp": swing.kind === "leave" ? SWING.leave : 1, "--swing-ms": `${SWING.ms}ms` } : undefined}>
        {layout.bulbs.map((bulb) => <BulbGlow key={bulb.index} bulb={bulb} ids={ids} swing={swing} />)}
        <g className="tls-lights__wire">
          <path d={layout.wire} fill="none" stroke="#2f2f2f" strokeWidth="1.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={layout.wire} fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="0.5" strokeLinecap="round" transform="translate(0 -0.6)" vectorEffect="non-scaling-stroke" />
          {layout.bulbs.map((bulb) => <line key={bulb.index} x1={bulb.x} y1={bulb.wire} x2={bulb.x} y2={bulb.y - bulb.radius} stroke="#3b3b3b" strokeWidth="1.1" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
        </g>
        {layout.nails.map((x, index) => <circle key={index} cx={x} cy="1.2" r="1.3" fill="#8a8a8a" />)}
        {layout.bulbs.map((bulb) => <Bulb key={bulb.index} bulb={bulb} swing={swing} />)}
      </g>
    </svg>
  );
}

/** Was die Kette sperren kann: Bilder und Bedienung, dazu jedes Element mit eigener Schrift (gleich welches Tag). */
function blockers(element) {
  if (!element || typeof element.querySelectorAll !== "function") return [];
  return Array.from(element.querySelectorAll("*")).filter((node) => typeof node.getBoundingClientRect === "function" && ((typeof node.matches === "function" && node.matches(CONTROL_SELECTOR)) || hasOwnText(node)));
}

/**
 * Lücken: was im Anker in das Bild der Kette ragt (von `top` bis `bottom`, Fensterkoordinaten - Draht, Lämpchen und
 * Schein) - als x-Bereiche in Ketten-Koordinaten, mit dem Schein als Abstand.
 */
export function bandGaps(element, { top, bottom, left }) {
  const gaps = [];
  blockers(element).forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.bottom <= top || rect.top >= bottom) return;
    gaps.push([rect.left - left - GAP_MARGIN, rect.right - left + GAP_MARGIN]);
  });
  // Überlappende Lücken (Logo im Link) zu einer zusammenfassen.
  gaps.sort((a, b) => a[0] - b[0]);
  return gaps.reduce((merged, gap) => {
    const last = merged[merged.length - 1];
    if (last && gap[0] <= last[1]) last[1] = Math.max(last[1], gap[1]);
    else merged.push([gap[0], gap[1]]);
    return merged;
  }, []);
}

/** Wie viel freier Abstand oben im Anker liegt, bevor Schrift, Bild oder Bedienung beginnt (px; ohne Inhalt unendlich). */
export function freeTop(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return 0;
  const top = element.getBoundingClientRect().top;
  const first = blockers(element).map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0).reduce((min, rect) => Math.min(min, rect.top), Infinity);
  return first - top;
}

/**
 * Ketten an Kopfzeile (`header`) und Fußzeile (`footer`, wenn erlaubt). `salt` ist das Jahres-Salz; `width` unter
 * MIN_WIDTH: keine Kette (Kopfzeile zu niedrig).
 */
export function LightChain({ salt = "", footer = true, width = typeof window === "undefined" ? 1280 : window.innerWidth }) {
  const [chains, setChains] = useState([]);
  const chainsRef = useRef([]);
  useEffect(() => {
    chainsRef.current = [];
    setChains([]);
    if (typeof document === "undefined" || width < MIN_WIDTH) return undefined;
    const win = window;
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      const anchors = measureAnchors(document, win, { kinds: footer ? ["header", "footer"] : ["header"], minSize: { header: [200, 56], footer: [400, 120] } });
      const next = anchors.map((anchor) => {
        const rect = anchor.rect;
        const isHeader = anchor.kind === "header";
        const fixed = isHeader && anchor.fixed;
        const scrollX = fixed ? 0 : win.scrollX || 0;
        const scrollY = fixed ? 0 : win.scrollY || 0;
        // Kopfzeile: in den untersten 16 px über der Unterkante; Fußzeile: direkt unter der Oberkante, aber nur, wenn
        // der freie Abstand darunter für Draht, Lämpchen und Schein reicht - sonst hängt dort keine Kette.
        if (!isHeader && freeTop(anchor.element) < FOOTER_FREE) return null;
        const bandTop = isHeader ? rect.bottom - HEADER_BAND : rect.top + FOOTER_OFFSET;
        const gaps = bandGaps(anchor.element, { top: bandTop - 2, bottom: bandTop + BAND_HEIGHT + GLOW, left: rect.left });
        return { anchor: anchor.kind, key: anchor.key, fixed, x: rect.left + scrollX, y: bandTop + scrollY, width: rect.width, gaps };
      }).filter(Boolean);
      const current = chainsRef.current;
      const same = next.length === current.length && next.every((chain, index) => chain.key === current[index].key && chain.x === current[index].x && chain.y === current[index].y && chain.width === current[index].width && JSON.stringify(chain.gaps) === JSON.stringify(current[index].gaps));
      if (!same) {
        chainsRef.current = next;
        setChains(next);
      }
    };
    const timers = REFRESH_DELAYS.map((ms) => win.setTimeout(refresh, ms));
    let debounce = 0;
    const onLayout = () => {
      win.clearTimeout(debounce);
      debounce = win.setTimeout(refresh, 200);
    };
    win.addEventListener("resize", onLayout);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onLayout) : null;
    observer?.observe(document.body);
    let settle = 0;
    const onScroll = () => {
      win.clearTimeout(settle);
      settle = win.setTimeout(refresh, 250);
    };
    win.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelled = true;
      timers.forEach((timer) => win.clearTimeout(timer));
      win.clearTimeout(debounce);
      win.clearTimeout(settle);
      win.removeEventListener("resize", onLayout);
      win.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [salt, footer, width]);

  if (typeof document === "undefined" || !chains.length) return null;
  return createPortal(
    <div className="tls-lights" aria-hidden="true" data-testid="christmas-light-chains">
      {chains.map((chain) => <Chain key={chain.key} chain={chain} layout={chainLayout({ width: chain.width, year: salt, anchor: chain.anchor, gaps: chain.gaps })} />)}
    </div>,
    document.body,
  );
}
