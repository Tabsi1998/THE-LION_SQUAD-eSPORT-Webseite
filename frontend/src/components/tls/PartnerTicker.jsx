/**
 * PartnerTicker - das kleinere Laufband mit den Partnern, im Footer direkt unter den Sponsoren.
 * Sponsoren geben dem Verein etwas und bekommen eine Gegenleistung, Partner sind kostenlose
 * Partnerschaften auf Gegenseitigkeit - deshalb zwei Bänder, jedes mit kleiner Überschrift: gleicher Grund,
 * gleiche Machart, die Partner eine Stufe kleiner, dichter gesetzt und in Gegenrichtung. Nur Partner mit Logo,
 * jedes Logo führt auf die Partnerseite; ohne Partner-Logos fällt das Band weg.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { BAND_HEADING_CLASS, LogoTicker } from "@/components/tls/LogoTicker";

// Etwa drei Viertel so hoch wie die Sponsoren-Kästen im Footer (SponsorTicker, COMPACT_BOX) und schmaler:
// kleinere Logos brauchen weniger Abstand, sonst wirkt die Reihe löchrig.
const BOX = "h-8 w-24 sm:w-28 md:h-9 md:w-32";

export function partnerTickerItems(partners) {
  return (Array.isArray(partners) ? partners : [])
    .filter((partner) => partner && partner.logo_url)
    .map((partner) => ({
      key: partner.id || partner.slug || partner.name,
      name: partner.name,
      logo_url: partner.logo_url,
      to: partner.slug ? `/partners/${partner.slug}` : undefined,
      href: partner.slug ? undefined : partner.link || undefined,
    }));
}

export function PartnerTicker({ className = "", heading = "Partner" }) {
  const [partners, setPartners] = useState([]);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/partners");
      setPartners(Array.isArray(data) ? data : []);
    } catch {
      setPartners([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["partners", "uploads"]);
  const items = partnerTickerItems(partners);
  if (!items.length) return null;
  return (
    <section className={`relative max-w-full overflow-hidden bg-transparent ${className}`} aria-label="Partner" data-testid="partner-ticker">
      {heading ? <div className={BAND_HEADING_CLASS} data-testid="partner-ticker-heading">{heading}</div> : null}
      <LogoTicker
        items={items}
        boxClassFor={() => BOX}
        minForMarquee={3}
        minItems={16}
        secondsPerItem={6}
        minSeconds={72}
        gapClass="gap-4 sm:gap-6 md:gap-8"
        groupPaddingClass="pr-4 sm:pr-6 md:pr-8"
        verticalClass="py-1"
        reverse
        testId="partner-ticker-band"
      />
    </section>
  );
}
