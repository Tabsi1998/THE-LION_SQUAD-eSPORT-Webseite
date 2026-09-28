import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useSeason } from "./SeasonContext";
import { SEASON_MODULES, hasModule } from "./registry";
import { budgetFor, createSkyLoop } from "./sky";
import "./seasons.css";

// Die Bühne (#634): Ebenen als Portale an document.body - Backdrop hinter dem Inhalt, Sky (ein Canvas
// für alle) und Corners über dem Inhalt, nie klickbar, unter Dialogen. Toasts einmal je Tag. Nur die
// Module aktiver Saisonen werden geladen; im Adminbereich und auf dem Display bleibt die Bühne leer.

export const QUIET_PATHS = ["/admin", "/display", "/setup", "/consent"];

export function isQuietPath(pathname) {
  return QUIET_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function toastShownToday(key, now = new Date()) {
  try {
    return localStorage.getItem(`tls-season-toast-${key}`) === now.toISOString().slice(0, 10);
  } catch {
    return false;
  }
}

export function markToastShown(key, now = new Date()) {
  try {
    localStorage.setItem(`tls-season-toast-${key}`, now.toISOString().slice(0, 10));
  } catch {
    // Ohne Speicher kommt der Gruß beim nächsten Laden noch einmal - das ist verschmerzbar.
  }
}

// Ein Modul wird einmal geladen, egal wie viele Plätze (Bühne, Widget, Footer) es brauchen.
const moduleCache = new Map();

export function loadSeasonModule(key) {
  if (!moduleCache.has(key)) moduleCache.set(key, SEASON_MODULES[key]());
  return moduleCache.get(key);
}

/** Lädt die Module der aktiven Saisonen (lazy) und hält sie, solange die Saison läuft. */
export function useSeasonModules(seasons) {
  const [modules, setModules] = useState({});
  const wanted = seasons.filter((season) => hasModule(season.key) && season.effective !== "off").map((season) => season.key);
  const signature = wanted.join(",");
  useEffect(() => {
    let cancelled = false;
    wanted.forEach((key) => {
      if (modules[key]) return;
      loadSeasonModule(key).then((loaded) => {
        if (!cancelled && loaded?.season) setModules((current) => (current[key] ? current : { ...current, [key]: loaded.season }));
      }).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return modules;
}

function SkyCanvas({ layers }) {
  const canvasRef = useRef(null);
  const loopRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || typeof canvasRef.current.getContext !== "function") return undefined;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return undefined;
    loopRef.current = createSkyLoop(canvasRef.current);
    return () => {
      loopRef.current?.destroy();
      loopRef.current = null;
    };
  }, []);
  useEffect(() => {
    const loop = loopRef.current;
    if (!loop) return undefined;
    const removers = layers.map((layer) => loop.add(layer));
    return () => removers.forEach((remove) => remove());
  }, [layers]);
  return <canvas ref={canvasRef} className="tls-season-sky" aria-hidden="true" data-testid="season-sky" />;
}

export function SeasonStage() {
  const { seasons, ready, reducedMotion, preview } = useSeason();
  const location = useLocation();
  // Im Admin bleibt die Bühne leer - außer bei der Vorschau, die soll dort sofort zu sehen sein.
  const quiet = isQuietPath(location.pathname) && !preview;
  const active = quiet ? [] : seasons.filter((season) => season.effective !== "off");
  const modules = useSeasonModules(active);
  const mounted = active.filter((season) => modules[season.key]);

  // Farbschein und Kennzeichen am <html>, damit CSS (Knöpfe, Schneehauben) darauf reagieren kann.
  useEffect(() => {
    const root = document.documentElement;
    const accents = mounted.filter((season) => modules[season.key].accent && season.effective !== "subtle");
    root.dataset.season = mounted.map((season) => season.key).join(" ") || "";
    root.dataset.seasonIntensity = mounted.map((season) => season.effective).join(" ") || "";
    if (accents.length) root.style.setProperty("--season-accent", modules[accents[0].key].accent);
    else root.style.removeProperty("--season-accent");
    if (!mounted.length) {
      delete root.dataset.season;
      delete root.dataset.seasonIntensity;
    }
  }, [mounted, modules]);

  const skyLayers = useMemo(() => mounted.flatMap((season) => {
    const factory = modules[season.key].skyLayers;
    const budget = budgetFor(season.effective);
    return factory && budget > 0 ? factory({ season, budget, reducedMotion }) : [];
  }), [mounted, modules, reducedMotion]);

  if (!ready || !mounted.length || typeof document === "undefined") return null;
  return createPortal(
    <>
      {mounted.map((season) => {
        const Backdrop = modules[season.key].Backdrop;
        return Backdrop ? <Backdrop key={`${season.key}-backdrop`} season={season} /> : null;
      })}
      {skyLayers.length > 0 && <SkyCanvas layers={skyLayers} />}
      <div className="tls-season-corners" aria-hidden="true" data-testid="season-corners">
        {mounted.map((season) => {
          const Corners = modules[season.key].Corners;
          return Corners ? <Corners key={`${season.key}-corners`} season={season} /> : null;
        })}
      </div>
      {mounted.map((season) => {
        const Toast = modules[season.key].Toast;
        return Toast ? <Toast key={`${season.key}-toast`} season={season} /> : null;
      })}
    </>,
    document.body,
  );
}
