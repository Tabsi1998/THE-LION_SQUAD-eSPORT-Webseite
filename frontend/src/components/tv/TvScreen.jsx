import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { TV_DEFAULTS, linkOverrides, resolveTvSettings } from "@/lib/tvSettings";
import { tvBox, tvCssVars, tvScale, tvUnitPx } from "@/lib/tvType";
import { keepScreenAwake } from "@/lib/wakeLock";
import { PIXEL_SHIFT_MAX, PIXEL_SHIFT_MS, pixelShiftAt } from "@/lib/tvPixelShift";
import "./tv.css";

// Der Rahmen aller TV-Seiten (#1110-#1112): liest die Grundwerte (ohne Anmeldung, live über den Änderungsstrom),
// legt die Abweichungen aus dem Link darüber, setzt Schrift, Kontrast, sicheren Bereich und Bewegung an einer Stelle,
// verschiebt das Bild alle paar Minuten um ein paar Punkte und hält den Bildschirm wach.

const FALLBACK = {
  settings: TV_DEFAULTS,
  motionOn: true,
  textSize: "normal",
  scale: tvScale("normal"),
  box: tvBox("normal"),
};

const TvContext = createContext(null);

export function useTv() {
  return useContext(TvContext) || FALLBACK;
}

/** Die Grundwerte vom Server - ohne Anmeldung, neu geladen, sobald der Änderungsstrom „tv“ meldet. */
export function useTvServerSettings() {
  const [server, setServer] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/tv/settings");
      setServer(data?.settings || {});
    } catch {
      setServer((current) => current || {});
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, ["tv"], { fallbackMs: 60000 });
  return server;
}

/**
 * Die Fläche eines Elements in TV-Einheiten - gemessen, damit die Rechnung zur echten Kopf- und Fußleiste passt.
 * Gibt `[ref, area, trim]` zurück: `ref` kommt an das Element (es darf auch erst nach dem Laden erscheinen).
 * Für Listen (`resetKey` gesetzt) zählt `trim`, um wie viele Einträge die Liste kürzer werden muss, wenn sie trotz
 * Rechnung überläuft (andere Schrift am TV) - so wird nie etwas abgeschnitten. Ändert sich `resetKey` (neue Daten),
 * wird neu gezählt.
 */
export function useTvArea(resetKey = null) {
  const [element, setElement] = useState(null);
  const [area, setArea] = useState(null);
  const ref = useCallback((node) => setElement(node), []);
  // Gezählt wird erst, wenn die Fläche gemessen ist, und neu für jede Fläche und jeden Datenstand.
  const trimKey = resetKey === null || !area ? null : `${resetKey}|${area.w}x${area.h}`;
  const [trim, setTrim] = useState({ key: null, count: 0 });
  const count = trimKey !== null && trim.key === trimKey ? trim.count : 0;
  useLayoutEffect(() => {
    if (trimKey === null || !element) return undefined;
    const check = () => {
      if (element.scrollHeight <= element.clientHeight + 1) return;
      setTrim((current) => {
        const base = current.key === trimKey ? current.count : 0;
        // Höchstens 50 Schritte; danach bleibt der Zustand derselbe, sonst liefe die Seite im Kreis.
        if (base >= 50 && current.key === trimKey) return current;
        return { key: trimKey, count: base + 1 };
      });
    };
    check();
    // Nach jeder Änderung der Liste noch einmal nachsehen - so lange, bis nichts mehr überläuft.
    const observer = typeof MutationObserver === "function" ? new MutationObserver(check) : null;
    observer?.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer?.disconnect();
  }, [element, trimKey]);
  useLayoutEffect(() => {
    if (!element || typeof window === "undefined") return undefined;
    const measure = () => {
      const unit = tvUnitPx(window.innerWidth, window.innerHeight);
      // Noch nicht ausgelegt (oder ohne Layout wie in Tests): dann gilt die Vorgabe der Seite.
      if (!unit || !element.clientWidth || !element.clientHeight) return;
      const next = { w: Math.round((element.clientWidth / unit) * 10) / 10, h: Math.round((element.clientHeight / unit) * 10) / 10 };
      setArea((current) => (current && current.w === next.w && current.h === next.h ? current : next));
    };
    measure();
    if (typeof ResizeObserver !== "function") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [ref, area, count];
}

/** Alle paar Minuten ein Schritt auf dem Weg der Pixel-Verschiebung; aus = keine Verschiebung. */
export function usePixelShift(enabled, intervalMs = PIXEL_SHIFT_MS) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => setStep((current) => current + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
  return enabled ? pixelShiftAt(step) : [0, 0];
}

/** Hält den Bildschirm wach; kann der Browser das nicht, steht einmal für 20 Sekunden ein kleiner Hinweis. */
function useWakeHint() {
  const [hint, setHint] = useState(false);
  useEffect(() => keepScreenAwake({ onUnavailable: () => setHint(true) }), []);
  useEffect(() => {
    if (!hint) return undefined;
    const timer = window.setTimeout(() => setHint(false), 20000);
    return () => window.clearTimeout(timer);
  }, [hint]);
  return hint;
}

/** Wo die Bühne sitzt: sicherer Bereich in Prozent, mit Pixel-Verschiebung 3 Punkte Luft (oder Überstand am Rand). */
export function stageInset(safeArea, pixelShift) {
  const extra = pixelShift ? PIXEL_SHIFT_MAX : 0;
  if (!safeArea) return { y: `${-extra}px`, x: `${-extra}px` };
  return { y: `calc(${safeArea}vh + ${extra}px)`, x: `calc(${safeArea}vw + ${extra}px)` };
}

export function TvScreen({ children }) {
  const [params] = useSearchParams();
  const server = useTvServerSettings();
  const overrides = useMemo(() => linkOverrides(params), [params]);
  const settings = useMemo(() => resolveTvSettings(server, overrides), [server, overrides]);
  const systemReduced = useReducedMotion();
  const motionOn = !systemReduced && !settings.reduce_motion;
  const [shiftX, shiftY] = usePixelShift(settings.pixel_shift);
  const hint = useWakeHint();

  const style = useMemo(() => {
    const inset = stageInset(settings.safe_area, settings.pixel_shift);
    return { ...tvCssVars(settings.text_size), "--tv-inset-y": inset.y, "--tv-inset-x": inset.x };
  }, [settings.text_size, settings.safe_area, settings.pixel_shift]);

  const value = useMemo(() => ({
    settings,
    motionOn,
    textSize: settings.text_size,
    scale: tvScale(settings.text_size),
    box: tvBox(settings.text_size),
  }), [settings, motionOn]);

  return (
    <TvContext.Provider value={value}>
      <MotionConfig reducedMotion={motionOn ? "never" : "always"}>
        <div
          className="tv-screen"
          data-testid="tv-screen"
          data-tv-motion={motionOn ? "on" : "off"}
          data-tv-contrast={settings.contrast ? "1" : "0"}
          data-tv-text={settings.text_size}
          data-tv-safe={settings.safe_area}
          data-tv-season={settings.season_header ? "1" : "0"}
          style={style}
        >
          <div
            className="tv-stage"
            data-testid="tv-stage"
            data-shift={`${shiftX},${shiftY}`}
            style={shiftX || shiftY ? { transform: `translate3d(${shiftX}px, ${shiftY}px, 0)` } : undefined}
          >
            {children}
          </div>
          {hint ? (
            <div className="tv-hint tv-t-meta" role="status" data-testid="tv-wake-hint">
              Dieser Browser kann den Bildschirm nicht wach halten – Bildschirmschoner und Energiesparen am Gerät ausschalten.
            </div>
          ) : null}
        </div>
      </MotionConfig>
    </TvContext.Provider>
  );
}
