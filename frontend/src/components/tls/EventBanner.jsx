import { CalendarDays } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";

// Kopfbild eines Events (#1273, #1182): ein Bild, zwei Orte - der Kopf der Event-Seite und die Bühne der Event-Karte.
// Ein Foto füllt die Fläche (mit dem Fokuspunkt aus der Verwaltung), ein Logo steht klein und unverzerrt auf einer
// Fläche in Event-Violett - nie mehr riesige, blasse Buchstaben hinter dem Text. Ohne Bild steht ein ruhiges Zeichen.

export function bannerOf(event) {
  if (event?.banner?.url) return event.banner;
  return event?.banner_url ? { url: event.banner_url, kind: "photo", focus_x: 50, focus_y: 50 } : null;
}

export function EventBanner({ event, className = "", eager = false, testId = "event-banner" }) {
  const banner = bannerOf(event);
  const frame = `relative overflow-hidden rounded-sm aspect-[16/9] ${className}`;
  if (!banner) {
    return (
      <div className={`${frame} bg-gradient-to-br from-[#7655CC]/45 via-[#1b1530] to-[#0A0A0A] flex items-center justify-center`} data-testid={testId} data-kind="none">
        <CalendarDays className="w-12 h-12 text-white/35" aria-hidden="true" />
      </div>
    );
  }
  if (banner.kind === "logo") {
    return (
      <div className={`${frame} bg-gradient-to-br from-[#7655CC] via-[#4b3592] to-[#241944] flex items-center justify-center p-6`} data-testid={testId} data-kind="logo">
        <img src={resolveMediaUrl(banner.url)} alt="" loading={eager ? "eager" : "lazy"} decoding="async"
          className="max-h-[45%] max-w-[55%] object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.35)]" />
      </div>
    );
  }
  return (
    <div className={`${frame} bg-[#0A0A0A]`} data-testid={testId} data-kind="photo">
      <img src={resolveMediaUrl(banner.url)} alt="" loading={eager ? "eager" : "lazy"} decoding="async"
        className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: `${banner.focus_x ?? 50}% ${banner.focus_y ?? 50}%` }} />
    </div>
  );
}
