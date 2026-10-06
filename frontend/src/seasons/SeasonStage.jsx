import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { pageClass } from "./intensity";
import { readPreviewToken } from "./preview";
import { useSeason } from "./SeasonContext";
import { SEASON_MODULES, hasModule } from "./registry";
import { budgetFor, createSkyLoop } from "./sky";
import { createSoundEngine, setActiveEngine } from "./audio";
import "./seasons.css";

// Die Bühne (#634): Ebenen als Portale an document.body - Backdrop hinter dem Inhalt, Sky (ein Canvas
// für alle) und Corners über dem Inhalt, nie klickbar, unter Dialogen. Toasts einmal je Tag. Nur die
// Module aktiver Saisonen werden geladen; im Adminbereich und auf dem Display bleibt die Bühne leer.

export const QUIET_PATHS = ["/admin", "/display", "/setup", "/consent"];

export function isQuietPath(pathname) {
  return QUIET_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Der Kalendertag am Gerät (JJJJ-MM-TT) - nach der Uhr der Person, nicht nach UTC: sonst finge der Tag in Wien erst um
 * 01:00 (im Sommer 02:00) an, und der Neujahrsgruß käme nach der Null um Mitternacht eine Stunde später noch einmal.
 * Die App rechnet genauso (christmas/greeting.ts).
 */
export function localDay(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Kam der Gruß heute schon? In der Vorschau nie - wer testet, will ihn sehen, auch zum zweiten Mal; und die Vorschau
 * verbraucht den echten Gruß des Tages nicht (`markToastShown` merkt sich dann nichts).
 */
export function toastShownToday(key, now = new Date()) {
  if (readPreviewToken()) return false;
  try {
    return localStorage.getItem(`tls-season-toast-${key}`) === localDay(now);
  } catch {
    return false;
  }
}

export function markToastShown(key, now = new Date()) {
  if (readPreviewToken()) return;
  try {
    localStorage.setItem(`tls-season-toast-${key}`, localDay(now));
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

/**
 * Räumt Ebenen auf (Hörer am Fenster), sobald sie ersetzt werden oder die Bühne geht - verzögert, damit ein doppelter
 * Effektlauf (StrictMode) nichts abräumt, was noch lebt.
 */
function useLayerDisposal(layers) {
  const current = useRef(layers);
  useEffect(() => {
    current.current = layers;
    return () => {
      const old = layers;
      window.setTimeout(() => {
        if (current.current !== old) old.forEach((layer) => layer.dispose?.());
      }, 0);
    };
  }, [layers]);
  useEffect(() => () => {
    current.current = null;
  }, []);
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
  const { seasons, ready, reducedMotion, preview, weather } = useSeason();
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
    // Die Stärke am <html> beruhigt CSS-Animationen. Eine Saison, die nur Himmel ist (Wetter), redet da nicht mit -
    // sonst stünde bei „Wetter: dezent“ auch der Adventkranz still.
    root.dataset.seasonIntensity = mounted.filter((season) => !modules[season.key].skyOnly).map((season) => season.effective).join(" ") || "";
    root.dataset.seasonPage = pageClass(location.pathname);
    if (accents.length) root.style.setProperty("--season-accent", modules[accents[0].key].accent);
    else root.style.removeProperty("--season-accent");
    if (!mounted.length) {
      delete root.dataset.season;
      delete root.dataset.seasonIntensity;
      delete root.dataset.seasonPage;
    }
  }, [mounted, modules, location.pathname]);

  // Die Ebenen leben, bis sich Saison, Stärke, Phase oder Seite ändert - nicht bei jeder Antwort des Servers,
  // sonst finge das Netz alle zehn Minuten neu an zu wachsen. Das Wetter holen sie sich über das Ereignis.
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const mountedSignature = mounted.map((season) => `${season.key}:${season.effective}:${season.phase}`).join(",");
  const skyLayers = useMemo(
    () => mountedRef.current.flatMap((season) => {
      const factory = modules[season.key].skyLayers;
      const budget = budgetFor(season.effective);
      return factory && budget > 0 ? factory({ season, budget, reducedMotion, weather: weatherRef.current, preview }) : [];
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mountedSignature, modules, reducedMotion, location.pathname, preview],
  );
  useLayerDisposal(skyLayers);

  // Klänge (#679): eine Engine für die Bühne, solange eine Saison mit Palette läuft (nicht bei „dezent“ oder
  // „Bewegung reduzieren“); sie wartet selbst auf die erste Geste. Die Palette folgt Saison und Phase (Tag/Nacht).
  const soundSeason = mounted.find((season) => modules[season.key].sounds && season.effective !== "subtle" && !reducedMotion) || null;
  const soundKey = soundSeason ? `${soundSeason.key}:${soundSeason.phase}:${soundSeason.data?.night ? "night" : "day"}` : "";
  const engineRef = useRef(null);
  useEffect(() => {
    if (!soundSeason || quiet) {
      engineRef.current?.dispose();
      engineRef.current = null;
      setActiveEngine(null);
      return undefined;
    }
    if (!engineRef.current) {
      engineRef.current = createSoundEngine();
      setActiveEngine(engineRef.current);
    }
    engineRef.current.setPalette(modules[soundSeason.key].sounds({ season: soundSeason }));
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundKey, quiet, modules]);
  useEffect(() => () => {
    engineRef.current?.dispose();
    engineRef.current = null;
    setActiveEngine(null);
  }, []);

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
      {mounted.map((season) => {
        // Fenster, die eine Saison selbst aufmacht (#963): der Adventkalender über der Seite.
        const Overlay = modules[season.key].Overlay;
        return Overlay ? <Overlay key={`${season.key}-overlay`} season={season} /> : null;
      })}
    </>,
    document.body,
  );
}
