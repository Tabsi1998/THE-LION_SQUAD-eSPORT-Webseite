/**
 * SponsorTicker — das Sponsoren-Laufband (Startseite groß mit Überschrift „Sponsoren“, Footer
 * kompakt, TV-Seiten mit Zeile). Das Band selbst ist der LogoTicker (#968), den auch die Partner nutzen.
 */
import { useCallback, useEffect, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { SmartLogo } from "@/components/tls/SmartLogo";
import { LogoTicker, marqueeDuration, repeatForLoop } from "@/components/tls/LogoTicker";

const tierBox = {
  main: "h-16 w-64 md:w-80",
  platinum: "h-14 w-56 md:w-72",
  gold: "h-12 w-52 md:w-64",
  silver: "h-11 w-48 md:w-56",
  bronze: "h-10 w-44 md:w-52",
};

// Startseite (#968): eine Stufe größer als vorher (etwa +12 %), damit die Sponsoren vor den Partnern stehen.
const SPOTLIGHT_BOX = "h-[5.5rem] w-[20rem] sm:h-[6.75rem] sm:w-[31.5rem] md:h-[7.75rem] md:w-[38rem]";
const COMPACT_BOX = "h-9 w-32 sm:w-40 md:h-10 md:w-52";

function sponsorKey(sponsor) {
  const logo = String(sponsor.logo_url || "").trim().toLowerCase();
  if (logo) return `logo:${logo}`;
  const id = String(sponsor.id || "").trim().toLowerCase();
  if (id) return `id:${id}`;
  return [
    sponsor.link || "",
    sponsor.name || "",
  ].join("|").toLowerCase();
}

function uniqueLogoSponsors(sponsors) {
  const seen = new Set();
  return sponsors.filter((sponsor) => {
    if (!sponsor.logo_url) return false;
    const key = sponsorKey(sponsor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function SponsorTicker({ className = "", compact = false, placement = "home", spotlight = false }) {
  const [sponsors, setSponsors] = useState([]);
  const load = useCallback(async () => {
    try {
      const url = placement === "all" ? "/sponsors" : `/sponsors?placement=${placement}`;
      const { data } = await api.get(url);
      setSponsors(data || []);
    }
    catch { setSponsors([]); }
  }, [placement]);
  useEffect(() => {
    load();
  }, [load]);
  useApiInvalidation(load, ["sponsors"]);
  const logoSponsors = uniqueLogoSponsors(sponsors);
  // Hauptsponsor mit Banner aus dem Vereinsmodul (#880): auf der Startseite groß über dem Laufband.
  const mainBanner = spotlight ? sponsors.find((s) => s.tier === "main" && s.banner_url) : null;
  if (!logoSponsors.length && !mainBanner) return null;
  const items = logoSponsors.map((s) => ({ key: sponsorKey(s), name: s.name, logo_url: s.logo_url, href: s.link || undefined, tier: s.tier }));
  const boxClassFor = (item) => (compact ? COMPACT_BOX : spotlight ? SPOTLIGHT_BOX : tierBox[item.tier] || tierBox.bronze);
  const shellClass = compact
    ? "bg-transparent"
    : spotlight
      ? "border-y border-[#29B6E8]/15 bg-black"
      : "border-y border-white/5 bg-[#070707]";
  return (
    <section className={`relative max-w-full overflow-hidden ${shellClass} ${className}`} data-testid="sponsor-ticker">
      {!compact && !spotlight && (
        <div className="max-w-7xl mx-auto px-4 pt-4 pb-1 text-right">
          <span className="text-[9px] uppercase tracking-[0.35em] font-bold text-white/35">Presented by our Partners</span>
        </div>
      )}
      {mainBanner ? (
        <div className="max-w-5xl mx-auto px-4 pt-7 pb-1" data-testid="sponsor-main-banner">
          <div className="pb-2 text-center">
            <span className="text-[9px] uppercase tracking-[0.35em] font-bold text-[#29B6E8]/70">Hauptsponsor</span>
          </div>
          <a href={mainBanner.link || undefined} target={mainBanner.link ? "_blank" : undefined} rel="noreferrer" aria-label={mainBanner.name}
            className="block rounded-sm overflow-hidden border border-[#29B6E8]/20 hover:border-[#29B6E8]/50 transition">
            <img src={resolveMediaUrl(mainBanner.banner_url)} alt={mainBanner.name} loading="lazy" className="block w-full h-auto max-h-60 object-contain bg-[#071114]" />
          </a>
        </div>
      ) : null}
      {spotlight && items.length > 0 && (
        <div className={`max-w-7xl mx-auto px-4 ${mainBanner ? "pt-5" : "pt-6"} pb-0 text-center`} data-testid="sponsor-ticker-title">
          <span className="text-[11px] uppercase tracking-[0.35em] font-bold text-[#29B6E8]/80">Sponsoren</span>
        </div>
      )}
      {items.length > 0 && (
        <LogoTicker
          items={items}
          boxClassFor={boxClassFor}
          minForMarquee={compact ? 3 : spotlight ? 2 : 3}
          minItems={compact ? 14 : spotlight ? 8 : 10}
          secondsPerItem={compact ? 7 : spotlight ? 8 : 6}
          minSeconds={compact ? 72 : spotlight ? 64 : 60}
          gapClass={compact ? "gap-5 sm:gap-8 md:gap-12" : spotlight ? "gap-14" : "gap-16"}
          groupPaddingClass={compact ? "pr-5 sm:pr-8 md:pr-12" : spotlight ? "pr-14" : "pr-16"}
          verticalClass={compact ? "py-2" : spotlight ? "py-5 md:py-6" : "py-5"}
          testId="sponsor-ticker-band"
        />
      )}
    </section>
  );
}

/**
 * SponsorGrid — static TV/display sponsor strip.
 */
export function SponsorGrid({ max = 4, placement = "tv", marquee = false, className = "" }) {
  const [sponsors, setSponsors] = useState([]);
  const load = useCallback(async () => {
    try { const { data } = await api.get(`/sponsors?placement=${placement}`); setSponsors(data || []); }
    catch { setSponsors([]); }
  }, [placement]);
  useEffect(() => {
    load();
  }, [load]);
  useApiInvalidation(load, ["sponsors"]);
  const logoSponsors = uniqueLogoSponsors(sponsors);
  if (!logoSponsors.length) return null;
  const shouldMarquee = marquee && logoSponsors.length > max;
  const items = shouldMarquee ? repeatForLoop(logoSponsors, Math.max(10, max * 4)) : logoSponsors.slice(0, max);
  const speed = marqueeDuration(items.length, 5.5, 72);
  const renderLogo = (s, index, groupIndex = 0, duplicate = false) => (
    <a key={`${groupIndex}-${sponsorKey(s)}-${index}`} href={s.link || undefined} target={s.link ? "_blank" : undefined} rel="noreferrer" tabIndex={duplicate ? -1 : undefined} className={`inline-flex items-center justify-center shrink-0 opacity-80 hover:opacity-100 transition ${s.tier === "main" ? "h-9 w-36 sm:h-10 sm:w-52" : s.tier === "platinum" ? "h-8 w-32 sm:h-9 sm:w-48" : "h-8 w-28 sm:w-44"}`} title={s.name}>
      <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className="max-h-full max-w-full w-auto h-auto" />
    </a>
  );
  return (
    <div
      className={`min-w-0 ${shouldMarquee ? "relative overflow-hidden" : "flex items-center justify-end"} ${className}`}
      data-testid="sponsor-grid"
      style={shouldMarquee ? { maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" } : undefined}
    >
      <div
        className={`flex items-center ${shouldMarquee ? "w-max whitespace-nowrap" : "gap-7"}`}
        style={shouldMarquee ? { animation: `tls-marquee ${speed}s linear infinite` } : undefined}
      >
        {shouldMarquee ? (
          <>
            <div className="flex shrink-0 items-center gap-7 pr-7">
              {items.map((s, index) => renderLogo(s, index, 0))}
            </div>
            <div className="flex shrink-0 items-center gap-7 pr-7" aria-hidden="true">
              {items.map((s, index) => renderLogo(s, index, 1, true))}
            </div>
          </>
        ) : items.map((s, index) => renderLogo(s, index))}
      </div>
      {shouldMarquee && <style>{`@keyframes tls-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>}
    </div>
  );
}
