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
  member: "profile",
  members: "profile",
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
  member: "profile",
  members: "profile",
  mitglied: "profile",
  mitglieder: "profile",
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
  if (value.startsWith("/")) return value;
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function cleanId(value?: string | null) {
  return decodeURIComponent(String(value || "").trim().replace(/^\/+|\/+$/g, ""));
}
