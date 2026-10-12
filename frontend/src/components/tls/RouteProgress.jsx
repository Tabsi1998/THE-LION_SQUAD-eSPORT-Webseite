import { useEffect, useState } from "react";
import { usePageLoading } from "@/lib/pageLoading";

/** Ab wann die Linie erscheint - schnelle Wechsel bleiben ruhig. */
export const ROUTE_PROGRESS_DELAY_MS = 150;

// Laden im Vereinsstil (#1324): eine 2 px dünne cyane Linie direkt unter dem Kopf, solange eine Seite lädt. Sie läuft
// von links nach rechts und steht mit „Bewegung reduzieren“ still (index.css). Unter 150 ms erscheint sie gar nicht.
export function RouteProgress() {
  const loading = usePageLoading();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShown(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShown(true), ROUTE_PROGRESS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);
  if (!shown) return null;
  return <div className="tls-route-progress" role="progressbar" aria-label="Seite lädt" data-testid="route-progress" />;
}
