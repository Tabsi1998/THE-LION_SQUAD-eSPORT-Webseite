import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import { CeremonyHost } from "../achievements/ceremony/CeremonyHost";
import { enqueueCeremony, enqueueLevelUp } from "../achievements/ceremony/queue";
import { describePackage } from "../achievements/ceremony/select";
import { type AchievementGroup, freshTiers, onAchievementUnlocked } from "../lib/achievements";
import { api } from "../lib/api";

// SecureStore keys must be alphanumeric + ".-_"; hash the user id into a safe key.
const seenKey = (id: string) => `tls_ach_seen_${id.replace(/[^a-zA-Z0-9._-]/g, "")}`;
const levelKey = (id: string) => `tls_level_seen_${id.replace(/[^a-zA-Z0-9._-]/g, "")}`;

type LevelState = { level: number; title: string; prestige: number };

/**
 * Der Freischalt-Moment (#218, Erfolge II E13 #623). Beim Start holt er nach, was seit dem letzten Blick dazukam
 * („Während du weg warst“); ist die App offen, meldet die Benachrichtigung einen neuen Erfolg oder ein neues Level -
 * dann erscheint die Zeremonie gleich. Gezeigt wird über die Warteschlange (nie zwei zugleich, Level-up am Ende);
 * der Marker rückt erst vor, wenn die Zeremonie wirklich gezeigt wurde. Level-Aufstiege wie im Web: der Stand aus
 * /users/me/level gegen den zuletzt gesehenen je Konto.
 */
export function AchievementCatchUpOverlay() {
  const { user } = useAuth();
  const ranForRef = useRef<string | null>(null);
  const shownRef = useRef<Set<string>>(new Set());
  const userId = user?.id;

  const remember = useCallback((key: string) => {
    SecureStore.setItemAsync(key, new Date().toISOString()).catch(() => {});
  }, []);

  const checkLevel = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await api.get<{ level?: number; title?: string; prestige?: number }>("/users/me/level");
      const next: LevelState = { level: Number(data?.level || 1), title: String(data?.title || ""), prestige: Number(data?.prestige || 0) };
      const key = levelKey(userId);
      let prev: LevelState | null = null;
      try {
        prev = JSON.parse((await SecureStore.getItemAsync(key)) || "null");
      } catch {
        prev = null;
      }
      if (prev && Number(prev.level) && (next.level > Number(prev.level) || next.prestige > Number(prev.prestige || 0))) {
        enqueueLevelUp({
          level: next.level,
          previous: Number(prev.level),
          title: next.title,
          titleChanged: Boolean(next.title) && next.title !== String(prev.title || ""),
          prestige: next.prestige,
          prestigeGained: next.prestige > Number(prev.prestige || 0),
        });
      }
      await SecureStore.setItemAsync(key, JSON.stringify(next));
    } catch {
      /* rein kosmetisch */
    }
  }, [userId]);

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
      const groups = data?.groups || [];
      const fresh = freshTiers(groups, last).filter((tier) => !shownRef.current.has(tier.code));
      if (!fresh.length) {
        if (!fromLive) await SecureStore.setItemAsync(key, new Date().toISOString());
        return;
      }
      fresh.forEach((tier) => shownRef.current.add(tier.code));
      const context = { ...describePackage(groups, fresh), ...(fromLive ? {} : { catchUp: true, heading: "Während du weg warst!", sub: "Nachgeholte Erfolge" }) };
      enqueueCeremony(fresh, context, { onDone: () => remember(key) });
    } catch {
      /* rein kosmetisch */
    }
  }, [userId, remember]);

  useEffect(() => {
    if (!userId || ranForRef.current === userId) return;
    ranForRef.current = userId;
    shownRef.current = new Set();
    check(false).then(() => checkLevel());
  }, [check, checkLevel, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    return onAchievementUnlocked(() => {
      check(true).then(() => checkLevel());
    });
  }, [check, checkLevel, userId]);

  return <CeremonyHost />;
}
