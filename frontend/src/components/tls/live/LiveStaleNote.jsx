import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { staleText } from "@/lib/liveQueue";

// „Letzter Stand vor 25 s“ (#2440): Scheitert das Nachladen am Turniertag (WLAN vor Ort, Server), bleibt der letzte Stand
// stehen und dieser ruhige Hinweis zählt mit. Er verschwindet, sobald ein Abruf wieder gelingt.
// Screenreader: Der Bereich `role="status"` steht immer da (eine Live-Region, die erst mit ihrem Inhalt kommt, wird oft
// nicht vorgelesen). Bei einem Ausfall kommt einmal ein fester Satz hinein; die mitzählende Zeile liegt außerhalb und
// wird so nicht jede Sekunde vorgelesen. Immer einsetzen - ohne `since` (0) bleibt nur der leere Bereich.
// `inRegion`: Steht der Hinweis schon in einer Live-Region (Spieler-Zeile „Du bist als Nächstes“), sagt diese den Satz;
// die mitzählende Zeile ist dort für Screenreader ausgeblendet.
export const STALE_SPOKEN = "Verbindung gestört – der letzte Stand bleibt stehen.";

export function LiveStaleNote({ since = 0, className = "", testId = "live-stale-note", inRegion = false }) {
  return (
    <>
      {inRegion
        ? <span className="sr-only" data-testid={`${testId}-live`}>{since ? STALE_SPOKEN : ""}</span>
        : <div role="status" className="sr-only" data-testid={`${testId}-live`}>{since ? STALE_SPOKEN : ""}</div>}
      {/* Neu je Ausfall (`key`): die Uhr zählt ab dem Erscheinen richtig. */}
      {since ? <StaleCounter key={since} since={since} className={className} testId={testId} hidden={inRegion} /> : null}
    </>
  );
}

// Eigener Baustein, damit das Weiterzählen je Sekunde nur ihn neu zeichnet, nicht die ganze Seite.
function StaleCounter({ since, className, testId, hidden }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className={`flex items-start gap-2 text-xs text-white/60 ${className}`} aria-hidden={hidden || undefined} data-testid={testId}>
      <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{staleText(Math.max(0, now - since))}</span>
    </p>
  );
}
