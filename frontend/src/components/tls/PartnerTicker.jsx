/**
 * PartnerTicker - das kleinere Laufband mit den Partnern, im Footer direkt unter den Sponsoren.
 * Sponsoren geben dem Verein etwas und bekommen eine Gegenleistung, Partner sind kostenlose
 * Partnerschaften auf Gegenseitigkeit - deshalb zwei Bänder: gleicher Grund, gleiche Machart, die Partner
 * eine Stufe kleiner und in Gegenrichtung. Nur Partner mit Logo, jedes Logo führt auf die Partnerseite;
 * ohne Partner-Logos fällt das Band weg.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { LogoTicker } from "@/components/tls/LogoTicker";

// Etwa drei Viertel der Sponsoren-Kästen im Footer (SponsorTicker, COMPACT_BOX).
const BOX = "h-8 w-28 sm:w-32 md:h-9 md:w-44";

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

export function PartnerTicker({ className = "" }) {
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
      <LogoTicker
        items={items}
        boxClassFor={() => BOX}
        minForMarquee={3}
        minItems={14}
        secondsPerItem={7}
        minSeconds={72}
        gapClass="gap-5 sm:gap-8 md:gap-12"
        groupPaddingClass="pr-5 sm:pr-8 md:pr-12"
        verticalClass="py-2"
        reverse
        testId="partner-ticker-band"
      />
    </section>
  );
}
