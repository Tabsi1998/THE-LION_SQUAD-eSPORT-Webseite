import { Globe } from "lucide-react";
import { SOCIAL_ICONS } from "@/lib/socialIcons";

// Symbol eines Kanals (Partnerseiten #469): dieselben Pfade und Farben wie die Socials im Footer;
// Website und Unbekanntes bekommen den Globus.

export function channelColor(kind) {
  return SOCIAL_ICONS[String(kind || "").toLowerCase()]?.color || "#29B6E8";
}

export function ChannelIcon({ kind, className = "w-4 h-4" }) {
  const key = String(kind || "").toLowerCase();
  const icon = key !== "website" && key !== "custom" ? SOCIAL_ICONS[key] : null;
  if (!icon) return <Globe className={className} aria-hidden="true" />;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={icon.path} />
    </svg>
  );
}
