import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Zähler fürs Benutzermenü (#516): Strafen und offene Gewinne - der Eintrag erscheint nur, wenn es
// etwas gibt. Zwei kleine Abfragen beim Öffnen des Menüs, eine Minute gemerkt, nie ein Fehler nach außen.
const cache = new Map();
const TTL_MS = 60 * 1000;
const EMPTY = { penalties: 0, prizes: 0 };

export function countOpenPrizes(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => ["pending", "ready"].includes(String(row?.status || ""))).length;
}

export function countPenalties(standing) {
  if (!standing || typeof standing !== "object") return 0;
  return Math.max(Number(standing.strike_count || 0), standing.active ? 1 : 0);
}

export async function loadAccountBadges(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.badges;
  const [standing, prizes] = await Promise.all([
    api.get("/moderation/me/standing").then((result) => result.data).catch(() => null),
    api.get("/prizes/me").then((result) => result.data).catch(() => []),
  ]);
  const badges = { penalties: countPenalties(standing), prizes: countOpenPrizes(prizes) };
  cache.set(userId, { at: Date.now(), badges });
  return badges;
}

export function resetAccountBadges() {
  cache.clear();
}

export function useAccountBadges(userId, active = true) {
  const [badges, setBadges] = useState(() => cache.get(userId)?.badges || EMPTY);
  useEffect(() => {
    if (!userId || !active) return undefined;
    let cancelled = false;
    loadAccountBadges(userId).then((next) => {
      if (!cancelled) setBadges(next);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, active]);
  return badges;
}
