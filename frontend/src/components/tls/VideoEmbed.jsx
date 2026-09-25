import { ExternalLink, PlayCircle } from "lucide-react";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";

// Video auf der News-Seite (#578): der YouTube-Player erst nach Zustimmung zu externen Medien
// (Cookie-Hinweis), davor der Hinweis mit Link - und immer über youtube-nocookie.com.

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"]);

export function youtubeVideoId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return "";
  const path = parsed.pathname.split("/").filter(Boolean);
  const id = parsed.hostname.toLowerCase() === "youtu.be"
    ? path[0]
    : parsed.searchParams.get("v") || (["embed", "shorts", "live"].includes(path[0]) ? path[1] : "");
  return /^[\w-]{11}$/.test(id || "") ? id : "";
}

export function VideoEmbed({ url, title = "Video", className = "" }) {
  const { hasConsent } = useCookieConsent();
  const videoId = youtubeVideoId(url);
  if (!videoId) return null;
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return (
    <div className={`border border-white/10 bg-[#0A0A0A] rounded-sm overflow-hidden ${className}`} data-testid="video-embed">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-[#121212]">
        <PlayCircle className="w-4 h-4 text-[#FF3B30]" />
        <span className="text-xs font-bold uppercase tracking-widest text-white/70 truncate">Video</span>
        <a href={watchUrl} target="_blank" rel="noopener noreferrer" data-testid="video-embed-external" className="ml-auto text-[10px] uppercase tracking-widest text-white/60 hover:text-white inline-flex items-center gap-1">
          <ExternalLink className="w-3 h-3" /> Auf YouTube
        </a>
      </div>
      {hasConsent("external_media") ? (
        <div className="aspect-video">
          <iframe src={src} className="block w-full h-full border-0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen title={title} data-testid="video-embed-frame" />
        </div>
      ) : (
        <ExternalMediaNotice service="YouTube" reason="Der Player von YouTube wird erst nach deiner Zustimmung zu externen Medien geladen." url={watchUrl} accent="#FF3B30" testId="video-consent-notice" />
      )}
    </div>
  );
}
