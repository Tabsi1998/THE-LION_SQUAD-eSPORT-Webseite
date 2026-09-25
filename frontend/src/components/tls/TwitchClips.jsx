import { useCallback, useEffect, useState } from "react";
import { Clapperboard, ExternalLink, Eye, Play } from "lucide-react";
import { api } from "@/lib/api";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";

// Clips des Vereinskanals (#579): bis zu sechs Kacheln aus den letzten 30 Tagen, vom Server abgelegt
// (Verbindungen → Twitch, Schalter „Clips auf der Startseite“). Der Clip-Player von Twitch lädt erst
// nach Zustimmung zu externen Medien; davor der Hinweis mit Link. Ohne Clips keine Kachel.

export function clipEmbedSrc(clipId, host = typeof window !== "undefined" ? window.location.hostname : "") {
  return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clipId)}&parent=${encodeURIComponent(host || "localhost")}&autoplay=true`;
}

export function durationText(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function TwitchClips() {
  const [clips, setClips] = useState([]);
  const [active, setActive] = useState(null);
  const { hasConsent } = useCookieConsent();

  const load = useCallback(() => api.get("/streams/clips").then(({ data }) => setClips(Array.isArray(data) ? data : [])).catch(() => setClips([])), []);
  useEffect(() => { load(); }, [load]);

  if (!clips.length) return null;
  return (
    <section className="border-b border-[#9146FF]/20 bg-[#0A0A0A]" data-testid="twitch-clips">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9146FF] inline-flex items-center gap-2"><Clapperboard className="w-4 h-4" /> Clips aus dem Rudel</span>
            <h2 className="mt-2 font-display text-3xl font-black uppercase text-white sm:text-4xl">Die besten Momente der letzten 30 Tage</h2>
          </div>
          {active && (
            <button type="button" onClick={() => setActive(null)} className="text-[11px] font-bold uppercase tracking-widest text-white/55 hover:text-white" data-testid="twitch-clips-close">Player schließen</button>
          )}
        </div>
        {active && (
          <div className="mt-6 overflow-hidden border border-[#9146FF]/35 bg-black" data-testid="twitch-clips-player">
            {hasConsent("external_media") ? (
              <div className="aspect-video">
                <iframe src={clipEmbedSrc(active.id)} className="h-full w-full border-0" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={active.title} data-testid="twitch-clips-frame" />
              </div>
            ) : (
              <ExternalMediaNotice service="Twitch Clip" reason="Der Clip-Player von Twitch wird erst nach deiner Zustimmung zu externen Medien geladen." url={active.url} accent="#9146FF" testId="twitch-clips-consent" />
            )}
          </div>
        )}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clips.map((clip) => (
            <button
              key={clip.id}
              type="button"
              onClick={() => setActive(clip)}
              data-testid={`twitch-clip-${clip.id}`}
              className={`group text-left border bg-[#121212] overflow-hidden rounded-sm transition ${active?.id === clip.id ? "border-[#9146FF]" : "border-white/10 hover:border-[#9146FF]/60"}`}
            >
              <div className="relative aspect-video bg-black">
                {clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition"><Play className="w-10 h-10 text-white" /></span>
                <span className="absolute bottom-2 right-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{durationText(clip.duration)}</span>
              </div>
              <div className="p-3">
                <div className="font-bold text-white truncate">{clip.title}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-white/45">
                  <span className="truncate">{clip.creator_name ? `Clip von ${clip.creator_name}` : "Clip"}</span>
                  <span className="inline-flex items-center gap-1 shrink-0"><Eye className="w-3 h-3" /> {(clip.view_count || 0).toLocaleString("de-DE")}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
        {active && (
          <a href={active.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#9146FF] hover:text-white" data-testid="twitch-clips-external">
            <ExternalLink className="w-3.5 h-3.5" /> Auf Twitch öffnen
          </a>
        )}
      </div>
    </section>
  );
}
