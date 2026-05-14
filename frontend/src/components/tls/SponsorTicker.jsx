/**
 * SponsorTicker — seamless logo marquee.
 */
import { useCallback, useEffect, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { SmartLogo } from "@/components/tls/SmartLogo";

const tierBox = {
  main: "h-16 w-64 md:w-80",
  platinum: "h-14 w-56 md:w-72",
  gold: "h-12 w-52 md:w-64",
  silver: "h-11 w-48 md:w-56",
  bronze: "h-10 w-44 md:w-52",
};

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

function repeatForLoop(items, minItems) {
  if (!items.length) return [];
  const repeats = Math.max(1, Math.ceil(minItems / items.length));
  return Array.from({ length: repeats }, () => items).flat();
}

function marqueeDuration(itemCount, secondsPerItem, minSeconds) {
  return Math.max(minSeconds, itemCount * secondsPerItem);
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
  if (!logoSponsors.length) return null;
  const shouldMarquee = logoSponsors.length >= (compact ? 3 : spotlight ? 2 : 3);
  const loopItems = shouldMarquee ? repeatForLoop(logoSponsors, compact ? 14 : spotlight ? 8 : 10) : logoSponsors;
  const speed = compact
    ? marqueeDuration(loopItems.length, 7, 72)
    : spotlight
      ? marqueeDuration(loopItems.length, 8, 64)
      : marqueeDuration(loopItems.length, 6, 60);
  const shellClass = compact
    ? "bg-transparent"
    : spotlight
      ? "border-y border-[#29B6E8]/15 bg-black"
      : "border-y border-white/5 bg-[#070707]";
  const itemClass = compact
    ? "h-9 w-32 sm:w-40 md:h-10 md:w-52"
    : spotlight
      ? "h-20 w-72 sm:h-24 sm:w-[28rem] md:h-28 md:w-[34rem]"
      : null;
  const gapClass = compact ? "gap-5 sm:gap-8 md:gap-12" : spotlight ? "gap-14" : "gap-16";
  const groupPaddingClass = compact ? "pr-5 sm:pr-8 md:pr-12" : spotlight ? "pr-14" : "pr-16";
  const verticalClass = compact ? "py-2" : spotlight ? "py-6 md:py-7" : "py-5";
  const renderLogo = (s, i, groupIndex = 0, duplicate = false) => (
    <a
      key={`${groupIndex}-${sponsorKey(s)}-${i}`}
      href={s.link || undefined}
      target={s.link ? "_blank" : undefined}
      rel="noreferrer"
      tabIndex={duplicate ? -1 : undefined}
      className={`inline-flex items-center justify-center shrink-0 opacity-80 hover:opacity-100 transition ${itemClass || tierBox[s.tier] || tierBox.bronze}`}
      title={s.name}
    >
      <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className="max-h-full max-w-full w-auto h-auto" />
    </a>
  );
  return (
    <section className={`relative max-w-full overflow-hidden ${shellClass} ${className}`} data-testid="sponsor-ticker">
      {!compact && (
        <div className={`max-w-7xl mx-auto px-4 ${spotlight ? "pt-7 pb-1 text-center" : "pt-4 pb-1 text-right"}`}>
          <span className={`text-[9px] uppercase tracking-[0.35em] font-bold ${spotlight ? "text-[#29B6E8]/70" : "text-white/35"}`}>
            {spotlight ? "Hauptsponsor" : "Presented by our Partners"}
          </span>
        </div>
      )}
      <div
        className="relative max-w-full overflow-hidden group"
        style={shouldMarquee ? { maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" } : undefined}
      >
        <div
          className={`flex items-center ${verticalClass} ${shouldMarquee ? "whitespace-nowrap group-hover:[animation-play-state:paused]" : `justify-center flex-wrap px-4 ${gapClass}`}`}
          style={shouldMarquee ? { animation: `tls-marquee ${speed}s linear infinite`, width: "max-content" } : undefined}
        >
          {shouldMarquee ? (
            <>
              <div className={`flex shrink-0 items-center ${gapClass} ${groupPaddingClass}`}>
                {loopItems.map((s, i) => renderLogo(s, i, 0))}
              </div>
              <div className={`flex shrink-0 items-center ${gapClass} ${groupPaddingClass}`} aria-hidden="true">
                {loopItems.map((s, i) => renderLogo(s, i, 1, true))}
              </div>
            </>
          ) : loopItems.map((s, i) => renderLogo(s, i))}
        </div>
      </div>
      <style>{`@keyframes tls-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
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
