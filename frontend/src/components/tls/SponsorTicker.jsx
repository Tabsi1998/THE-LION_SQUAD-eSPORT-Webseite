/**
 * SponsorTicker — seamless logo marquee.
 */
import { useCallback, useEffect, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const tierSize = {
  main: "h-14 md:h-16",
  platinum: "h-12 md:h-14",
  gold: "h-11 md:h-12",
  silver: "h-10",
  bronze: "h-9",
};

export function SponsorTicker({ className = "", compact = false, placement = "home" }) {
  const [sponsors, setSponsors] = useState([]);
  const load = useCallback(async () => {
    try { const { data } = await api.get(`/sponsors?placement=${placement}`); setSponsors(data || []); }
    catch { setSponsors([]); }
  }, [placement]);
  useEffect(() => {
    load();
  }, [load]);
  useApiInvalidation(load, ["sponsors"]);
  if (!sponsors.length) return null;
  const items = [...sponsors, ...sponsors]; // duplicate for seamless loop
  const speed = compact ? 34 : 48;
  return (
    <section className={`relative overflow-hidden border-y border-white/5 bg-[#070707] ${className}`} data-testid="sponsor-ticker">
      {!compact && (
        <div className="max-w-7xl mx-auto px-4 pt-4 pb-1 text-right">
          <span className="text-[9px] uppercase tracking-[0.35em] font-bold text-white/35">Presented by our Partners</span>
        </div>
      )}
      <div className="relative overflow-hidden group">
        <div
          className="flex items-center gap-16 whitespace-nowrap py-5"
          style={{ animation: `tls-marquee ${speed}s linear infinite`, width: "max-content" }}
        >
          {items.map((s, i) => (
            <a
              key={`${s.id}-${i}`}
              href={s.link || undefined}
              target={s.link ? "_blank" : undefined}
              rel="noreferrer"
              className="inline-flex items-center justify-center shrink-0 min-w-32 opacity-75 hover:opacity-100 transition"
              title={s.name}
            >
              {s.logo_url ? (
                <img src={resolveMediaUrl(s.logo_url)} alt={s.name} className={`${compact ? "h-8" : tierSize[s.tier] || "h-10"} max-w-56 object-contain`} />
              ) : (
                <span className="font-heading font-black uppercase text-white/80">{s.name}</span>
              )}
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
  if (!sponsors.length) return null;
  return (
    <div className="flex items-center gap-5" data-testid="sponsor-grid">
      {sponsors.slice(0, max).map((s) => (
        <a key={s.id} href={s.link || undefined} target={s.link ? "_blank" : undefined} rel="noreferrer" className="inline-flex items-center justify-center opacity-75 hover:opacity-100 transition" title={s.name}>
          {s.logo_url ? (
            <img src={resolveMediaUrl(s.logo_url)} alt={s.name} className="h-7 max-w-32 object-contain" />
          ) : (
            <span className="font-heading text-xs font-bold uppercase text-white/70">{s.name}</span>
          )}
        </a>
      ))}
    </div>
  );
}
