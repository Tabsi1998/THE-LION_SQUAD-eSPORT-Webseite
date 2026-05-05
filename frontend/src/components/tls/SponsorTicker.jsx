/**
 * SponsorTicker — Seamless infinite horizontal marquee for sponsor logos/names.
 * Duplicates the sponsor list once so the CSS animation can loop seamlessly.
 */
import { useEffect, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";

export function SponsorTicker({ className = "", compact = false, placement = "home" }) {
  const [sponsors, setSponsors] = useState([]);
  useEffect(() => {
    (async () => {
      try { const { data } = await api.get(`/sponsors?placement=${placement}`); setSponsors(data || []); }
      catch { setSponsors([]); }
    })();
  }, [placement]);
  if (!sponsors.length) return null;
  const items = [...sponsors, ...sponsors]; // duplicate for seamless loop
  const speed = compact ? 28 : 36;
  return (
    <section className={`relative overflow-hidden border-y border-white/5 bg-[#0A0A0A] ${className}`} data-testid="sponsor-ticker">
      {!compact && (
        <div className="max-w-7xl mx-auto px-4 py-3 text-center">
          <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/40">Presented by our Partners</span>
        </div>
      )}
      <div className="relative overflow-hidden group">
        <div
          className="flex gap-12 whitespace-nowrap"
          style={{ animation: `tls-marquee ${speed}s linear infinite`, width: "max-content" }}
        >
          {items.map((s, i) => (
            <div key={`${s.id}-${i}`} className="inline-flex items-center gap-3 py-4 px-2 shrink-0">
              {s.logo_url ? (
                <img src={resolveMediaUrl(s.logo_url)} alt={s.name} className={`${compact ? "h-8" : "h-10"} w-auto object-contain opacity-80 group-hover:opacity-100 transition`} />
              ) : (
                <div className={`${compact ? "h-8 w-8" : "h-10 w-10"} rounded-sm bg-[#29B6E8]/10 border border-[#29B6E8]/20 flex items-center justify-center text-[#29B6E8] font-display font-bold text-xs`}>
                  {s.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <div className={`font-heading font-bold uppercase text-white ${compact ? "text-sm" : "text-lg"} tracking-tight`}>{s.name}</div>
                {!compact && s.tier && (
                  <div className="text-[10px] uppercase tracking-widest font-bold text-[#FFD700]">{s.tier}</div>
                )}
              </div>
              <span className="mx-4 text-white/10">◆</span>
            </div>
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
  useEffect(() => {
    (async () => {
      try { const { data } = await api.get("/sponsors?placement=footer"); setSponsors(data || []); }
      catch { setSponsors([]); }
    })();
  }, []);
  if (!sponsors.length) return null;
  return (
    <div className="flex items-center gap-4" data-testid="sponsor-grid">
      {sponsors.slice(0, max).map((s) => (
        <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 border border-white/10 rounded-sm bg-white/[0.02]">
          {s.logo_url ? (
            <img src={resolveMediaUrl(s.logo_url)} alt={s.name} className="h-6 w-auto object-contain" />
          ) : (
            <div className="h-6 w-6 rounded-sm bg-[#29B6E8]/10 border border-[#29B6E8]/20 flex items-center justify-center text-[#29B6E8] text-[10px] font-display font-bold">
              {s.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className="font-heading text-sm font-bold uppercase text-white truncate max-w-[140px]">{s.name}</span>
        </div>
      ))}
    </div>
  );
}
