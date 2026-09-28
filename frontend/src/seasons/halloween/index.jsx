import { useEffect, useMemo, useRef, useState } from "react";
import { Cobweb, Lantern, Pumpkin, Spider } from "./art";
import { advanceFlock, createFlock, drawBat, nextFlightDelay } from "./bats";
import { recordSignal } from "../signals";

// Halloween (#635): Spinnweben in den oberen Ecken mit einer Spinne, Fledermausschwärme alle 60–180
// Sekunden (nachts öfter) und beim ersten Scrollen je Seite, Nebel unten bei „voll“, zwei Kürbisse am
// Footer, die Kürbislaterne neben dem Löwen - klickbar, am 31.10. abends zählt der Klick als Signal.

export const ACCENT = "rgba(255, 140, 0, 0.45)";
export const SIGNAL_KEY = "halloween_pumpkin";

/** Zählt der Klick? Nur am 31. Oktober ab 18:00 (Ortszeit des Geräts, der Server prüft später selbst). */
export function pumpkinCounts(now = new Date()) {
  return now.getMonth() === 9 && now.getDate() === 31 && now.getHours() >= 18;
}

export function Corners({ season }) {
  const period = useMemo(() => `${40 + Math.round(Math.random() * 50)}s`, []);
  return (
    <>
      <Cobweb className="tls-cobweb--left" />
      <Cobweb className="tls-cobweb--right" />
      {season.effective !== "subtle" && <Spider style={{ "--tls-spider-period": period }} />}
    </>
  );
}

export function Backdrop({ season }) {
  if (season.effective !== "full") return null;
  return <div className={`tls-fog ${season.data?.night ? "tls-fog--dense" : ""}`} aria-hidden="true" data-testid="halloween-fog" />;
}

export function Footer() {
  return (
    <div className="tls-footer-pumpkins" data-testid="halloween-pumpkins">
      <Pumpkin size={28} />
      <Pumpkin size={22} slow />
    </div>
  );
}

export function Widget({ season }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const greeting = season.texts?.greeting || "Happy Halloween";
  const onClick = () => {
    setOpen(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 4000);
    if (pumpkinCounts()) recordSignal(SIGNAL_KEY);
  };
  return (
    <span className="relative">
      <button type="button" onClick={onClick} className={`tls-lantern ${open ? "tls-lantern--open" : ""}`} aria-label={greeting} title={greeting} data-testid="halloween-lantern">
        <Lantern open={open} />
      </button>
      {open && <span className="tls-lantern__note" role="status" data-testid="halloween-note">{greeting}</span>}
    </span>
  );
}

/** Die Fledermäuse als Ebene für den gemeinsamen Canvas-Loop. */
export function skyLayers({ season, reducedMotion }) {
  if (reducedMotion) return [];
  const night = Boolean(season.data?.night);
  const state = { flock: null, wait: 8, lastPath: "", scrollArmed: true };
  const onScroll = () => {
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    if (!state.scrollArmed || path === state.lastPath) return;
    state.lastPath = path;
    state.scrollArmed = false;
    if (!state.flock) state.wait = Math.min(state.wait, 0.5);
    window.setTimeout(() => {
      state.scrollArmed = true;
    }, 45000);
  };
  if (typeof window !== "undefined") window.addEventListener("scroll", onScroll, { passive: true });
  return [{
    key: "halloween-bats",
    draw(ctx, dt, size) {
      if (!state.flock) {
        state.wait -= dt;
        if (state.wait > 0) return;
        // Der Schwarm startet in diesem Bild - nur die Zeit über der Wartezeit zählt schon als Flug.
        state.flock = createFlock(size, season.effective);
        dt = Math.max(0, -state.wait);
        state.wait = 0;
      }
      advanceFlock(state.flock, dt).forEach((bat) => drawBat(ctx, bat));
      if (state.flock.done) {
        state.flock = null;
        state.wait = nextFlightDelay(night);
      }
    },
    dispose() {
      if (typeof window !== "undefined") window.removeEventListener("scroll", onScroll);
    },
  }];
}

export const season = { key: "halloween", accent: ACCENT, Corners, Backdrop, Footer, Widget, skyLayers };
