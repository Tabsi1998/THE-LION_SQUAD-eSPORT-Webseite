/**
 * Phase 5 — Unified stream embed.
 * Only renders a stream block when the parent object explicitly enables it
 * via `has_live_stream`. Falls back to the legacy `twitch_*` fields for
 * backwards compatibility.
 */
import { Radio, ExternalLink } from "lucide-react";

export function StreamEmbed({ source }) {
  if (!source) return null;
  const enabled = source.has_live_stream === true || (source.twitch_enabled && source.twitch_channel);
  if (!enabled) return null;

  const platform = source.stream_platform || (source.twitch_channel ? "twitch" : null);
  const url = source.stream_url || (source.twitch_channel ? `https://www.twitch.tv/${source.twitch_channel}` : null);
  if (!platform) return null;

  let embedSrc = null;
  if (platform === "twitch") {
    const channel = source.stream_url
      ? source.stream_url.replace(/.*twitch\.tv\//, "").replace(/\/.*$/, "")
      : source.twitch_channel;
    if (channel) embedSrc = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${window.location.hostname}&muted=true`;
  } else if (platform === "youtube" && source.stream_url) {
    const m = source.stream_url.match(/(?:youtu\.be\/|v=|\/embed\/)([\w-]{11})/);
    if (m) embedSrc = `https://www.youtube.com/embed/${m[1]}?autoplay=0`;
    else if (source.stream_url.includes("youtube.com/")) {
      const handle = source.stream_url.match(/youtube\.com\/(@[\w-]+|c\/[\w-]+|user\/[\w-]+)/)?.[1];
      if (handle) embedSrc = `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(handle)}`;
    }
  } else if (platform === "kick" && source.stream_url) {
    const channel = source.stream_url.replace(/.*kick\.com\//, "").replace(/\/.*$/, "");
    if (channel) embedSrc = `https://player.kick.com/${channel}`;
  }

  return (
    <div className="border border-[#FF3B30]/30 bg-[#0A0A0A] rounded-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#FF3B30]/10 border-b border-[#FF3B30]/20">
        <Radio className="w-4 h-4 text-[#FF3B30] animate-pulse" />
        <span className="font-display tracking-widest font-bold text-sm text-[#FF3B30]">{source.stream_title || "LIVE STREAM"}</span>
        <span className="ml-auto text-[10px] uppercase tracking-widest text-white/50">{platform.toUpperCase()}</span>
        {url && <a href={url} target="_blank" rel="noreferrer" data-testid="stream-open-external" className="text-[10px] uppercase tracking-widest text-white/70 hover:text-white inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Öffnen</a>}
      </div>
      {embedSrc ? (
        <div className="aspect-video">
          <iframe src={embedSrc} className="w-full h-full" allowFullScreen frameBorder={0} title="Live Stream" />
        </div>
      ) : url ? (
        <a href={url} target="_blank" rel="noreferrer" data-testid="stream-fallback-link" className="block p-8 text-center">
          <Radio className="w-10 h-10 mx-auto text-[#FF3B30] mb-3" />
          <div className="font-heading font-black uppercase">Stream auf {platform} öffnen</div>
          <div className="text-xs text-white/50 mt-1 break-all">{url}</div>
        </a>
      ) : null}
    </div>
  );
}
