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
  const items = shouldMarquee ? [...logoSponsors, ...logoSponsors] : logoSponsors;
  const speed = compact ? Math.max(24, logoSponsors.length * 8) : spotlight ? Math.max(34, logoSponsors.length * 12) : 48;
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
          className={`flex items-center ${compact ? "gap-5 sm:gap-8 md:gap-12 py-2" : spotlight ? "gap-14 py-6 md:py-7" : "gap-16 py-5"} ${shouldMarquee ? "whitespace-nowrap group-hover:[animation-play-state:paused]" : "justify-center flex-wrap px-4"}`}
          style={shouldMarquee ? { animation: `tls-marquee ${speed}s linear infinite`, width: "max-content" } : undefined}
        >
          {items.map((s, i) => (
            <a
              key={`${sponsorKey(s)}-${i}`}
              href={s.link || undefined}
              target={s.link ? "_blank" : undefined}
              rel="noreferrer"
              className={`inline-flex items-center justify-center shrink-0 opacity-80 hover:opacity-100 transition ${itemClass || tierBox[s.tier] || tierBox.bronze}`}
              title={s.name}
            >
              <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className="max-h-full max-w-full w-auto h-auto" />
            </a>
          ))}
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
  const items = shouldMarquee ? [...logoSponsors, ...logoSponsors] : logoSponsors.slice(0, max);
  const speed = Math.max(26, logoSponsors.length * 7);
  return (
    <div
      className={`min-w-0 ${shouldMarquee ? "relative overflow-hidden" : "flex items-center justify-end"} ${className}`}
      data-testid="sponsor-grid"
      style={shouldMarquee ? { maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" } : undefined}
    >
      <div
        className={`flex items-center gap-7 ${shouldMarquee ? "w-max whitespace-nowrap" : ""}`}
        style={shouldMarquee ? { animation: `tls-marquee ${speed}s linear infinite` } : undefined}
      >
        {items.map((s, index) => (
          <a key={`${sponsorKey(s)}-${index}`} href={s.link || undefined} target={s.link ? "_blank" : undefined} rel="noreferrer" className={`inline-flex items-center justify-center shrink-0 opacity-80 hover:opacity-100 transition ${s.tier === "main" ? "h-9 w-36 sm:h-10 sm:w-52" : s.tier === "platinum" ? "h-8 w-32 sm:h-9 sm:w-48" : "h-8 w-28 sm:w-44"}`} title={s.name}>
            <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className="max-h-full max-w-full w-auto h-auto" />
          </a>
        ))}
      </div>
      {shouldMarquee && <style>{`@keyframes tls-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>}
    </div>
  );
}
