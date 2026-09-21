import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { type AchievementGroup, freshTiers, onAchievementUnlocked } from "../lib/achievements";
import { api } from "../lib/api";
import { AchievementUnlockModal, UnlockTier } from "./AchievementUnlock";

// SecureStore keys must be alphanumeric + ".-_"; hash the user id into a safe key.
const seenKey = (id: string) => `tls_ach_seen_${id.replace(/[^a-zA-Z0-9._-]/g, "")}`;

/**
 * Der Freischalt-Moment (#218). Beim Start holt er nach, was seit dem letzten Blick dazukam
 * („Während du weg warst“). Ist die App offen, meldet die Benachrichtigung einen neuen Erfolg
 * (seit #301 sofort) - dann erscheint derselbe Moment gleich, nicht erst beim nächsten Start.
 */
export function AchievementCatchUpOverlay() {
  const { user } = useAuth();
  const [tiers, setTiers] = useState<UnlockTier[]>([]);
  const [live, setLive] = useState(false);
  const ranForRef = useRef<string | null>(null);
  const userId = user?.id;

  const check = useCallback(async (fromLive: boolean) => {
    if (!userId) return;
    try {
      const { data } = await api.get<{ groups?: AchievementGroup[] }>("/achievements/me");
      const key = seenKey(userId);
      const last = await SecureStore.getItemAsync(key);
      if (!last) {
        await SecureStore.setItemAsync(key, new Date().toISOString());
        return;
      }
      const fresh = freshTiers(data?.groups, last);
      if (fresh.length) {
        setLive(fromLive);
        setTiers(fresh);
      } else {
        await SecureStore.setItemAsync(key, new Date().toISOString());
      }
    } catch {
      /* silent — purely cosmetic */
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || ranForRef.current === userId) return;
    ranForRef.current = userId;
    check(false);
  }, [check, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    return onAchievementUnlocked(() => { check(true); });
  }, [check, userId]);

  const closeAndMark = () => {
    if (userId) SecureStore.setItemAsync(seenKey(userId), new Date().toISOString()).catch(() => {});
    setTiers([]);
  };

  return (
    <AchievementUnlockModal
      tiers={tiers}
      onClose={closeAndMark}
      heading={live ? "Erfolg freigeschaltet!" : "Während du weg warst!"}
      sub={live ? "Gerade eben" : "Nachgeholte Erfolge"}
    />
  );
}
