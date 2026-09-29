import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { enqueueCeremony } from "@/components/achievements/ceremony/queue";
import { describePackage } from "@/components/achievements/ceremony/select";

const seenKey = (id) => `tls_ach_seen:${id}`;

/** Nachgeholte Erfolge seit dem letzten Besuch als eine Zeremonie (E8: über die Warteschlange, nie doppelt). */
export function AchievementCatchUp() {
  const { user } = useAuth();
  const ranForRef = useRef(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId || ranForRef.current === userId) return;
    ranForRef.current = userId;
    (async () => {
      try {
        const { data } = await api.get("/achievements/me");
        const earned = [];
        for (const group of data?.groups || []) {
          if (group.is_negative) continue;
          for (const tier of group.tiers || []) {
            if (tier.earned && tier.earned_at && !tier.silent) earned.push({ ...tier, category: group.category, group_name: group.name, group_code: group.code, hidden: group.hidden });
          }
        }
        const key = seenKey(userId);
        const last = localStorage.getItem(key);
        if (!last) {
          localStorage.setItem(key, new Date().toISOString());
          return;
        }
        const fresh = earned
          .filter((t) => +new Date(t.earned_at) > +new Date(last))
          .sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at))
          .slice(0, 8);
        if (fresh.length) {
          // Der Marker rückt erst vor, wenn die Zeremonie wirklich gezeigt wurde.
          enqueueCeremony(fresh, { ...describePackage(data?.groups || [], fresh), catchUp: true, heading: "Während du weg warst!", sub: "Nachgeholte Erfolge" }, {
            onDone: () => { try { localStorage.setItem(key, new Date().toISOString()); } catch { /* egal */ } },
          });
        } else {
          localStorage.setItem(key, new Date().toISOString());
        }
      } catch {
        /* rein kosmetisch */
      }
    })();
  }, [userId]);

  return null;
}
