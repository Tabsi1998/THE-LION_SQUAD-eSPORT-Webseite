import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hashString, mulberry32 } from "../rng";
import { emitSound } from "../audio";
import { requestMotion } from "../motion";
import { recordSignal } from "../signals";
import { Ghost, MiniTombstone } from "./art";

// Mini-Friedhof (#662): zwei bis vier winzige Grabsteine stehen auf dem Strich über der Impressum-Leiste. Ein
// Klick auf ein Grab lässt einen türkisen Geist aufsteigen, der in eine zufällige Richtung davontreibt - in
// Seitenkoordinaten, man kann ihm nachscrollen. Je Grab höchstens ein Geist je Minute.

export const GHOST_COOLDOWN_MS = 60000;
/** Jeder befreite Geist zählt für die Saison-Fundstücke (#678) - der Server deckelt je Tag. */
export const FREED_SIGNAL = "halloween_ghosts_freed";

/** Richtung und Weite eines Geistes: meist nach oben, ein wenig zur Seite. */
export function ghostDrift(rng) {
  const angle = -Math.PI / 2 + (rng() - 0.5) * 2.4;
  const distance = 300 + rng() * 420;
  return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance, spin: (rng() - 0.5) * 30 };
}

/** Wo der Strich über dem Impressum liegt (Abstand zur Oberkante des Footers) - null, wenn es keinen gibt. */
export function useFooterLineTop(deps = []) {
  const [top, setTop] = useState(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const measure = () => {
      const line = document.querySelector("footer [data-season-line]");
      setTop(line ? line.offsetTop : null);
    };
    measure();
    const timer = window.setTimeout(measure, 1200);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return top;
}

export function Graveyard({ graves, salt, ghostMs = 8000, cooldownMs = GHOST_COOLDOWN_MS }) {
  const top = useFooterLineTop([graves]);
  const [ghosts, setGhosts] = useState([]);
  const rngRef = useRef(mulberry32(hashString(`ghosts:${salt}`)));
  const lastRef = useRef({});
  const nextId = useRef(0);

  useEffect(() => {
    if (!ghosts.length) return undefined;
    const timer = window.setTimeout(() => setGhosts((current) => current.filter((ghost) => ghost.until > Date.now())), ghostMs + 50);
    return () => window.clearTimeout(timer);
  }, [ghosts, ghostMs]);

  if (!graves?.length || top === null) return null;

  const release = (index, event) => {
    const now = Date.now();
    if (now - (lastRef.current[index] || 0) < cooldownMs) return;
    lastRef.current[index] = now;
    const rect = event.currentTarget.getBoundingClientRect();
    const drift = ghostDrift(rngRef.current);
    requestMotion("ghost", { force: true });
    emitSound("ghost");
    recordSignal(FREED_SIGNAL, { onceIf: false });
    nextId.current += 1;
    setGhosts((current) => [...current, { id: nextId.current, x: rect.left + rect.width / 2 + window.scrollX, y: rect.top + window.scrollY, until: now + ghostMs, ...drift }]);
  };

  return (
    <>
      <div className="tls-graveyard" style={{ top: `${top}px` }} aria-hidden="true" data-testid="halloween-graveyard">
        {graves.map((grave, index) => (
          <button
            key={index}
            type="button"
            tabIndex={-1}
            className="tls-grave"
            style={{ left: `${(grave.x * 100).toFixed(1)}%`, "--tilt": `${grave.tilt}deg` }}
            onClick={(event) => release(index, event)}
            data-testid="halloween-grave"
          >
            <MiniTombstone size={grave.size} />
          </button>
        ))}
      </div>
      {ghosts.length > 0 && createPortal(
        <div className="tls-ghosts" aria-hidden="true">
          {ghosts.map((ghost) => (
            <div
              key={ghost.id}
              className="tls-ghost"
              style={{ left: `${ghost.x}px`, top: `${ghost.y}px`, "--dx": `${ghost.dx.toFixed(0)}px`, "--dy": `${ghost.dy.toFixed(0)}px`, "--spin": `${ghost.spin.toFixed(0)}deg`, "--dur": `${ghostMs}ms` }}
              data-testid="halloween-ghost"
            >
              <Ghost />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
