/**
 * Phase 5 — Unified stream embed.
 * Only renders a stream block when the parent object explicitly enables it
 * via `has_live_stream`. Falls back to the legacy `twitch_*` fields for
 * backwards compatibility.
 */
import { Radio, ExternalLink } from "lucide-react";
import { useCookieConsent } from "@/components/tls/CookieConsent";

function normalizeTwitchChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw.replace(/^@/, "")}`);
    if (/(^|\.)twitch\.tv$/i.test(parsed.hostname)) {
      return (parsed.pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "").toLowerCase();
    }
  } catch {
    // Fall through to handle cleanup below.
  }
  return raw.replace(/^@/, "").replace(/^twitch\.tv\//i, "").replace(/^www\.twitch\.tv\//i, "").split(/[/?#]/)[0].toLowerCase();
}

export function StreamEmbed({ source }) {
  const { hasConsent, openSettings } = useCookieConsent();
  if (!source) return null;
  const enabled = source.has_live_stream === true || (source.twitch_enabled && source.twitch_channel);
  if (!enabled) return null;

  const platform = String(source.stream_platform || (source.twitch_channel ? "twitch" : "")).toLowerCase();
  const legacyTwitchChannel = normalizeTwitchChannel(source.twitch_channel);
  const url = source.stream_url || (legacyTwitchChannel ? `https://www.twitch.tv/${legacyTwitchChannel}` : null);
  if (!platform) return null;

  let embedSrc = null;
  if (platform === "twitch") {
    const channel = normalizeTwitchChannel(source.stream_url || source.twitch_channel);
    if (channel) {
      const params = new URLSearchParams({ channel, parent: window.location.hostname, muted: "true", autoplay: "false" });
      embedSrc = `https://player.twitch.tv/?${params.toString()}`;
    }
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
    <div className="border border-[#FF3B30]/30 bg-[#0A0A0A] rounded-sm overflow-hidden min-w-0 max-w-full">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#FF3B30]/10 border-b border-[#FF3B30]/20">
        <Radio className="w-4 h-4 text-[#FF3B30] animate-pulse" />
        <span className="font-display tracking-widest font-bold text-sm text-[#FF3B30]">{source.stream_title || "LIVE STREAM"}</span>
        <span className="ml-auto text-[10px] uppercase tracking-widest text-white/50">{platform.toUpperCase()}</span>
        {url && <a href={url} target="_blank" rel="noreferrer" data-testid="stream-open-external" className="text-[10px] uppercase tracking-widest text-white/70 hover:text-white inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Öffnen</a>}
      </div>
      {embedSrc && hasConsent("external_media") ? (
        <div className="aspect-video min-h-[180px] sm:min-h-0">
          <iframe src={embedSrc} className="block w-full h-full border-0" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen frameBorder={0} title="Live Stream" />
        </div>
      ) : embedSrc ? (
        <div className="p-8 text-center">
          <Radio className="w-10 h-10 mx-auto text-[#FF3B30] mb-3" />
          <div className="font-heading font-black uppercase">Stream-Einbettung blockiert</div>
          <div className="text-xs text-white/50 mt-1">Für externe Medien brauchen wir deine Zustimmung.</div>
          <button type="button" onClick={openSettings} className="mt-4 px-4 py-2 border border-[#FF3B30]/50 text-[#FF3B30] text-xs uppercase tracking-wider font-bold rounded-sm">Cookie-Einstellungen</button>
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
