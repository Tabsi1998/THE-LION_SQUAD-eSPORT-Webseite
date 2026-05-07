/**
 * SponsorTicker — seamless logo marquee.
 */
import { useCallback, useEffect, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { SmartLogo } from "@/components/tls/SmartLogo";

const tierSize = {
  main: "h-14 md:h-16",
  platinum: "h-12 md:h-14",
  gold: "h-11 md:h-12",
  silver: "h-10",
  bronze: "h-9",
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
  const shouldMarquee = logoSponsors.length >= (compact ? 2 : 3);
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
          className={`flex items-center whitespace-nowrap ${compact ? "gap-12 py-2" : "gap-16 py-5"} ${shouldMarquee ? "group-hover:[animation-play-state:paused]" : "justify-center px-4"}`}
          style={shouldMarquee ? { animation: `tls-marquee ${speed}s linear infinite`, width: "max-content" } : undefined}
        >
          {items.map((s, i) => (
            <a
              key={`${sponsorKey(s)}-${i}`}
              href={s.link || undefined}
              target={s.link ? "_blank" : undefined}
              rel="noreferrer"
              className="inline-flex items-center justify-center shrink-0 min-w-32 opacity-75 hover:opacity-100 transition"
              title={s.name}
            >
              <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className={`${compact ? "h-7 max-w-32" : `${tierSize[s.tier] || "h-10"} max-w-64`} w-auto`} />
            </a>
          ))}
        </div>
      </div>
      <style>{`@keyframes tls-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </section>
  );
}

/**
 * SponsorGrid — static grid (for Bracket TV footer — multiple logos side by side)
 */
export function SponsorGrid({ max = 4 }) {
  const [sponsors, setSponsors] = useState([]);
  const load = useCallback(async () => {
    try { const { data } = await api.get("/sponsors?placement=footer"); setSponsors(data || []); }
    catch { setSponsors([]); }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useApiInvalidation(load, ["sponsors"]);
  const logoSponsors = uniqueLogoSponsors(sponsors);
  if (!logoSponsors.length) return null;
  return (
    <div className="flex items-center gap-5" data-testid="sponsor-grid">
      {logoSponsors.slice(0, max).map((s) => (
        <a key={s.id} href={s.link || undefined} target={s.link ? "_blank" : undefined} rel="noreferrer" className="inline-flex items-center justify-center opacity-75 hover:opacity-100 transition" title={s.name}>
          <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className="h-7 max-w-36 w-auto" />
        </a>
      ))}
    </div>
  );
}
