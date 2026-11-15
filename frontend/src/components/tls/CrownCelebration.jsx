import { Suspense, useCallback, useEffect, useState } from "react";
import { lazyPage } from "@/lib/chunkReload";
import { OptionalBoundary } from "@/components/tls/OptionalBoundary";

// Kronen-Feier: Die Glocke meldet eine eroberte Krone über das Ereignis "tls-crown-celebration". Der Hörer bleibt
// klein und sofort da, damit kein Ereignis verloren geht; die Feier selbst (CrownCelebrationCard.jsx mit Kronen-Grafik
// und Konfetti) lädt erst mit dem ersten Ereignis (#936).
const CrownCelebrationCard = lazyPage(() => import("./CrownCelebrationCard"), { optional: true });

export function CrownCelebration() {
  const [event, setEvent] = useState(null);
  const close = useCallback(() => setEvent(null), []);

  useEffect(() => {
    const onEvent = (e) => setEvent(e.detail || {});
    window.addEventListener("tls-crown-celebration", onEvent);
    return () => window.removeEventListener("tls-crown-celebration", onEvent);
  }, []);

  useEffect(() => {
    if (!event) return undefined;
    const timer = setTimeout(() => setEvent(null), 10000);
    return () => clearTimeout(timer);
  }, [event]);

  if (!event) return null;
  return (
    // Lädt die Feier nicht, fehlt nur sie (#936).
    <OptionalBoundary quiet>
      <Suspense fallback={null}>
        <CrownCelebrationCard event={event} onClose={close} />
      </Suspense>
    </OptionalBoundary>
  );
}
