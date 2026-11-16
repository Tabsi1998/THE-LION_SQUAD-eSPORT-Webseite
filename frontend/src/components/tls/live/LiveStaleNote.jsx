import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { staleText } from "@/lib/liveQueue";

// „Letzter Stand vor 25 s“ (#2440): Scheitert das Nachladen am Turniertag (WLAN vor Ort, Server), bleibt der letzte Stand
// stehen und dieser ruhige Hinweis zählt mit. Er verschwindet, sobald ein Abruf wieder gelingt. Eigener Baustein, damit
// das Weiterzählen je Sekunde nur ihn neu zeichnet, nicht die ganze Seite. Screenreader hören den Hinweis einmal beim
// Erscheinen, nicht jede Sekunde. Nur einsetzen, solange es einen alten Stand gibt (`since`) - dann zählt die Uhr ab
// dem Erscheinen richtig.
export function LiveStaleNote({ since, className = "", testId = "live-stale-note" }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  if (!since) return null;
  const age = Math.max(0, now - since);
  return (
    <p className={`flex items-start gap-2 text-xs text-white/60 ${className}`} role="status" data-testid={testId}>
      <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
      <span aria-live="off" className="min-w-0 [overflow-wrap:anywhere]">{staleText(age)}</span>
    </p>
  );
}
