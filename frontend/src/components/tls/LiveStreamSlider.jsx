/**
 * Phase E — Live-Streamer-Slider for HomePage.
 *
 * Polls /api/streams/live every 60s. Renders horizontal scroller with
 * pulsating LIVE-Dot, viewer count, game name, thumbnail.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Tv, Eye } from "lucide-react";

export function LiveStreamSlider() {
  const [streams, setStreams] = useState([]);

  useEffect(() => {
    const load = () => api.get("/streams/live").then(({ data }) => setStreams(data || [])).catch(() => setStreams([]));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  if (!streams.length) return null;

  return (
    <section className="border-y border-white/10 bg-[#0A0A0A]" data-testid="live-streams-slider">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF3B30] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#FF3B30]" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FF3B30]">LIVE JETZT</span>
            <Tv className="w-3.5 h-3.5 text-[#9146FF]" />
          </div>
          <span className="text-[10px] uppercase tracking-widest text-white/40">{streams.length} {streams.length === 1 ? "Stream" : "Streams"}</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 snap-x">
          {streams.map((s) => (
            <a
              key={s.user_id}
              href={s.stream_url}
              target="_blank"
              rel="noreferrer"
              data-testid={`live-stream-${s.username}`}
              className="snap-start shrink-0 w-72 border border-white/10 hover:border-[#9146FF]/50 rounded-sm bg-[#121212] overflow-hidden transition group"
            >
              <div className="relative aspect-video bg-[#0A0A0A]">
                {s.thumbnail_url && (
                  <img src={s.thumbnail_url} alt={s.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform" />
                )}
                <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-[#FF3B30] text-white text-[9px] font-bold uppercase tracking-widest rounded-sm flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white" /> Live
                </div>
                <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 text-white text-[10px] font-bold rounded-sm flex items-center gap-1">
                  <Eye className="w-3 h-3" /> {s.viewer_count?.toLocaleString("de-DE") || 0}
                </div>
              </div>
              <div className="p-3">
                <div className="font-semibold text-sm truncate">{s.display_name || s.username}</div>
                <div className="text-xs text-white/55 truncate mt-0.5">{s.title || "—"}</div>
                {s.game_name && (
                  <div className="mt-1 text-[10px] uppercase tracking-widest text-[#9146FF]">{s.game_name}</div>
                )}
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
