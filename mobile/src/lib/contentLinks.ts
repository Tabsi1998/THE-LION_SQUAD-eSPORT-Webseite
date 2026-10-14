import { ownPath } from "./siteUrls";

export type ContentTarget = {
  id: string;
  label?: string;
  type: "event" | "fastlap" | "news" | "profile" | "team" | "tournament";
};

const embedAliases: Record<string, ContentTarget["type"]> = {
  event: "event",
  events: "event",
  fastlap: "fastlap",
  "fast-lap": "fastlap",
  fastlaps: "fastlap",
  f1: "fastlap",
  news: "news",
  post: "news",
  player: "profile",
  players: "profile",
  profile: "profile",
  profiles: "profile",
  u: "profile",
  user: "profile",
  users: "profile",
  team: "team",
  teams: "team",
  tournament: "tournament",
  tournaments: "tournament",
  turnier: "tournament",
  turniere: "tournament",
};

const routeAliases: Record<string, ContentTarget["type"]> = {
  events: "event",
  event: "event",
  fastlap: "fastlap",
  fastlaps: "fastlap",
  f1: "fastlap",
  news: "news",
  posts: "news",
  player: "profile",
  players: "profile",
  profile: "profile",
  profiles: "profile",
  spieler: "profile",
  u: "profile",
  user: "profile",
  users: "profile",
  team: "team",
  teams: "team",
  tournaments: "tournament",
  tournament: "tournament",
  turniere: "tournament",
};

export function parseContentTarget(value?: string | null): ContentTarget | null {
  const text = String(value || "").trim();
  if (!text) return null;

  const embed = text.match(/^\[\[\s*([a-z0-9_-]+)\s*:\s*([^|\]]+)(?:\|([^\]]+))?\s*\]\]$/i);
  if (embed) {
    const type = embedAliases[embed[1].toLowerCase()];
    const id = cleanId(embed[2]);
    if (type && id) return { type, id, label: embed[3]?.trim() || undefined };
  }

  const path = toPath(text);
  if (!path) return null;
  const segments = path.split("/").filter(Boolean);
  if (!segments.length) return null;
  const type = routeAliases[segments[0].toLowerCase()];
  const id = cleanId(segments[1]);
  return type && id ? { type, id } : null;
}

export function isImageUrl(value?: string | null) {
  return /^https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:[?#]\S*)?$/i.test(String(value || "").trim());
}

function toPath(value: string) {
  // Nur die eigene Website (#921): start.gg/tournaments/… ist kein eigenes Turnier. Relative Pfade prüft dieselbe Regel
  // wie Benachrichtigungen und Links von außen (#998): „//news/…“ oder „//fremd.example/news/…“ ist ein fremder Host.
  const own = ownPath(value);
  return own === null ? null : own.split(/[?#]/)[0];
}

/**
 * Die Kennung aus dem Verweis - oder "", wenn sie keine ist. RichText liest Verweise schon beim Zeichnen: eine kaputte
 * Prozentkodierung („%“, „%E0%A4%A“) wirft darum nie (#997), sondern macht den Verweis zu Text. Nach dem Dekodieren
 * bleibt eine Kennung ein Pfadteil: kein „/“, „\“, „?“, „#“, kein Steuerzeichen, nicht „.“ oder „..“.
 */
function cleanId(value?: string | null) {
  const raw = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  let id: string;
  try {
    id = decodeURIComponent(raw).trim();
  } catch {
    return "";
  }
  if (id === "." || id === ".." || /[/\\?#\u0000-\u001f\u007f]/.test(id)) return "";
  return id;
}
