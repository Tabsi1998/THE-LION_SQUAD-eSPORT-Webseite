import { AtSign, Cloud, Gamepad2, Ghost, Github, Globe, Hash, Link2, Linkedin, Mail, MessageSquare, Music, Pin, Radio, Send, Video } from "lucide-react";

// Symbole der Kanäle - Footer (Socials des Vereins), Partnerseiten (#469), die Auswahl unter
// Einstellungen → Socials und die App nehmen dieselben Schlüssel und Farben. Wo es einen eigenen
// Markenpfad gibt, steht er hier (`path`); die übrigen Plattformen bekommen ein Symbol aus lucide
// (`Icon`) in ihrer Markenfarbe. `custom` ist der Kettenlink für alles Unbekannte.
export const SOCIAL_ICONS = {
  discord: {
    color: "#5865F2", hoverClass: "hover:border-[#5865F2] hover:text-[#5865F2]",
    path: "M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.42-2.157 2.42zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42z",
  },
  whatsapp: {
    color: "#25D366", hoverClass: "hover:border-[#25D366] hover:text-[#25D366]",
    path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.224-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.06 12.06 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.413-.074-.124-.272-.198-.57-.347M12.051 21.8h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.437-9.884 9.889-9.884 2.64.001 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.886 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.946L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.398",
  },
  facebook: { color: "#1877F2", hoverClass: "hover:border-[#1877F2] hover:text-[#1877F2]", path: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" },
  instagram: { color: "#E4405F", hoverClass: "hover:border-[#E4405F] hover:text-[#E4405F]", path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" },
  tiktok: { color: "#69C9D0", hoverClass: "hover:border-[#69C9D0] hover:text-[#69C9D0]", path: "M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005.8 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1.84-.1z" },
  youtube: { color: "#FF0000", hoverClass: "hover:border-[#FF0000] hover:text-[#FF0000]", path: "M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" },
  twitch: { color: "#9146FF", hoverClass: "hover:border-[#9146FF] hover:text-[#9146FF]", path: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" },
  x: { color: "#FFFFFF", hoverClass: "hover:border-white hover:text-white", path: "M18.244 2h3.308l-7.227 8.26L22.827 22h-6.657l-5.214-6.817L4.99 22H1.68l7.73-8.835L1.254 2h6.826l4.713 6.231Zm-1.161 17.93h1.833L7.084 3.963H5.117Z" },
  threads: { color: "#FFFFFF", hoverClass: "hover:border-white hover:text-white", Icon: AtSign },
  bluesky: { color: "#0085FF", hoverClass: "hover:border-[#0085FF] hover:text-[#0085FF]", Icon: Cloud },
  mastodon: { color: "#6364FF", hoverClass: "hover:border-[#6364FF] hover:text-[#6364FF]", Icon: Hash },
  telegram: { color: "#26A5E4", hoverClass: "hover:border-[#26A5E4] hover:text-[#26A5E4]", Icon: Send },
  kick: { color: "#53FC18", hoverClass: "hover:border-[#53FC18] hover:text-[#53FC18]", Icon: Radio },
  linkedin: { color: "#0A66C2", hoverClass: "hover:border-[#0A66C2] hover:text-[#0A66C2]", Icon: Linkedin },
  reddit: { color: "#FF4500", hoverClass: "hover:border-[#FF4500] hover:text-[#FF4500]", Icon: MessageSquare },
  steam: { color: "#66C0F4", hoverClass: "hover:border-[#66C0F4] hover:text-[#66C0F4]", Icon: Gamepad2 },
  github: { color: "#FFFFFF", hoverClass: "hover:border-white hover:text-white", Icon: Github },
  snapchat: { color: "#FFFC00", hoverClass: "hover:border-[#FFFC00] hover:text-[#FFFC00]", Icon: Ghost },
  pinterest: { color: "#E60023", hoverClass: "hover:border-[#E60023] hover:text-[#E60023]", Icon: Pin },
  vimeo: { color: "#1AB7EA", hoverClass: "hover:border-[#1AB7EA] hover:text-[#1AB7EA]", Icon: Video },
  spotify: { color: "#1DB954", hoverClass: "hover:border-[#1DB954] hover:text-[#1DB954]", Icon: Music },
  website: { color: "#29B6E8", hoverClass: "hover:border-[#29B6E8] hover:text-[#29B6E8]", Icon: Globe },
  email: { color: "#29B6E8", hoverClass: "hover:border-[#29B6E8] hover:text-[#29B6E8]", Icon: Mail },
  custom: { color: "#29B6E8", hoverClass: "hover:border-[#29B6E8] hover:text-[#29B6E8]", Icon: Link2, path: "M10.59 13.41a1.996 1.996 0 010-2.82l3.59-3.59a2 2 0 112.83 2.83l-1.24 1.24h2.67l.69-.69a4 4 0 00-5.66-5.66l-3.59 3.59a4 4 0 000 5.66 1 1 0 001.41-1.41zM13.41 10.59a1.996 1.996 0 010 2.82l-3.59 3.59a2 2 0 11-2.83-2.83l1.24-1.24H5.56l-.69.69a4 4 0 005.66 5.66l3.59-3.59a4 4 0 000-5.66 1 1 0 00-1.41 1.41z" },
};

// Die Auswahl unter Einstellungen → Socials, in der Reihenfolge, wie Vereine sie brauchen. Der Betreiber
// (25.09.): „die Social Links sind sehr begrenzt … X fehlt“ - deshalb hier alles, was ein Verein hat.
export const SOCIAL_PLATFORMS = [
  ["discord", "Discord"],
  ["whatsapp", "WhatsApp Kanal"],
  ["telegram", "Telegram"],
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["threads", "Threads"],
  ["x", "X (Twitter)"],
  ["bluesky", "Bluesky"],
  ["mastodon", "Mastodon"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["twitch", "Twitch"],
  ["kick", "Kick"],
  ["linkedin", "LinkedIn"],
  ["reddit", "Reddit"],
  ["steam", "Steam"],
  ["github", "GitHub"],
  ["snapchat", "Snapchat"],
  ["pinterest", "Pinterest"],
  ["vimeo", "Vimeo"],
  ["spotify", "Spotify"],
  ["email", "E-Mail (mailto:)"],
  ["website", "Website"],
  ["custom", "Eigener Link"],
];

export function socialPlatformLabel(key) {
  const hit = SOCIAL_PLATFORMS.find(([platform]) => platform === String(key || "").toLowerCase());
  return hit ? hit[1] : String(key || "Link");
}

// Ein Symbol je Plattform: Markenpfad, sonst lucide - nie „kaputt“ für eine Plattform aus der Liste.
export function socialIconFor(key) {
  return SOCIAL_ICONS[String(key || "").toLowerCase()] || SOCIAL_ICONS.custom;
}
