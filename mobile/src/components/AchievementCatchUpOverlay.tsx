import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import { CeremonyHost } from "../achievements/ceremony/CeremonyHost";
import { enqueueCeremony, enqueueLevelUp } from "../achievements/ceremony/queue";
import { type LevelState, describePackage, levelUpFrom } from "../achievements/ceremony/select";
import { achSeenKey as seenKey, ceremonyState, levelSeenKey as levelKey, markSeen, serverCheck } from "../achievements/ceremony/seen";
import { type AchievementGroup, type AchievementTier, freshTiers, onAchievementUnlocked, onLevelChanged } from "../lib/achievements";
import { api } from "../lib/api";
import { claimLevelUp } from "../lib/levelSeen";

const MAX_TIERS = 8;
const CATCH_UP = { catchUp: true, heading: "Während du weg warst!", sub: "Nachgeholte Erfolge" };

/** Erreichte, nicht stille Stufen aus /achievements/me - die neueste zuerst, ohne Negatives und Nachgerechnetes. */
function earnedTiers(groups: AchievementGroup[]): AchievementTier[] {
  return freshTiers(groups, "1970-01-01T00:00:00Z", 10000).filter((tier) => !(tier as { recount?: boolean }).recount);
}

/**
 * Der Freischalt-Moment (#218, Erfolge II E13 #623). Beim Start holt er nach, was seit dem letzten Blick dazukam
 * („Während du weg warst“); ist die App offen, meldet die Benachrichtigung einen neuen Erfolg oder ein neues Level -
 * dann erscheint die Zeremonie gleich. Gezeigt wird über die Warteschlange (nie zwei zugleich, Level-up am Ende);
 * der Marker rückt erst vor, wenn die Zeremonie wirklich gezeigt wurde. Level-Aufstiege wie im Web: der Stand aus
 * /users/me/level gegen den zuletzt gesehenen je Konto.
 *
 * Einmal je Konto (#2450): Was schon gesehen ist, weiß der Server - nachgeholt wird, was dort noch offen ist, jedes
 * Schließen (X, Tipp daneben, Zurück-Taste, Ablauf zu Ende) meldet „gesehen“, und vor dem Anzeigen prüft die Bühne
 * noch einmal (CeremonyHost). Ohne Stand vom Server (ältere Fassung) gilt wie bisher der Merker im Gerät.
 */
export function AchievementCatchUpOverlay() {
  const { user } = useAuth();
  const ranForRef = useRef<string | null>(null);
  const shownRef = useRef<Set<string>>(new Set());
  const userId = user?.id;
  // Das gerade angemeldete Konto: eine Antwort, die noch für das vorige Konto unterwegs war, wird verworfen - sonst
  // landet der Stand von Konto B im Merker von Konto A.
  const currentRef = useRef(userId);
  useEffect(() => {
    currentRef.current = userId;
  }, [userId]);
  // Der Aufstieg, der gerade in der Warteschlange steht - eine zweite Prüfung reiht ihn nicht noch einmal ein.
  const queuedLevelRef = useRef<string | null>(null);

  const remember = useCallback((key: string) => {
    SecureStore.setItemAsync(key, new Date().toISOString()).catch(() => {});
  }, []);

  const checkLevel = useCallback(async () => {
    if (!userId) return;
    const forUser = userId;
    const sameUser = () => currentRef.current === forUser;
    try {
      const { data } = await api.get<{ level?: number; title?: string; prestige?: number }>("/users/me/level");
      if (!sameUser()) return;
      const next: LevelState = { level: Number(data?.level || 1), title: String(data?.title || ""), prestige: Number(data?.prestige || 0) };
      const state = await ceremonyState(forUser);
      if (!sameUser()) return;
      if (!state) {
        // Rückfall ohne Server-Stand: lesen, vergleichen und merken unter einer Sperre - zwei gleichzeitige Prüfungen
        // zeigen denselben Aufstieg nur einmal.
        const levelUp = await claimLevelUp(levelKey(forUser), next, sameUser);
        // „Gesehen“ trotzdem melden (ein älterer Server ignoriert es), sonst käme der Aufstieg anderswo noch einmal.
        if (levelUp && sameUser()) enqueueLevelUp(levelUp, { onDone: () => markSeen(forUser, { level: next }) });
        return;
      }
      const levelUp = levelUpFrom(state.level, next);
      if (!levelUp) {
        await SecureStore.setItemAsync(levelKey(forUser), JSON.stringify(next)).catch(() => {});
        return;
      }
      const target = `${forUser}:${next.prestige}:${next.level}`;
      if (queuedLevelRef.current === target) return;
      queuedLevelRef.current = target;
      enqueueLevelUp(levelUp, {
        onDone: () => {
          if (queuedLevelRef.current === target) queuedLevelRef.current = null;
          SecureStore.setItemAsync(levelKey(forUser), JSON.stringify(next)).catch(() => {});
          markSeen(forUser, { level: next });
        },
        check: serverCheck(forUser),
      });
    } catch {
      /* rein kosmetisch */
    }
  }, [userId]);

  const check = useCallback(async (fromLive: boolean) => {
    if (!userId) return;
    try {
      const { data } = await api.get<{ groups?: AchievementGroup[] }>("/achievements/me");
      const key = seenKey(userId);
      const state = await ceremonyState(userId);
      if (state) {
        // Der Stand vom Server: offen ist, was dort noch nicht gesehen ist - der Merker im Gerät zählt nicht mehr.
        const groups = data?.groups || [];
        const unseen = new Set(state.unseen);
        const open = earnedTiers(groups).filter((tier) => unseen.has(tier.code) && !shownRef.current.has(tier.code));
        if (!open.length) {
          if (!fromLive) await SecureStore.setItemAsync(key, new Date().toISOString());
          return;
        }
        open.forEach((tier) => shownRef.current.add(tier.code));
        const fresh = open.slice(0, MAX_TIERS);
        const codes = open.map((tier) => tier.code);
        const context = { ...describePackage(groups, fresh), ...(fromLive ? {} : CATCH_UP) };
        enqueueCeremony(fresh, context, {
          onDone: () => {
            remember(key);
            markSeen(userId, { codes });
          },
          check: serverCheck(userId),
        });
        return;
      }
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
      const context = { ...describePackage(groups, fresh), ...(fromLive ? {} : CATCH_UP) };
      // Rückfall ohne Server-Stand: „gesehen“ trotzdem melden, sonst käme sie auf einem anderen Gerät noch einmal.
      enqueueCeremony(fresh, context, {
        onDone: () => {
          remember(key);
          markSeen(userId, { codes: fresh.map((tier) => tier.code) });
        },
      });
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

  // Prestige (oder seine Rücknahme) im Profil: gleich nachsehen - ein neuer Stern wird gefeiert, eine Rücknahme nicht.
  useEffect(() => {
    if (!userId) return undefined;
    return onLevelChanged(() => {
      void checkLevel();
    });
  }, [checkLevel, userId]);

  return <CeremonyHost />;
}
