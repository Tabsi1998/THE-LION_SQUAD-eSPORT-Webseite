import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { measureAnchors } from "../anchors";
import { ButterflyArt, HareEarsArt } from "./art";
import { BUTTERFLY_EVERY, BUTTERFLY_FIRST, PEEK_BOX, PEEK_EVERY, PEEK_FIRST, PEEK_NARROW_FACTOR, butterflyFlight, freeAt, momentRng, nextDelay, peekSpot } from "./plan";

// Seltene Momente der Osterzeit (#645, #756): ein Zitronenfalter, der bei „voll“ alle zwei bis drei Minuten quer über
// das Fenster flattert, und ein Feldhase, der alle paar Minuten kurz seine Ohren hinter einer Karte hervorstreckt -
// nur dort, wo über der Karte nichts steht; am Handy halb so oft. Beides gehört zur Seite (Seitenkoordinaten), ist nie
// klickbar und schläft, solange der Tab versteckt ist. Kein Comic-Hase, keine Dauerbewegung.

const HIDDEN_RETRY_MS = 10000;

/** Ein Takt: `act()` zuerst nach `first`, dann immer wieder nach `every` - nicht, solange der Tab versteckt ist. */
function useMoments(first, every, act, factor = 1) {
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const rng = momentRng();
    let timer = window.setTimeout(function run() {
      if (document.hidden) {
        timer = window.setTimeout(run, HIDDEN_RETRY_MS);
        return;
      }
      actRef.current(rng);
      timer = window.setTimeout(run, nextDelay(rng, every, factor));
    }, nextDelay(rng, first, factor));
    return () => window.clearTimeout(timer);
  }, [first, every, factor]);
}

/** Der Zitronenfalter: quer über das Fenster in einer eigenen Bahn (abgeschnitten am Rand - nie ein Querscrollen). */
export function Butterflies() {
  const [flight, setFlight] = useState(null);
  useMoments(BUTTERFLY_FIRST, BUTTERFLY_EVERY, (rng) => {
    const plan = butterflyFlight(rng);
    const width = document.documentElement.clientWidth || window.innerWidth;
    setFlight({ ...plan, id: Date.now(), top: Math.round((window.scrollY || 0) + window.innerHeight * plan.y), width });
  });
  if (!flight || typeof document === "undefined") return null;
  const from = flight.fromLeft ? -flight.size - 10 : flight.width + 10;
  const to = flight.fromLeft ? flight.width + 10 : -flight.size - 10;
  return createPortal(
    <div className="tls-easter-layer tls-butterfly-lane" style={{ top: `${flight.top - flight.bob - 10}px`, height: `${flight.size + flight.bob * 2 + 20}px` }} aria-hidden="true">
      <div
        key={flight.id}
        className="tls-butterfly-flight"
        style={{ top: `${flight.bob + 10}px`, "--fly-from": `${from}px`, "--fly-to": `${to}px`, "--fly-seconds": `${flight.seconds}s`, "--bob": `${-flight.bob}px` }}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setFlight(null);
        }}
        data-testid="easter-butterfly"
      >
        <div className="tls-butterfly-bob">
          <ButterflyArt size={flight.size} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Die Karten im Fenster als Rechtecke, von oben nach unten. */
function visibleCards() {
  return measureAnchors(document, window, { kinds: ["card"] })
    .map((anchor) => anchor.rect)
    .filter((rect) => rect.bottom > 0 && rect.top < window.innerHeight)
    .sort((a, b) => a.top - b.top);
}

/** Der Feldhase: die Ohren steigen hinter der Oberkante einer Karte auf, zucken einmal und sinken wieder. */
export function HarePeek() {
  const [peek, setPeek] = useState(null);
  const narrow = typeof window !== "undefined" && (document.documentElement.clientWidth || window.innerWidth) < 640;
  useMoments(PEEK_FIRST, PEEK_EVERY, () => {
    const header = document.querySelector("header");
    const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const spot = peekSpot(visibleCards(), { headerBottom, innerHeight: window.innerHeight }, (x, y) => freeAt(document, x, y));
    if (spot) setPeek({ id: Date.now(), left: spot.left + (window.scrollX || 0), top: spot.top + (window.scrollY || 0) });
  }, narrow ? PEEK_NARROW_FACTOR : 1);
  if (!peek || typeof document === "undefined") return null;
  return createPortal(
    <div className="tls-easter-layer tls-hare-peek" style={{ left: `${peek.left}px`, top: `${peek.top}px`, width: `${PEEK_BOX.width}px`, height: `${PEEK_BOX.height}px` }} aria-hidden="true" data-testid="easter-hare">
      <div
        key={peek.id}
        className="tls-hare-peek__ears"
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setPeek(null);
        }}
      >
        <HareEarsArt width={26} />
      </div>
    </div>,
    document.body,
  );
}
