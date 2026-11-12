import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { enqueueCeremony } from "@/components/achievements/ceremony/queue";
import { describePackage } from "@/components/achievements/ceremony/select";

const seenKey = (id) => `tls_ach_seen:${id}`;
// Die Sammel-Zeremonie der Neuberechnung (#2340) läuft je Person und Kennung der Neuberechnung einmal.
export const recountSeenKey = (id, marker) => `tls_ach_recount_seen:${id}:${marker}`;
/** Der Server hat gerade Stufen vergeben (z. B. nach einem Saison-Signal, #678) - `detail.count` sagt, wie viele. */
export const AWARDED_EVENT = "tls:achievements-awarded";
export const MAX_TIERS = 8;

function collect(groups, wanted) {
  const earned = [];
  for (const group of groups) {
    if (group.is_negative) continue;
    for (const tier of group.tiers || []) {
      if (tier.earned && tier.earned_at && !tier.silent && wanted(tier)) earned.push({ ...tier, category: group.category, group_name: group.name, group_code: group.code, hidden: group.hidden });
    }
  }
  return earned.sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at));
}

/** Alle erreichten, nicht stillen Stufen aus /achievements/me - die neueste zuerst. Nachgerechnete (#2340) feiert die
 * Sammel-Zeremonie, nicht der einzelne Ablauf. */
export function earnedTiers(groups = []) {
  return collect(groups, (tier) => !tier.recount);
}

/** Die nachgerechneten Stufen (#2340) - für die eine Sammel-Zeremonie nach dem Abschluss der Neuberechnung. */
export function recountTiers(groups = []) {
  return collect(groups, (tier) => Boolean(tier.recount));
}

function remember(key) {
  try {
    localStorage.setItem(key, new Date().toISOString());
  } catch {
    /* egal */
  }
}

function lastSeen(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Erfolge als Zeremonie (E8: über die Warteschlange, nie doppelt): beim Laden die seit dem letzten Besuch
 * nachgeholten, und - sobald der Server meldet, dass gerade Stufen vergeben wurden - genau diese, sofort.
 */
export function AchievementCatchUp() {
  const { user } = useAuth();
  const ranForRef = useRef(null);
  const shownRef = useRef(new Set());
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return undefined;
    let gone = false;
    const key = seenKey(userId);

    // Läuft je Person einmal und immer zu Ende - auch wenn React den Effekt (StrictMode) zweimal aufruft.
    const catchUp = async () => {
      try {
        const { data } = await api.get("/achievements/me");
        // Neuberechnung (#2340): erst nach dem Abschluss, einmal - alle nachgerechneten Stufen in einer Zeremonie.
        const marker = data?.recount?.finished ? data.recount.marker : null;
        if (marker && !lastSeen(recountSeenKey(userId, marker))) {
          const late = recountTiers(data?.groups || []);
          if (late.length) enqueueCeremony(late, { recount: true }, { onDone: () => remember(recountSeenKey(userId, marker)) });
          else remember(recountSeenKey(userId, marker));
        }
        const last = lastSeen(key);
        if (!last) {
          remember(key);
          return;
        }
        const fresh = earnedTiers(data?.groups || []).filter((t) => +new Date(t.earned_at) > +new Date(last) && !shownRef.current.has(t.code)).slice(0, MAX_TIERS);
        if (!fresh.length) {
          remember(key);
          return;
        }
        fresh.forEach((tier) => shownRef.current.add(tier.code));
        // Der Marker rückt erst vor, wenn die Zeremonie wirklich gezeigt wurde.
        enqueueCeremony(fresh, { ...describePackage(data?.groups || [], fresh), catchUp: true, heading: "Während du weg warst!", sub: "Nachgeholte Erfolge" }, { onDone: () => remember(key) });
      } catch {
        /* rein kosmetisch */
      }
    };

    // Gerade vergeben: die neuesten `count` Stufen - nach der Zahl des Servers, nicht nach der Uhr des Geräts.
    const justAwarded = async (event) => {
      const count = Math.min(MAX_TIERS, Math.floor(Number(event?.detail?.count)) || 0);
      if (count <= 0) return;
      try {
        const { data } = await api.get("/achievements/me");
        if (gone) return;
        const fresh = earnedTiers(data?.groups || []).slice(0, count).filter((t) => !shownRef.current.has(t.code));
        if (!fresh.length) return;
        fresh.forEach((tier) => shownRef.current.add(tier.code));
        enqueueCeremony(fresh, describePackage(data?.groups || [], fresh), { onDone: () => remember(key) });
      } catch {
        /* rein kosmetisch - der nächste Besuch holt es nach */
      }
    };

    if (ranForRef.current !== userId) {
      ranForRef.current = userId;
      shownRef.current = new Set();
      catchUp();
    }
    window.addEventListener(AWARDED_EVENT, justAwarded);
    return () => {
      gone = true;
      window.removeEventListener(AWARDED_EVENT, justAwarded);
    };
  }, [userId]);

  return null;
}
