import { useEffect, useState } from "react";
import { clockLabel, matchClock } from "@/lib/matchClock";
import { motionAllowed } from "@/lib/motion";
import { serverNow } from "@/seasons/clock";
import { useSeason } from "@/seasons/SeasonContext";
import "./live.css";

// Spielzeit-Uhr (#1167, #1556): „12:34 / 30 Min.“ mit Balken, Orange (Token `warn`) ab 80 %, `live` ab 100 % der Dauer;
// ohne Dauer nur die laufende Zeit. Die Rechnung steht einmal in lib/matchClock (dieselbe wie am TV). Gezählt wird nach
// der Serverzeit (Abstand aus dem Saison-Kontext), damit ein Handy mit falsch gehender Uhr dasselbe zeigt wie der TV.
// Tickt jede Sekunde ohne Neuladen. Mit „Bewegung reduzieren“ springt der Balken minutenweise. role="timer" ist von sich
// aus still - kein Vorlesen jede Sekunde; der Name sagt Zeit, Dauer und „knapp“ bzw. „Zeit überschritten“.
// `size="sm"`: die kleine Uhr für eine Listenzeile (Turnierleitung, Reiter „Ergebnisse“).

export function MatchClock({ startedAt, durationMinutes, pausedAt = null, testId = "match-clock", className = "", size = "md" }) {
  const { serverOffset } = useSeason();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || pausedAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, pausedAt]);
  const info = matchClock(startedAt, durationMinutes, serverNow(serverOffset, now), { stepped: !motionAllowed(), pausedAt });
  if (!info) return null;
  const small = size === "sm";
  return (
    <div className={`tls-live-clock ${className}`} data-tone={info.tone} data-size={size} data-testid={testId} role="timer" aria-label={clockLabel(info)}>
      <div className="flex items-baseline gap-2">
        <span className={`tls-live-clock-time font-display font-bold tabular-nums text-white ${small ? "text-sm" : "text-2xl"}`} data-testid={`${testId}-time`}>{info.text}</span>
        {info.limit ? <span className={`${small ? "text-[11px]" : "text-xs"} text-white/55`}>/ {info.limit}</span> : null}
        {info.tone === "over" && info.overMinutes ? <span className={`ml-auto ${small ? "text-[11px]" : "text-xs"} font-bold text-live`}>+{info.overMinutes} Min.</span> : null}
      </div>
      {info.ratio !== null ? (
        <div className={`tls-live-clock-track ${small ? "mt-1" : "mt-1.5"}`} aria-hidden="true">
          <div className="tls-live-clock-bar" data-testid={`${testId}-bar`} style={{ transform: `scaleX(${info.ratio})` }} />
        </div>
      ) : null}
    </div>
  );
}
