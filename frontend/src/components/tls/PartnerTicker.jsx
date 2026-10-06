/**
 * PartnerTicker — das kleinere Laufband mit den Partnern unter den Sponsoren (#968).
 * Sponsoren geben dem Verein etwas und bekommen eine Gegenleistung, Partner sind kostenlose
 * Partnerschaften auf Gegenseitigkeit – deshalb zwei Bänder mit Überschrift. Nur Partner mit Logo,
 * jedes Logo führt auf die Partnerseite; ohne Partner-Logos fällt das Band weg.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { LogoTicker } from "@/components/tls/LogoTicker";

const BOX = "h-12 w-44 sm:h-14 sm:w-56 md:h-16 md:w-64";

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
    <section className={`relative max-w-full overflow-hidden bg-black border-b border-[#29B6E8]/10 ${className}`} data-testid="partner-ticker">
      <div className="max-w-7xl mx-auto px-4 pt-5 pb-0 text-center">
        <span className="text-[10px] uppercase tracking-[0.35em] font-bold text-white/40">Partner</span>
      </div>
      <LogoTicker
        items={items}
        boxClassFor={() => BOX}
        minForMarquee={3}
        minItems={10}
        secondsPerItem={7}
        minSeconds={70}
        gapClass="gap-10 md:gap-14"
        groupPaddingClass="pr-10 md:pr-14"
        verticalClass="py-4 md:py-5"
        reverse
        testId="partner-ticker-band"
      />
    </section>
  );
}
