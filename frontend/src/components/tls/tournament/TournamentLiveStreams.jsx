import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Radio, Users } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";

// „Turnier live“ (#579): streamt ein Teilnehmer, während das Turnier läuft, steht hier der Kasten
// „Live“ mit den Streams - den ersten als Player (erst nach Zustimmung zu externen Medien), die
// anderen als Zeilen mit „Zuschauen“. Der Server liefert nur Teilnehmer mit öffentlichem Profil.

export function twitchPlayerSrc(channel, host = typeof window !== "undefined" ? window.location.hostname : "") {
  const params = new URLSearchParams({ channel, parent: host || "localhost", muted: "true", autoplay: "false" });
  return `https://player.twitch.tv/?${params.toString()}`;
}

export function TournamentLiveStreams({ tournament }) {
  const key = tournament?.slug || tournament?.id;
  const [streams, setStreams] = useState([]);
  const { hasConsent } = useCookieConsent();

  const load = useCallback(() => {
    if (!key) return Promise.resolve();
    return api.get(`/tournaments/${encodeURIComponent(key)}/streams`).then(({ data }) => setStreams(Array.isArray(data) ? data : [])).catch(() => setStreams([]));
  }, [key]);
  useEffect(() => { load(); }, [load]);
  // Ob jemand streamt, weiß der Server nur durch eigenes Nachfragen bei Twitch - deshalb einmal pro Minute.
  useLiveRefresh(load, ["streams"], { pollMs: 60000 });

  if (!streams.length) return null;
  const [first, ...rest] = streams;
  const channel = String(first.twitch_login || first.username || "").toLowerCase();
  const name = first.display_name || first.username || channel;
  return (
    <section className="border border-[#9146FF]/35 bg-[#0A0A0A] rounded-sm overflow-hidden" data-testid="tournament-live-streams">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-[#9146FF]/10 border-b border-[#9146FF]/20">
        <Radio className="w-4 h-4 text-[#FF3B30] animate-pulse" />
        <span className="text-sm font-display tracking-widest font-bold text-white">Live: {streams.length === 1 ? `${name} streamt das Turnier` : `${streams.length} Teilnehmer streamen das Turnier`}</span>
        <a href={first.stream_url || `https://www.twitch.tv/${channel}`} target="_blank" rel="noopener noreferrer" data-testid="tournament-live-open" className="ml-auto text-[10px] uppercase tracking-widest text-white/70 hover:text-white inline-flex items-center gap-1">
          <ExternalLink className="w-3 h-3" /> Zuschauen
        </a>
      </div>
      {channel && (hasConsent("external_media") ? (
        <div className="aspect-video min-h-[180px] sm:min-h-0">
          <iframe src={twitchPlayerSrc(channel)} className="block w-full h-full border-0" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={`Stream von ${name}`} data-testid="tournament-live-frame" />
        </div>
      ) : (
        <ExternalMediaNotice service="Twitch Stream" reason="Player und Tracking von Twitch werden erst nach Zustimmung zu externen Medien geladen." url={first.stream_url || `https://www.twitch.tv/${channel}`} accent="#9146FF" testId="tournament-live-consent" />
      ))}
      <ul className="divide-y divide-white/5">
        {streams.map((stream) => (
          <li key={stream.user_id || stream.stream_id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`tournament-live-${stream.user_id}`}>
            <span className="w-9 h-9 rounded-sm border border-white/10 bg-[#121212] overflow-hidden inline-flex items-center justify-center shrink-0">
              {stream.avatar_url ? <img src={resolveMediaUrl(stream.avatar_url)} alt="" className="w-full h-full object-cover" /> : <Users className="w-4 h-4 text-white/40" />}
            </span>
            <span className="min-w-0 flex-1">
              {stream.public_profile_url ? (
                <Link to={stream.public_profile_url} className="block font-bold text-white truncate hover:text-[#9146FF]">{stream.display_name || stream.username}</Link>
              ) : (
                <span className="block font-bold text-white truncate">{stream.display_name || stream.username}</span>
              )}
              <span className="block text-xs text-white/50 truncate">{[stream.title, stream.game_name].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="text-[11px] text-white/45 inline-flex items-center gap-1 shrink-0"><Users className="w-3 h-3" /> {(stream.viewer_count || 0).toLocaleString("de-DE")}</span>
            <a href={stream.stream_url || `https://www.twitch.tv/${String(stream.twitch_login || "").toLowerCase()}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold uppercase tracking-widest text-[#9146FF] hover:text-white shrink-0">Zuschauen</a>
          </li>
        ))}
      </ul>
      {rest.length > 0 && null}
    </section>
  );
}
