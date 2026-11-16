import { useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { enqueueLevelUp } from "@/components/achievements/ceremony/queue";
import { ceremonyState, isLevelGain, levelSeenKey as storeKey, markSeen, readLevelSeen as readSeen, serverCheck } from "@/components/achievements/ceremony/seen";

// Seit #2450 in ceremony/seen.js - hier weiter erreichbar.
export { isLevelGain, readSeen, storeKey };

/**
 * Das Paket für die Zeremonie, wenn seit dem zuletzt gesehenen Stand (`prev`) ein Aufstieg dazukam - sonst null.
 * Ohne gemerkten Stand (erster Besuch) wird nichts gefeiert. Weil der neue Stand gleich danach gemerkt wird, feiert
 * die Seite jeden Aufstieg genau einmal - auch den Aufstiegs-Moment des Löwen-Rangs (#1456), der an diesem Paket hängt.
 */
export function levelUpFrom(prev, next) {
  if (!prev || !Number(prev.level) || !isLevelGain(prev, next)) return null;
  const level = Number(next.level || 1);
  const title = String(next.title || "");
  const prestige = Number(next.prestige || 0);
  return {
    level,
    previous: Number(prev.level),
    title,
    titleChanged: Boolean(title) && title !== String(prev.title || "") && prestige <= Number(prev.prestige || 0),
    prestige,
    prestigeGained: prestige > Number(prev.prestige || 0),
  };
}

/**
 * Den Aufstieg „beanspruchen“: gemerkten Stand lesen, vergleichen und den neuen Stand schreiben - in einem Zug, auch
 * über mehrere Tabs desselben Browsers. Mit der Web-Locks-API (alle aktuellen Browser) wartet ein zweiter Tab, bis der
 * erste fertig ist, und findet dann schon den neuen Stand - derselbe Aufstieg wird auf diesem Gerät nur einmal gezeigt.
 * Ohne Locks (alte Browser) läuft dasselbe ohne Sperre; Lesen und Schreiben folgen dann direkt aufeinander.
 * Das ist der Rückfall ohne Stand vom Server (ältere Fassung); sonst gilt der gesehene Stand am Konto (#2450).
 */
export async function claimLevelUp(key, next, locks = typeof navigator !== "undefined" ? navigator.locks : undefined) {
  const run = () => {
    const levelUp = levelUpFrom(readSeen(key), next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* egal */ }
    return levelUp;
  };
  if (locks && typeof locks.request === "function") {
    try { return await locks.request(key, { mode: "exclusive" }, run); } catch { /* Sperre nicht verfügbar - ohne weiter */ }
  }
  return run();
}

function remember(key, next) {
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* egal */ }
}

/**
 * Level-Aufstieg erkennen (#617) und als Zeremonie feiern (E8, #618): die Zahl bricht auf, die neue
 * fällt ein, alle fünf Level ein Titel-Banner, Sterne bei Prestige. Gemerkt wird je Konto am Server (#2450) - ein
 * Aufstieg kommt auf einem Gerät, nicht auf jedem; geschlossen (wie auch immer) gilt er als gesehen. Ohne Stand vom
 * Server merkt sich der Browser den Stand wie bisher.
 */
export function LevelUpCelebration() {
  const { user } = useAuth();
  // Läuft gerade eine Prüfung - je Konto, damit ein Kontowechsel nicht auf die alte wartet.
  const busyRef = useRef(null);
  const userId = user?.id;
  // Das gerade angemeldete Konto: eine Antwort, die noch für das vorige Konto unterwegs war, wird verworfen - sonst
  // landet der Stand von Konto B im Merker von Konto A.
  const currentRef = useRef(userId);
  useEffect(() => { currentRef.current = userId; }, [userId]);
  // Der Aufstieg, der gerade in der Warteschlange steht - eine zweite Prüfung (Fokus, Prestige) reiht ihn nicht noch einmal ein.
  const queuedRef = useRef(null);

  const check = useCallback(async () => {
    if (!userId || busyRef.current === userId) return;
    busyRef.current = userId;
    try {
      const { data } = await api.get("/users/me/level");
      if (currentRef.current !== userId) return;
      const next = { level: Number(data?.level || 1), title: String(data?.title || ""), prestige: Number(data?.prestige || 0) };
      const state = await ceremonyState(userId);
      if (currentRef.current !== userId) return;
      if (!state) {
        const levelUp = await claimLevelUp(storeKey(userId), next);
        // Rückfall ohne Server-Stand: „gesehen“ trotzdem melden (ein älterer Server ignoriert es), sonst käme der
        // Aufstieg auf einem anderen Gerät noch einmal.
        if (levelUp && currentRef.current === userId) enqueueLevelUp(levelUp, { onDone: () => markSeen(userId, { level: next }) });
        return;
      }
      const levelUp = levelUpFrom(state.level, next);
      if (!levelUp) {
        remember(storeKey(userId), next);
        return;
      }
      const target = `${userId}:${next.prestige}:${next.level}`;
      if (queuedRef.current === target) return;
      queuedRef.current = target;
      enqueueLevelUp(levelUp, {
        onDone: () => {
          if (queuedRef.current === target) queuedRef.current = null;
          remember(storeKey(userId), next);
          markSeen(userId, { level: next });
        },
        check: serverCheck(userId),
      });
    } catch { /* rein kosmetisch */ }
    finally { if (busyRef.current === userId) busyRef.current = null; }
  }, [userId]);

  useEffect(() => { check(); }, [check]);
  // Prestige (und seine Rücknahme) im Profil ändert das Level sofort - dann gleich nachsehen.
  useApiInvalidation(check, ["achievements", "admin/notifications", "notifications", "users/me/prestige"]);
  useEffect(() => {
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  return null;
}
