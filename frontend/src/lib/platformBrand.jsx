import { AtSign, Bird, Box, Castle, CircleDot, Crosshair, Facebook, Flag, Gamepad2, Ghost, Github, Globe, Globe2, Linkedin, MessageCircle, Music2, Orbit, Pin, Radio, Send, Shield, Trophy, Zap } from "lucide-react";

// Marken der Plattformen an einer Stelle (#527, #521): Kennung, Name, Farbe und Logo je Plattform -
// für das öffentliche Profil (Kasten „Konten“) und die Knöpfe „Mit … verknüpfen“ im eigenen Profil.
// Farben nach den Vorgaben der Plattformen (Discord „Blurple“, Twitch-Lila, Steam dunkel mit Hellblau).

export function platformMeta(link) {
  const platform = String(link.platform || link.label || "").toLowerCase();
  if (platform.includes("discord")) return { key: "discord", label: "Discord", color: "#5865F2" };
  if (platform.includes("twitch")) return { key: "twitch", label: "Twitch", color: "#9146FF" };
  if (platform.includes("youtube")) return { key: "youtube", label: "YouTube", color: "#FF0000" };
  if (platform.includes("instagram")) return { key: "instagram", label: "Instagram", color: "#E4405F" };
  if (platform.includes("tiktok")) return { key: "tiktok", label: "TikTok", color: "#69C9D0" };
  if (platform === "x" || platform.includes("twitter")) return { key: "x", label: "X", color: "#FFFFFF" };
  if (platform.includes("steam")) return { key: "steam", label: "Steam", color: "#66C0F4" };
  if (platform.includes("battle")) return { key: "battlenet", label: "Battle.net", color: "#148EFF" };
  if (platform.includes("riot")) return { key: "riot", label: "Riot Games", color: "#D13639" };
  if (platform.includes("xbox")) return { key: "xbox", label: "Xbox", color: "#107C10" };
  if (platform.includes("epic")) return { key: "epic", label: "Epic Games", color: "#C8C8C8" };
  if (platform.includes("psn") || platform.includes("playstation")) return { key: "psn", label: "PlayStation", color: "#0070D1" };
  if (platform.includes("nintendo")) return { key: "nintendo", label: "Nintendo", color: "#E60012" };
  if (platform === "ea") return { key: "ea", label: "EA", color: "#FF4747" };
  if (platform === "mastodon") return { key: "mastodon", label: "Mastodon", color: "#6364FF" };
  if (platform === "bluesky") return { key: "bluesky", label: "Bluesky", color: "#0085FF" };
  if (platform === "threads") return { key: "threads", label: "Threads", color: "#FFFFFF" };
  if (platform === "facebook") return { key: "facebook", label: "Facebook", color: "#1877F2" };
  if (platform === "linkedin") return { key: "linkedin", label: "LinkedIn", color: "#0A66C2" };
  if (platform === "snapchat") return { key: "snapchat", label: "Snapchat", color: "#FFFC00" };
  if (platform === "pinterest") return { key: "pinterest", label: "Pinterest", color: "#E60023" };
  if (platform === "telegram") return { key: "telegram", label: "Telegram", color: "#26A5E4" };
  if (platform === "wargaming") return { key: "wargaming", label: "Wargaming.net", color: "#D4A017" };
  if (platform === "bungie") return { key: "bungie", label: "Bungie.net", color: "#3B82F6" };
  if (platform === "faceit") return { key: "faceit", label: "FACEIT", color: "#FF5500" };
  if (platform === "startgg") return { key: "startgg", label: "start.gg", color: "#3F80FF" };
  if (platform === "roblox") return { key: "roblox", label: "Roblox", color: "#FFFFFF" };
  if (platform === "osu") return { key: "osu", label: "osu!", color: "#FF66AA" };
  if (platform === "lichess") return { key: "lichess", label: "Lichess", color: "#BABABA" };
  if (platform === "github") return { key: "github", label: "GitHub", color: "#FFFFFF" };
  if (platform === "kick") return { key: "kick", label: "Kick", color: "#53FC18" };
  if (platform === "reddit") return { key: "reddit", label: "Reddit", color: "#FF4500" };
  if (platform === "spotify") return { key: "spotify", label: "Spotify", color: "#1DB954" };
  if (platform.includes("website") || platform.includes("web")) return { key: "website", label: "Website", color: "#29B6E8" };
  return { key: "website", label: link.label || "Link", color: "#29B6E8" };
}

export function PlatformIcon({ kind, className = "w-4 h-4" }) {
  if (kind === "discord") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.25-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42Z" /></svg>;
  if (kind === "twitch") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" /></svg>;
  if (kind === "youtube") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12z" /></svg>;
  if (kind === "instagram") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069ZM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12s.014 3.668.072 4.948c.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24s3.668-.014 4.948-.072c4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948s-.014-3.667-.072-4.947c-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0Zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881Z" /></svg>;
  if (kind === "tiktok") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1Z" /></svg>;
  if (kind === "x") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2h3.308l-7.227 8.26L22.827 22h-6.657l-5.214-6.817L4.99 22H1.68l7.73-8.835L1.254 2h6.826l4.713 6.231Zm-1.161 17.93h1.833L7.084 3.963H5.117Z" /></svg>;
  if (kind === "steam") return <Gamepad2 className={className} />;
  if (kind === "battlenet") return <Globe className={className} />;
  if (kind === "riot") return <Zap className={className} />;
  if (kind === "xbox") return <Gamepad2 className={className} />;
  if (kind === "epic") return <Flag className={className} />;
  if (kind === "mastodon") return <Globe2 className={className} />;
  if (kind === "bluesky") return <Bird className={className} />;
  if (kind === "threads") return <AtSign className={className} />;
  if (kind === "facebook") return <Facebook className={className} />;
  if (kind === "linkedin") return <Linkedin className={className} />;
  if (kind === "snapchat") return <Ghost className={className} />;
  if (kind === "pinterest") return <Pin className={className} />;
  if (kind === "telegram") return <Send className={className} />;
  if (kind === "wargaming") return <Shield className={className} />;
  if (kind === "bungie") return <Orbit className={className} />;
  if (kind === "faceit") return <Crosshair className={className} />;
  if (kind === "startgg") return <Trophy className={className} />;
  if (kind === "roblox") return <Box className={className} />;
  if (kind === "osu") return <CircleDot className={className} />;
  if (kind === "lichess") return <Castle className={className} />;
  if (kind === "github") return <Github className={className} />;
  if (kind === "kick") return <Radio className={className} />;
  if (kind === "reddit") return <MessageCircle className={className} />;
  if (kind === "spotify") return <Music2 className={className} />;
  if (kind === "psn" || kind === "nintendo" || kind === "ea") return <Gamepad2 className={className} />;
  return <Globe className={className} />;
}

// Die offiziellen Knöpfe: Hintergrund, Schrift und (wo die Marke es so will) ein Rahmen.
export const BRAND_BUTTONS = {
  discord: { bg: "#5865F2", fg: "#FFFFFF" },
  twitch: { bg: "#9146FF", fg: "#FFFFFF" },
  steam: { bg: "#171A21", fg: "#FFFFFF", border: "#66C0F4" },
  battlenet: { bg: "#148EFF", fg: "#FFFFFF" },
  x: { bg: "#000000", fg: "#FFFFFF", border: "#FFFFFF" },
  youtube: { bg: "#FF0000", fg: "#FFFFFF" },
  tiktok: { bg: "#000000", fg: "#FFFFFF", border: "#69C9D0" },
  riot: { bg: "#D13639", fg: "#FFFFFF" },
  xbox: { bg: "#107C10", fg: "#FFFFFF" },
  epic: { bg: "#2F2F2F", fg: "#FFFFFF", border: "#C8C8C8" },
  faceit: { bg: "#FF5500", fg: "#FFFFFF" },
  startgg: { bg: "#3F80FF", fg: "#FFFFFF" },
  roblox: { bg: "#000000", fg: "#FFFFFF", border: "#FFFFFF" },
  osu: { bg: "#FF66AA", fg: "#FFFFFF" },
  lichess: { bg: "#161512", fg: "#FFFFFF", border: "#BABABA" },
  github: { bg: "#24292F", fg: "#FFFFFF", border: "#57606A" },
  kick: { bg: "#53FC18", fg: "#000000" },
  reddit: { bg: "#FF4500", fg: "#FFFFFF" },
  spotify: { bg: "#1DB954", fg: "#000000" },
  threads: { bg: "#000000", fg: "#FFFFFF", border: "#FFFFFF" },
  facebook: { bg: "#1877F2", fg: "#FFFFFF" },
  linkedin: { bg: "#0A66C2", fg: "#FFFFFF" },
  snapchat: { bg: "#FFFC00", fg: "#000000" },
  pinterest: { bg: "#E60023", fg: "#FFFFFF" },
  telegram: { bg: "#26A5E4", fg: "#FFFFFF" },
  wargaming: { bg: "#2B2B2B", fg: "#FFFFFF", border: "#D4A017" },
  bungie: { bg: "#1B2A4A", fg: "#FFFFFF", border: "#3B82F6" },
  mastodon: { bg: "#6364FF", fg: "#FFFFFF" },
  bluesky: { bg: "#0085FF", fg: "#FFFFFF" },
};

export function brandButtonStyle(key) {
  const brand = BRAND_BUTTONS[key] || { bg: "#29B6E8", fg: "#000000" };
  return { backgroundColor: brand.bg, color: brand.fg, borderColor: brand.border || brand.bg };
}

// Steam nennt seinen Knopf „Sign in through Steam“ - deshalb „anmelden“, sonst „verknüpfen“.
export function linkButtonLabel(key, label) {
  return key === "steam" ? `Mit ${label} anmelden` : `Mit ${label} verknüpfen`;
}
