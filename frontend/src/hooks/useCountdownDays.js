import { useEffect, useState } from "react";
import { getCachedBranding, onBrandingUpdated } from "@/lib/brandingEvents";
import { countdownDays } from "@/lib/countdownRule";

/**
 * Ab wie vielen Tagen vorher die Website zählt (#1264) - aus den öffentlichen Einstellungen (`countdown_days`,
 * Verwaltung → Branding), Vorgabe 14. Folgt einer Änderung ohne Neuladen.
 */
export function useCountdownDays() {
  const [days, setDays] = useState(() => countdownDays(getCachedBranding()?.countdown_days));
  useEffect(() => onBrandingUpdated((settings) => setDays(countdownDays(settings?.countdown_days))), []);
  return days;
}
