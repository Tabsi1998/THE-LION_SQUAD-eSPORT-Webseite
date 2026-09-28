import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { hashString, mulberry32 } from "../rng";
import { FlyingBatShape, HangingBatShape } from "./art";

// Hängende Fledermäuse (#661): ein bis drei hängen kopfüber an Stellen, die die Seite selbst hergibt - am Ende
// einer Überschrift, unter einem Menüpunkt, am Löwen der Startseite. Welche, kommt aus der Adresse plus einem
// Salz je Ladung. Ein Klick scheucht sie: sie fliegen auf einer Kurve davon, in Seitenkoordinaten, gern nach
// unten - man kann ihnen nachscrollen. Das einzige klickbare Deko-Element.

export const ANCHOR_SELECTOR = "main h1, main h2, header nav a, [data-season-anchor]";
export const MIN_DISTANCE = 140;

/** Kandidaten aus der Seite messen: Hängepunkt in Seitenkoordinaten (nicht Fenster). */
export function measureAnchors(doc = document, win = window) {
  const found = [];
  doc.querySelectorAll(ANCHOR_SELECTOR).forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 10) return;
    const kind = element.dataset?.seasonAnchor || (element.tagName === "A" ? "nav" : "heading");
    let x = rect.right + 6;
    let y = rect.top + 2;
    if (kind === "lion") {
      x = rect.left + rect.width * 0.68;
      y = rect.top + rect.height * 0.16;
    } else if (kind === "nav") {
      x = rect.left + rect.width / 2;
      y = rect.bottom + 2;
    }
    found.push({ kind, x: x + win.scrollX, y: y + win.scrollY, element });
  });
  return found;
}

/** Auswahl: gemischt nach dem Zufall der Seite, nie zwei zu nah beieinander. */
export function chooseAnchors(candidates, count, rng) {
  const pool = candidates.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = [];
  pool.forEach((candidate) => {
    if (chosen.length >= count) return;
    if (chosen.some((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) < MIN_DISTANCE)) return;
    chosen.push(candidate);
  });
  return chosen;
}

/** Flugbahn beim Verscheuchen: weit weg, meist nach unten, immer erst ein Stück hoch. */
export function flightPath(from, rng) {
  const dir = rng() < 0.5 ? -1 : 1;
  const dx = dir * (500 + rng() * 700);
  const dy = rng() < 0.62 ? 350 + rng() * 650 : -(250 + rng() * 350);
  return {
    p0: from,
    p1: { x: from.x + dx * 0.25, y: from.y - 140 - rng() * 80 },
    p2: { x: from.x + dx * 0.75, y: from.y + dy - 120 },
    p3: { x: from.x + dx, y: from.y + dy },
    facing: dir,
  };
}

export function pointOn(path, t) {
  const u = 1 - t;
  return {
    x: u * u * u * path.p0.x + 3 * u * u * t * path.p1.x + 3 * u * t * t * path.p2.x + t * t * t * path.p3.x,
    y: u * u * u * path.p0.y + 3 * u * u * t * path.p1.y + 3 * u * t * t * path.p2.y + t * t * t * path.p3.y,
  };
}

function FlyingBat({ path, durationMs, size, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const point = pointOn(path, t);
      if (ref.current) ref.current.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) scaleX(${path.facing})`;
      if (t < 1) frame = requestAnimationFrame(tick);
      else onDone();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [path, durationMs, onDone]);
  return (
    <div ref={ref} className="tls-hbat tls-hbat--flying" style={{ transform: `translate(${path.p0.x}px, ${path.p0.y}px)` }} data-testid="halloween-bat-flying">
      <FlyingBatShape size={size * 1.7} />
    </div>
  );
}

/**
 * `count` Fledermäuse für diese Seite. Gemessen wird kurz nach dem Aufbau und noch zweimal, weil Inhalte
 * nachladen; danach hängen sie fest an ihrem Element und ziehen bei Größenänderung mit.
 */
export function HangingBats({ count, seed, salt, flightMs = 3200, size = 26 }) {
  const location = useLocation();
  const [bats, setBats] = useState([]);
  const rngRef = useRef(mulberry32(hashString(`bats:${seed}:${salt}`)));

  useEffect(() => {
    setBats([]);
    if (!count || typeof document === "undefined") return undefined;
    rngRef.current = mulberry32(hashString(`bats:${seed}:${salt}:${location.pathname}`));
    let cancelled = false;
    let placed = false;
    const refresh = () => {
      if (cancelled) return;
      const found = measureAnchors();
      if (!found.length) return;
      if (!placed) {
        placed = true;
        setBats(chooseAnchors(found, count, rngRef.current).map((anchor, index) => ({ id: index, ...anchor, state: "hanging" })));
        return;
      }
      setBats((current) => current.map((bat) => {
        if (bat.state !== "hanging") return bat;
        const again = found.find((entry) => entry.element === bat.element);
        return again ? { ...bat, x: again.x, y: again.y } : { ...bat, state: "gone" };
      }));
    };
    const timers = [400, 1500, 3500].map((ms) => window.setTimeout(refresh, ms));
    window.addEventListener("resize", refresh);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", refresh);
    };
  }, [location.pathname, count, seed, salt]);

  if (!bats.length || typeof document === "undefined") return null;
  const scare = (id) => {
    setBats((current) => current.map((bat) => (bat.id === id && bat.state === "hanging" ? { ...bat, state: "flying", path: flightPath({ x: bat.x, y: bat.y }, rngRef.current) } : bat)));
  };
  const done = (id) => setBats((current) => current.map((bat) => (bat.id === id ? { ...bat, state: "gone" } : bat)));
  return createPortal(
    <div className="tls-hbats" aria-hidden="true" data-testid="halloween-hanging-bats">
      {bats.map((bat) => {
        if (bat.state === "gone") return null;
        if (bat.state === "flying") return <FlyingBat key={bat.id} path={bat.path} durationMs={flightMs} size={size} onDone={() => done(bat.id)} />;
        return (
          <button
            key={bat.id}
            type="button"
            tabIndex={-1}
            className={`tls-hbat tls-hbat--hanging tls-hbat--${bat.kind}`}
            style={{ transform: `translate(${bat.x}px, ${bat.y}px)`, "--hbat-delay": `${(bat.id * 1.7) % 5}s` }}
            onClick={() => scare(bat.id)}
            data-testid="halloween-bat-hanging"
          >
            <HangingBatShape size={size} />
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
