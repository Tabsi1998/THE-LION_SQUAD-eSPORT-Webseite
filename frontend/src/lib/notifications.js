// Benachrichtigungen fürs Web (#255): wohin eine Benachrichtigung führt und
// wie gleichartige zu einer Zeile gebündelt werden. Reine Logik, ohne React,
// damit Zielzuordnung und Bündelung ohne Oberfläche testbar sind. Die
// Zuordnung folgt der App (mobile/src/navigation/rootNavigation.ts).

export const BUNDLE_WINDOW_MS = 60 * 60 * 1000;

function metaString(meta, key) {
  const value = meta?.[key];
  return typeof value === "string" && value ? value : "";
}

// Pfade, die das Backend für die App oder aus alten Zeiten setzt und die es
// im Web so nicht (mehr) gibt.
function rewriteLegacyPath(url) {
  if (!url) return "";
  if (url.startsWith("/profile?tab=inbox")) {
    const to = new URLSearchParams(url.split("?")[1] || "").get("to");
    return to ? `/messages/${to}` : "/messages";
  }
  if (url === "/me/prizes") return "/my/prizes";
  // Den Turnier-Chat zeigt die Turnierseite selbst; eine eigene /chat-Seite
  // gibt es im Web nicht.
  const tournamentChat = url.match(/^\/tournaments\/([^/?#]+)\/chat$/);
  if (tournamentChat) return `/tournaments/${tournamentChat[1]}`;
  return url;
}

export function isExternalUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

// Das Ziel einer Benachrichtigung: erst nach Art und Metadaten wie in der
// App, dann der mitgelieferte Pfad, dann nichts.
export function notificationTarget(item) {
  const meta = item?.meta || {};
  const kind = String(item?.kind || "").toLowerCase();
  const url = String(item?.url || "");
  if (isExternalUrl(url)) return url;

  const threadUserId = metaString(meta, "thread_user_id");
  if (threadUserId && kind.includes("direct_message")) return `/messages/${threadUserId}`;

  const matchId = metaString(meta, "match_id");
  if (matchId && (kind.includes("match") || kind.includes("station"))) return `/matches/${matchId}`;

  const teamId = metaString(meta, "team_id");
  if (teamId && kind.includes("team")) return `/teams/${teamId}`;

  const challengeId = metaString(meta, "challenge_id") || metaString(meta, "fastlap_id");
  if (challengeId && (kind.includes("f1") || kind.includes("fast"))) return `/fastlap/${challengeId}`;
  if (kind.includes("prize")) return "/my/prizes";

  const tournamentId = metaString(meta, "tournament_id");
  if (tournamentId && kind.includes("tournament") && !url) return `/tournaments/${tournamentId}`;

  const newsSlug = metaString(meta, "slug") || metaString(meta, "news_id");
  if (newsSlug && kind.includes("news") && !url) return `/news/${newsSlug}`;

  if (kind.includes("friend")) return "/profile?tab=friends";
  if (kind.includes("crown")) return "/achievements";

  return rewriteLegacyPath(url);
}

// Gleichartige Benachrichtigungen teilen einen Schlüssel: Nachrichten
// desselben Absenders, derselbe Team-, Turnier- oder Match-Chat. Alles andere
// bleibt einzeln.
export function bundleKey(item) {
  const meta = item?.meta || {};
  const kind = String(item?.kind || "").toLowerCase();
  if (kind === "direct_message" && metaString(meta, "thread_user_id")) return `dm:${meta.thread_user_id}`;
  if (kind.startsWith("team_chat") && metaString(meta, "team_id")) return `team-chat:${meta.team_id}`;
  if (kind.startsWith("tournament_chat") && metaString(meta, "tournament_id")) return `tournament-chat:${meta.tournament_id}`;
  if (kind.startsWith("match_chat") && metaString(meta, "match_id")) return `match-chat:${meta.match_id}`;
  return "";
}

const BUNDLE_TITLES = [
  [/^Neue Nachricht von (.+)$/, (n, rest) => `${n} neue Nachrichten von ${rest}`],
  [/^Neue Teamnachricht (.+)$/, (n, rest) => `${n} neue Teamnachrichten ${rest}`],
  [/^Neue Turniernachricht: (.+)$/, (n, rest) => `${n} neue Turniernachrichten: ${rest}`],
  [/^Neue Matchnachricht: (.+)$/, (n, rest) => `${n} neue Matchnachrichten: ${rest}`],
  [/^Erwähnung im Team-Chat (.+)$/, (n, rest) => `${n} Erwähnungen im Team-Chat ${rest}`],
];

export function bundleTitle(title, count) {
  if (count <= 1) return title || "Benachrichtigung";
  for (const [pattern, make] of BUNDLE_TITLES) {
    const match = String(title || "").match(pattern);
    if (match) return make(count, match[1]);
  }
  return `${count}× ${title || "Benachrichtigung"}`;
}

function stamp(item) {
  const value = new Date(item?.created_at || 0).getTime();
  return Number.isNaN(value) ? 0 : value;
}

// Aus der zeitlich absteigenden Liste werden Bündel: mehrere gleichartige
// innerhalb einer Stunde ab der neuesten werden eine Zeile mit der neuesten
// als Vorschau. Ein Bündel gilt als ungelesen, wenn eine seiner
// Benachrichtigungen ungelesen ist.
export function bundleNotifications(rows, { windowMs = BUNDLE_WINDOW_MS } = {}) {
  const sorted = [...(rows || [])].sort((a, b) => stamp(b) - stamp(a));
  const bundles = [];
  const open = new Map();
  for (const item of sorted) {
    const key = bundleKey(item);
    const existing = key ? open.get(key) : null;
    if (existing && existing.newestStamp - stamp(item) <= windowMs) {
      existing.items.push(item);
      continue;
    }
    const bundle = { key: key || item.id, items: [item], newestStamp: stamp(item) };
    bundles.push(bundle);
    if (key) open.set(key, bundle);
  }
  return bundles.map((bundle) => {
    const newest = bundle.items[0];
    const count = bundle.items.length;
    return {
      id: newest.id,
      ids: bundle.items.map((row) => row.id),
      count,
      kind: newest.kind,
      meta: newest.meta,
      title: bundleTitle(newest.title, count),
      body: newest.body || "",
      created_at: newest.created_at,
      read: bundle.items.every((row) => !!row.read),
      unreadCount: bundle.items.filter((row) => !row.read).length,
      target: notificationTarget(newest),
      items: bundle.items,
    };
  });
}

// Eine Zeile Vorschau, gekürzt.
export function previewText(text, max = 90) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}
