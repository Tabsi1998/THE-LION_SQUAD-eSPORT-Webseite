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

export function SponsorTicker({ className = "", compact = false, placement = "home" }) {
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
  const shouldMarquee = logoSponsors.length >= (compact ? 6 : 3);
  const items = shouldMarquee ? [...logoSponsors, ...logoSponsors] : logoSponsors;
  const speed = compact ? Math.max(24, logoSponsors.length * 8) : 48;
  return (
    <section className={`relative max-w-full overflow-hidden ${compact ? "bg-transparent" : "border-y border-white/5 bg-[#070707]"} ${className}`} data-testid="sponsor-ticker">
      {!compact && (
        <div className="max-w-7xl mx-auto px-4 pt-4 pb-1 text-right">
          <span className="text-[9px] uppercase tracking-[0.35em] font-bold text-white/35">Presented by our Partners</span>
        </div>
      )}
      <div
        className="relative max-w-full overflow-hidden group"
        style={shouldMarquee ? { maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" } : undefined}
      >
        <div
          className={`flex items-center ${compact ? "gap-8 md:gap-12 py-2" : "gap-16 py-5"} ${shouldMarquee ? "whitespace-nowrap group-hover:[animation-play-state:paused]" : "justify-center flex-wrap px-4"}`}
          style={shouldMarquee ? { animation: `tls-marquee ${speed}s linear infinite`, width: "max-content" } : undefined}
        >
          {items.map((s, i) => (
            <a
              key={`${sponsorKey(s)}-${i}`}
              href={s.link || undefined}
              target={s.link ? "_blank" : undefined}
              rel="noreferrer"
              className={`inline-flex items-center justify-center shrink-0 opacity-75 hover:opacity-100 transition ${compact ? "h-10 w-44 md:w-52" : tierBox[s.tier] || tierBox.bronze}`}
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
export function SponsorGrid({ max = 4, placement = "tv" }) {
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
  return (
    <div className="flex items-center gap-5" data-testid="sponsor-grid">
      {logoSponsors.slice(0, max).map((s) => (
        <a key={s.id} href={s.link || undefined} target={s.link ? "_blank" : undefined} rel="noreferrer" className={`inline-flex items-center justify-center opacity-75 hover:opacity-100 transition ${s.tier === "main" ? "h-10 w-52" : s.tier === "platinum" ? "h-9 w-48" : "h-8 w-44"}`} title={s.name}>
          <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className="max-h-full max-w-full w-auto h-auto" />
        </a>
      ))}
    </div>
  );
}
