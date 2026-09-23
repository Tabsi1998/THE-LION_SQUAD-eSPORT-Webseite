import { AtSign, Gamepad, Gamepad2, Globe, Instagram, Joystick, MessageCircle, Music2, Rocket, Swords, Twitch, Twitter, Youtube, Zap } from "lucide-react";

// Socials und Gaming-IDs (#258): je Feld ein Symbol, eine Bereinigung der
// Eingabe (eine eingefügte Adresse wird zum Nutzernamen) und, wo es eine
// Profilseite gibt, ein Vorschau-Link. Reine Logik plus Symbol-Zuordnung,
// damit sich die Bereinigung ohne Oberfläche testen lässt.

export const SOCIAL_PLATFORMS = [
  { k: "discord_name", l: "Discord", icon: MessageCircle, placeholder: "nutzername", handle: true },
  { k: "twitch_handle", l: "Twitch", icon: Twitch, hosts: ["twitch.tv"], url: (h) => `https://www.twitch.tv/${h}`, placeholder: "tabsi98 oder https://www.twitch.tv/tabsi98", handle: true },
  { k: "youtube_handle", l: "YouTube", icon: Youtube, hosts: ["youtube.com", "youtu.be"], skip: ["c", "channel", "user"], url: (h) => `https://www.youtube.com/@${h}`, placeholder: "@kanal oder Adresse", handle: true },
  { k: "instagram_handle", l: "Instagram", icon: Instagram, hosts: ["instagram.com"], url: (h) => `https://instagram.com/${h}`, placeholder: "nutzername oder Adresse", handle: true },
  { k: "tiktok_handle", l: "TikTok", icon: Music2, hosts: ["tiktok.com"], url: (h) => `https://www.tiktok.com/@${h}`, placeholder: "@nutzername oder Adresse", handle: true },
  { k: "x_handle", l: "X (Twitter)", icon: Twitter, hosts: ["x.com", "twitter.com"], url: (h) => `https://x.com/${h}`, placeholder: "@nutzername oder Adresse", handle: true },
  { k: "steam_id", l: "Steam", icon: Gamepad2, hosts: ["steamcommunity.com"], skip: ["id", "profiles"], url: (h) => (/^\d{17}$/.test(h) ? `https://steamcommunity.com/profiles/${h}` : `https://steamcommunity.com/id/${h}`), placeholder: "Profilname, 17-stellige ID oder Adresse" },
  { k: "epic_id", l: "Epic", icon: Rocket, placeholder: "Epic-Anzeigename" },
  { k: "psn_id", l: "PlayStation Network", icon: Gamepad, placeholder: "Online-ID" },
  { k: "xbox_id", l: "Xbox", icon: Joystick, placeholder: "Gamertag" },
  { k: "nintendo_fc", l: "Nintendo Friend Code", icon: Zap, placeholder: "SW-XXXX-XXXX-XXXX" },
  { k: "ea_id", l: "EA ID", icon: Gamepad2, placeholder: "EA-ID" },
  { k: "riot_id", l: "Riot ID", icon: Swords, placeholder: "Name#TAG" },
  { k: "battlenet_id", l: "Battle.net", icon: AtSign, placeholder: "Name#1234" },
  { k: "website", l: "Website", icon: Globe, placeholder: "https://…", website: true },
];

export const SOCIAL_KEYS = SOCIAL_PLATFORMS.map((platform) => platform.k);

function platformByKey(key) {
  return SOCIAL_PLATFORMS.find((platform) => platform.k === key);
}

function parseUrl(raw) {
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function hostMatches(hostname, hosts) {
  const host = hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  return hosts.some((known) => host === known || host.endsWith(`.${known}`));
}

// Aus "https://www.instagram.com/tabsi.98?igsh=…" wird "tabsi.98"; aus
// "@tabsi.98" ebenfalls. Was nicht nach Adresse aussieht, bleibt bis auf
// Leerzeichen und ein führendes @ unverändert.
export function normalizeSocialInput(key, raw) {
  const platform = platformByKey(key);
  const value = String(raw ?? "").trim();
  if (!platform || !value) return value;
  if (platform.website) return value;
  const looksLikeUrl = /^[a-z]+:\/\//i.test(value) || /^(www\.)?[a-z0-9.-]+\.[a-z]{2,}\//i.test(value);
  if (platform.hosts && looksLikeUrl) {
    const url = parseUrl(value);
    if (url && hostMatches(url.hostname, platform.hosts)) {
      const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
      const skip = new Set(platform.skip || []);
      const meaningful = segments.filter((segment) => !skip.has(segment.toLowerCase()));
      const candidate = meaningful[0] || "";
      return candidate.replace(/^@/, "");
    }
  }
  return platform.handle ? value.replace(/^@/, "") : value;
}

export function socialProfileUrl(key, value) {
  const platform = platformByKey(key);
  const raw = String(value ?? "").trim();
  if (!platform || !raw) return "";
  if (platform.website) return /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!platform.url) return "";
  // Ein gespeicherter Wert kann noch eine ganze Adresse sein (alte Eingaben): erst zum Nutzernamen
  // machen, sonst wird die Adresse in die Vorschau hineingepackt („…/@https%3A%2F%2F…“).
  const handle = normalizeSocialInput(key, raw);
  if (!handle) return "";
  return platform.url(encodeURIComponent(handle));
}
