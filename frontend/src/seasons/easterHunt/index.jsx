import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { EasterEggs } from "./EasterEggs";
import { EggShape } from "./EggShape";
import { fetchBasket, onHuntProgress } from "./api";
import "./easter-hunt.css";

// Ostereiersuche (#646): läuft von Karfreitag bis Ostermontag, wenn die Verwaltung das Jahr freigegeben hat. Die
// Eier liegen auf den Seiten (EasterEggs); neben dem Logo zeigt ein kleines Löwenei, wie voll der eigene Korb ist,
// und führt zur Seite /ostern.

const WIDGET_PALETTE = ["#e9c46a", "#2a2118"];

/** Was das Widget sagt: angemeldet der Stand, sonst die Einladung. */
export function widgetLabel(progress) {
  if (!progress?.active) return "Ostereiersuche – zu Korb und Regeln";
  if (progress.completed_at) return `Ostereiersuche – dein Korb ist voll (${progress.total} von ${progress.total})`;
  return `Ostereiersuche – ${progress.found} von ${progress.total} Eiern gefunden`;
}

export function Widget() {
  const { user } = useAuth();
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (!user?.id) {
      setProgress(null);
      return undefined;
    }
    let alive = true;
    fetchBasket().then((data) => { if (alive) setProgress(data); }).catch(() => {});
    const stop = onHuntProgress((update) => setProgress((current) => ({ ...(current || {}), ...update })));
    return () => {
      alive = false;
      stop();
    };
  }, [user?.id]);
  const label = widgetLabel(progress);
  return (
    <Link to="/ostern" className="tls-egg-widget" aria-label={label} title={label} data-testid="easter-hunt-widget">
      {/* Golden mit dunkler Pfote - das dunkle Löwenei ginge im Kopf der Seite unter. */}
      <EggShape pattern="lion" size={15} palette={WIDGET_PALETTE} />
      {progress?.active ? <span data-testid="easter-hunt-widget-count">{progress.found}/{progress.total}</span> : null}
    </Link>
  );
}

export const season = { key: "easter_hunt", Widget, Corners: EasterEggs };
