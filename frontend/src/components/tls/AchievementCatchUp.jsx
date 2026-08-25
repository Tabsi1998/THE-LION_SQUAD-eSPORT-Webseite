import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AchievementUnlockOverlay } from "./AchievementUnlockOverlay";

const seenKey = (id) => `tls_ach_seen:${id}`;

/** Shows a catch-up unlock ceremony for achievements earned since the last visit. */
export function AchievementCatchUp() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [tiers, setTiers] = useState([]);
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
            if (tier.earned && tier.earned_at) earned.push(tier);
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
          setTiers(fresh);
        } else {
          localStorage.setItem(key, new Date().toISOString());
        }
      } catch {
        /* silent — purely cosmetic feature */
      }
    })();
  }, [userId]);

  // Marker is only advanced once the user actually saw the ceremony.
  const closeAndMark = () => {
    if (userId) localStorage.setItem(seenKey(userId), new Date().toISOString());
    setTiers([]);
  };

  if (pathname.startsWith("/display")) return null;

  return (
    <AchievementUnlockOverlay
      tiers={tiers}
      onClose={closeAndMark}
      heading="Während du weg warst!"
      sub="Nachgeholte Erfolge"
    />
  );
}
