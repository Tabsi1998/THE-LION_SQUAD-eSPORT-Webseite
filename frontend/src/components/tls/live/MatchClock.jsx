import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { clockLabel, matchClock } from "@/lib/matchClock";
import { motionAllowed } from "@/lib/motion";
import { serverNow } from "@/seasons/clock";
import { useSeason } from "@/seasons/SeasonContext";
import "./live.css";

// Spielzeit-Uhr (#1167, #1556): „12:34 / 30 Min.“ mit Balken. Farben nach Fabians Auswahl (07.10., „Jede Farbe hat eine
// Aufgabe“): Rot gehört allein „läuft“ - die Uhr selbst ist ab 80 % der Dauer orange („knapp“), ab 100 % orange gefüllt
// mit Warn-Symbol („Zeit überschritten“). Ohne Dauer nur die laufende Zeit. Die Rechnung steht einmal in lib/matchClock
// (dieselbe wie am TV). Gezählt wird nach der Serverzeit (Abstand aus dem Saison-Kontext), damit ein Handy mit falsch
// gehender Uhr dasselbe zeigt wie der TV. Tickt jede Sekunde ohne Neuladen. Mit „Bewegung reduzieren“ springt der Balken
// minutenweise. role="timer" ist von sich aus still - kein Vorlesen jede Sekunde; der Name sagt Zeit, Dauer und Zustand.
// `size="sm"`: die kleine Uhr für eine Listenzeile (Turnierleitung, Reiter „Ergebnisse“).

/** Die Uhr eines Spiels nach der Serverzeit, jede Sekunde neu. */
export function useMatchClock(startedAt, durationMinutes, { pausedAt = null } = {}) {
  const { serverOffset } = useSeason();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || pausedAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, pausedAt]);
  return matchClock(startedAt, durationMinutes, serverNow(serverOffset, now), { stepped: !motionAllowed(), pausedAt });
}

/** Die Zeit selbst: ab 100 % orange gefüllt mit Warn-Symbol. */
export function ClockTime({ info, testId, className = "" }) {
  return (
    <span className={`tls-live-clock-time font-display tabular-nums ${className}`} data-testid={testId ? `${testId}-time` : undefined}>
      {info.tone === "over" ? <AlertTriangle className="tls-live-clock-icon" aria-hidden="true" data-testid={testId ? `${testId}-warn` : undefined} /> : null}
      {info.text}
    </span>
  );
}

export function MatchClock({ startedAt, durationMinutes, pausedAt = null, testId = "match-clock", className = "", size = "md" }) {
  const info = useMatchClock(startedAt, durationMinutes, { pausedAt });
  if (!info) return null;
  const small = size === "sm";
  return (
    <div className={`tls-live-clock ${className}`} data-tone={info.tone} data-size={size} data-testid={testId} role="timer" aria-label={clockLabel(info)}>
      <div className="flex items-baseline gap-2">
        <ClockTime info={info} testId={testId} className={`font-bold text-white ${small ? "text-sm" : "text-2xl"}`} />
        {info.limit ? <span className={`${small ? "text-[11px]" : "text-xs"} text-white/55`}>/ {info.limit}</span> : null}
        {info.tone === "over" && info.overMinutes ? <span className={`ml-auto ${small ? "text-[11px]" : "text-xs"} font-bold text-warn`}>+{info.overMinutes} Min.</span> : null}
      </div>
      {info.ratio !== null ? (
        <div className={`tls-live-clock-track ${small ? "mt-1" : "mt-1.5"}`} aria-hidden="true">
          <div className="tls-live-clock-bar" data-testid={`${testId}-bar`} style={{ transform: `scaleX(${info.ratio})` }} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Die Uhr in einer Textzeile (Web-Baum, Spielplan): nur die Zeit, ohne Balken - dieselbe Rechnung und dieselben Farben.
 * Ruhig (und ohne Dauer) bleibt sie in der Farbe der Zeile - rot heißt dort „läuft“.
 */
export function InlineMatchClock({ startedAt, durationMinutes = null, testId = "bracket-live-clock" }) {
  const info = useMatchClock(startedAt, durationMinutes);
  if (!info) return null;
  return (
    <span className="tls-live-clock tls-live-clock--inline" data-tone={info.tone} data-testid={testId} role="timer" aria-label={clockLabel(info)}>
      <ClockTime info={info} />
    </span>
  );
}
