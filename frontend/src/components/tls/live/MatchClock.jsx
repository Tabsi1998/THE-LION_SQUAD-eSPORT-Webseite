import { useEffect, useState } from "react";
import { matchClock } from "@/lib/liveQueue";
import { motionAllowed } from "@/lib/motion";
import "./live.css";

// Spielzeit-Uhr (#1167, #1556): „12:34 / 30 Min.“ mit Balken, gelb ab 80 %, rot ab 100 % der Dauer; ohne Dauer nur die
// laufende Zeit. Tickt jede Sekunde ohne Neuladen. Mit „Bewegung reduzieren“ springt der Balken minutenweise.
// role="timer" ist von sich aus still - kein Vorlesen jede Sekunde.

export function MatchClock({ startedAt, durationMinutes, testId = "match-clock", className = "" }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const info = matchClock(startedAt, durationMinutes, now, { stepped: !motionAllowed() });
  if (!info) return null;
  const label = info.limit ? `Spielzeit ${info.text} von ${info.limit}` : `Spielzeit ${info.text}`;
  return (
    <div className={`tls-live-clock ${className}`} data-tone={info.tone} data-testid={testId} role="timer" aria-label={label}>
      <div className="flex items-baseline gap-2">
        <span className="tls-live-clock-time font-display text-2xl font-bold tabular-nums text-white">{info.text}</span>
        {info.limit ? <span className="text-xs text-white/55">/ {info.limit}</span> : null}
        {info.tone === "over" && info.overMinutes ? <span className="ml-auto text-xs font-bold text-live">+{info.overMinutes} Min.</span> : null}
      </div>
      {info.ratio !== null ? (
        <div className="tls-live-clock-track mt-1.5" aria-hidden="true">
          <div className="tls-live-clock-bar" data-testid={`${testId}-bar`} style={{ transform: `scaleX(${info.ratio})` }} />
        </div>
      ) : null}
    </div>
  );
}
