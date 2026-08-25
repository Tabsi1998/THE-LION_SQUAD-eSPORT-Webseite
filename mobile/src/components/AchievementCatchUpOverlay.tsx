import * as SecureStore from "expo-secure-store";
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { AchievementUnlockModal, UnlockTier } from "./AchievementUnlock";

// SecureStore keys must be alphanumeric + ".-_"; hash the user id into a safe key.
const seenKey = (id: string) => `tls_ach_seen_${id.replace(/[^a-zA-Z0-9._-]/g, "")}`;

/** Native catch-up ceremony: shows achievements earned since the user was last in the app. */
export function AchievementCatchUpOverlay() {
  const { user } = useAuth();
  const [tiers, setTiers] = useState<UnlockTier[]>([]);
  const ranForRef = useRef<string | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId || ranForRef.current === userId) return;
    ranForRef.current = userId;
    (async () => {
      try {
        const { data } = await api.get<{ groups?: Array<{ is_negative?: boolean; tiers?: any[] }> }>("/achievements/me");
        const earned: any[] = [];
        for (const group of data?.groups || []) {
          if (group.is_negative) continue;
          for (const tier of group.tiers || []) {
            if (tier.earned && tier.earned_at) earned.push(tier);
          }
        }
        const key = seenKey(userId);
        const last = await SecureStore.getItemAsync(key);
        if (!last) {
          await SecureStore.setItemAsync(key, new Date().toISOString());
          return;
        }
        const fresh = earned
          .filter((t) => +new Date(t.earned_at) > +new Date(last))
          .sort((a, b) => +new Date(b.earned_at) - +new Date(a.earned_at))
          .slice(0, 8);
        if (fresh.length) setTiers(fresh);
        else await SecureStore.setItemAsync(key, new Date().toISOString());
      } catch {
        /* silent — purely cosmetic */
      }
    })();
  }, [userId]);

  const closeAndMark = () => {
    if (userId) SecureStore.setItemAsync(seenKey(userId), new Date().toISOString()).catch(() => {});
    setTiers([]);
  };

  return <AchievementUnlockModal tiers={tiers} onClose={closeAndMark} heading="Während du weg warst!" sub="Nachgeholte Erfolge" />;
}
