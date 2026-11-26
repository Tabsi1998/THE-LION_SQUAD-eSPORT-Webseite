// Benachrichtigungen aufgeräumt (#1205, #1662): Glocke und Postfach gliedern nach Tagen (Heute, Gestern, Früher), nach
// Themen zum Antippen und fassen Gleichartiges eines Tages zusammen („3 neue Ergebnisse in Liga 1“). Reine Logik ohne
// React. Das Thema jeder Meldung liefert der Server (backend/services/user_notifications.py, ``with_topic``); die Namen
// sind dieselben wie in den Einstellungen (backend/services/notification_preferences.py, ``TOPIC_LABELS``).
import { LEVEL_TOPIC_KEYS } from "./notificationLevels";
import { bundleKey, bundleTitle, notificationTarget } from "./notifications";
import { dayBefore, viennaDay } from "./vienna";

export const ACCOUNT_TOPIC = "account";
export const TOPIC_KEYS = [...LEVEL_TOPIC_KEYS, ACCOUNT_TOPIC];
export const TOPIC_LABELS = {
  match_reminders: "Spiele & Aufrufe",
  tournament_updates: "Turnier-Updates",
  prize_updates: "Gewinne & Abholung",
  achievements: "Erfolge",
  billing_updates: "Rechnungen",
  membership_updates: "Vereinsmitgliedschaft",
  community_messages: "Nachrichten & Erwähnungen",
  news_events: "News & Events",
  club_internal: "Vereinsintern",
  helper_shifts: "Helferdienste",
  [ACCOUNT_TOPIC]: "Konto & System",
};
export const DAY_KEYS = ["today", "yesterday", "earlier"];
export const DAY_LABELS = { today: "Heute", yesterday: "Gestern", earlier: "Früher" };
const IMPORTANCE_ORDER = ["urgent", "important", "normal"];
const ACHIEVEMENT_KINDS = new Set(["achievement", "level", "prestige", "crown_gained", "crown_changed", "crown_onyx"]);

export function topicOf(item) {
  return TOPIC_LABELS[item?.topic] ? item.topic : ACCOUNT_TOPIC;
}

/** Die Themen, die in der Liste vorkommen - in der Reihenfolge der Einstellungen, mit Anzahl. */
export function topicCounts(rows) {
  const counts = {};
  for (const item of rows || []) counts[topicOf(item)] = (counts[topicOf(item)] || 0) + 1;
  return TOPIC_KEYS.filter((key) => counts[key]).map((key) => ({ key, label: TOPIC_LABELS[key], count: counts[key] }));
}

/** Heute, Gestern oder Früher - nach dem Wiener Kalender. */
export function dayOf(value, now = new Date()) {
  const day = viennaDay(value);
  const today = viennaDay(now);
  if (!day || day === today) return "today";
  return day === dayBefore(today) ? "yesterday" : "earlier";
}

function tournamentName(item) {
  const named = item?.meta?.tournament_title;
  if (typeof named === "string" && named) return named;
  const body = String(item?.body || "");
  const cut = body.indexOf(": ");
  return cut > 0 ? body.slice(0, cut) : "";
}

/** Was mit Gleichartigem desselben Tages zusammengeht - die Chat-Regeln der Website (#255) und neu Ergebnisse und Erfolge. */
export function similarKey(item) {
  const own = bundleKey(item);
  if (own) return own;
  const kind = String(item?.kind || "");
  const tournament = item?.meta?.tournament_id;
  if (kind === "match_result" && typeof tournament === "string" && tournament && !item?.meta?.reason) return `results:${tournament}`;
  if (ACHIEVEMENT_KINDS.has(kind)) return "achievements";
  return "";
}

function similarTitle(key, newest, count) {
  if (count <= 1) return newest.title || "Benachrichtigung";
  if (key.startsWith("results:")) {
    const name = tournamentName(newest);
    return name ? `${count} neue Ergebnisse in ${name}` : `${count} neue Ergebnisse`;
  }
  if (key === "achievements") return `${count} neue Erfolge`;
  return bundleTitle(newest.title, count);
}

const stamp = (item) => {
  const value = new Date(item?.created_at || 0).getTime();
  return Number.isNaN(value) ? 0 : value;
};

function toBundle(key, items) {
  const newest = items[0];
  const count = items.length;
  const importance = IMPORTANCE_ORDER.find((level) => items.some((row) => row.importance === level)) || "normal";
  return {
    id: newest.id,
    key: key || newest.id,
    ids: items.map((row) => row.id),
    count,
    kind: newest.kind,
    meta: newest.meta,
    topic: topicOf(newest),
    importance,
    title: similarTitle(key, newest, count),
    body: newest.body || "",
    created_at: newest.created_at,
    read: items.every((row) => !!row.read),
    unreadCount: items.filter((row) => !row.read).length,
    target: notificationTarget(newest),
    items,
  };
}

/**
 * Die Liste für Glocke und Postfach: ``[{ key, label, bundles }]`` je Tag, neueste zuerst. ``topic`` filtert nach Thema,
 * ``tab`` nach ``unread`` / ``read`` (auf die Bündel: ungelesen, solange eine Meldung darin ungelesen ist).
 */
export function groupNotifications(rows, { now = new Date(), topic = "", tab = "all" } = {}) {
  const sorted = [...(rows || [])]
    .filter((item) => !topic || topicOf(item) === topic)
    .sort((a, b) => stamp(b) - stamp(a));
  const days = Object.fromEntries(DAY_KEYS.map((key) => [key, new Map()]));
  for (const item of sorted) {
    const bucket = days[dayOf(item.created_at, now)];
    const key = similarKey(item) || `one:${item.id}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(item);
  }
  return DAY_KEYS.map((key) => ({
    key,
    label: DAY_LABELS[key],
    bundles: [...days[key].entries()]
      .map(([bundle, items]) => toBundle(bundle.startsWith("one:") ? "" : bundle, items))
      .filter((bundle) => (tab === "unread" ? !bundle.read : tab === "read" ? bundle.read : true)),
  })).filter((group) => group.bundles.length);
}
