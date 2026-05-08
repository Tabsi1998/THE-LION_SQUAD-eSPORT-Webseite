import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { openCookieSettings, useCookieConsent } from "@/components/tls/CookieConsent";
import { ExternalLink, MessageSquareText, Radio, Users } from "lucide-react";

function twitchChannel(stream) {
  return String(stream?.twitch_login || stream?.username || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function twitchParent() {
  if (typeof window === "undefined") return "";
  return window.location.hostname || "localhost";
}

function twitchPlayerSrc(channel) {
  const params = new URLSearchParams({
    channel,
    parent: twitchParent(),
    autoplay: "true",
    muted: "false",
  });
  return `https://player.twitch.tv/?${params.toString()}`;
}

function twitchChatSrc(channel) {
  const params = new URLSearchParams({
    parent: twitchParent(),
    darkpopout: "true",
  });
  return `https://www.twitch.tv/embed/${channel}/chat?${params.toString()}`;
}

export function LiveStreamSlider() {
  const [streams, setStreams] = useState([]);
  const [activeChannel, setActiveChannel] = useState("");
  const { hasConsent } = useCookieConsent();

  const load = useCallback(
    () => api.get("/streams/live").then(({ data }) => setStreams(data || [])).catch(() => setStreams([])),
    [],
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);
  useApiInvalidation(load, ["streams"]);

  useEffect(() => {
    if (!streams.length) {
      setActiveChannel("");
      return;
    }
    if (!streams.some((stream) => twitchChannel(stream) === activeChannel)) {
      setActiveChannel(twitchChannel(streams[0]));
    }
  }, [activeChannel, streams]);

  const activeStream = useMemo(
    () => streams.find((stream) => twitchChannel(stream) === activeChannel) || streams[0],
    [activeChannel, streams],
  );
  const channel = twitchChannel(activeStream);

  if (!streams.length || !activeStream || !channel) return null;

  const displayName = activeStream.display_name || activeStream.username || channel;
  const memberProfile = activeStream.member_profile || {};
  const memberName = memberProfile.gamertag || memberProfile.display_name || displayName;
  const memberHref = memberProfile.slug ? `/members/${memberProfile.slug}` : null;
  const canEmbed = hasConsent("external_media");

  return (
    <section className="border-y border-[#9146FF]/25 bg-[#07050B]" data-testid="live-streams-slider">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF3B30] opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#FF3B30]" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FF3B30]">Live aus dem Rudel</span>
              <Radio className="h-4 w-4 text-[#9146FF]" />
            </div>
            <h2 className="mt-2 font-display text-3xl font-black uppercase tracking-normal text-white sm:text-5xl">
              {memberName} ist live
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold uppercase tracking-widest text-white/55">
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-[#29B6E8]" />
              {(activeStream.viewer_count || 0).toLocaleString("de-DE")} Zuschauer
            </span>
            <a
              href={activeStream.stream_url || `https://www.twitch.tv/${channel}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[#9146FF] hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Twitch öffnen
            </a>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="overflow-hidden border border-[#9146FF]/35 bg-black shadow-[0_0_40px_rgba(145,70,255,0.12)]">
            {canEmbed ? (
              <div className="aspect-video">
                <iframe
                  src={twitchPlayerSrc(channel)}
                  className="h-full w-full"
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                  frameBorder={0}
                  title={`Twitch Stream von ${displayName}`}
                />
              </div>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center px-6 text-center">
                <Radio className="mb-3 h-10 w-10 text-[#9146FF]" />
                <div className="font-display text-xl font-black uppercase text-white">Twitch blockiert</div>
                <div className="mt-1 max-w-md text-sm text-white/55">
                  Für Player und Chat brauchen wir deine Zustimmung für externe Medien.
                </div>
                <button
                  type="button"
                  onClick={openCookieSettings}
                  className="mt-5 border border-[#9146FF]/60 px-4 py-2 text-xs font-bold uppercase tracking-widest text-[#9146FF] hover:border-[#9146FF] hover:bg-[#9146FF]/10"
                >
                  Cookie-Einstellungen
                </button>
              </div>
            )}
            <div className="border-t border-white/10 bg-[#101010] p-4">
              <div className="line-clamp-2 font-semibold text-white">{activeStream.title || "Live-Stream"}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
                {activeStream.game_name && <span className="text-[#9146FF]">{activeStream.game_name}</span>}
                {memberHref && (
                  <a href={memberHref} className="text-[#29B6E8] hover:text-white">
                    Vereinsprofil ansehen
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-h-[380px] flex-col overflow-hidden border border-[#9146FF]/35 bg-[#0A0A0A]">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <MessageSquareText className="h-4 w-4 text-[#9146FF]" />
              <span className="font-display text-sm font-black uppercase tracking-widest text-white">Live-Chat</span>
            </div>
            {canEmbed ? (
              <iframe
                src={twitchChatSrc(channel)}
                className="min-h-[360px] w-full flex-1"
                frameBorder={0}
                title={`Twitch Chat von ${displayName}`}
              />
            ) : (
              <div className="flex h-[360px] items-center justify-center px-5 text-center text-sm text-white/55">
                Der Chat wird nach Zustimmung für externe Medien geladen.
              </div>
            )}
          </div>
        </div>

        {streams.length > 1 && (
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {streams.map((stream) => {
              const itemChannel = twitchChannel(stream);
              const isActive = itemChannel === channel;
              return (
                <button
                  key={`${stream.user_id}-${itemChannel}`}
                  type="button"
                  onClick={() => setActiveChannel(itemChannel)}
                  className={`min-w-[220px] border p-3 text-left transition ${
                    isActive ? "border-[#9146FF] bg-[#9146FF]/15" : "border-white/10 bg-[#121212] hover:border-[#9146FF]/50"
                  }`}
                >
                  <div className="text-sm font-bold text-white">{stream.member_profile?.gamertag || stream.display_name || stream.username}</div>
                  <div className="mt-1 truncate text-xs text-white/50">{stream.title || "Live-Stream"}</div>
                  <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#FF3B30]">Live</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
