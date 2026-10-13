import { useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { enqueueLevelUp } from "@/components/achievements/ceremony/queue";

export const storeKey = (uid) => `tls-level-seen:${uid}`;

/**
 * Ein Aufstieg: mehr Prestige-Sterne, oder gleich viele Sterne und ein höheres Level. Wer ein Prestige zurücknimmt,
 * hat einen Stern weniger und wieder Level 60 - das ist nichts zum Feiern.
 */
export function isLevelGain(prev, next) {
  const prevStars = Number(prev?.prestige || 0);
  const nextStars = Number(next?.prestige || 0);
  if (nextStars !== prevStars) return nextStars > prevStars;
  return Number(next?.level || 0) > Number(prev?.level || 0);
}

/** Der zuletzt gesehene Stand eines Kontos; ältere Fassungen merkten sich nur die Zahl. */
export function readSeen(key) {
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(key) || "null"); } catch { prev = null; }
  if (typeof prev === "number" || (typeof prev === "string" && /^\d+$/.test(prev))) prev = { level: Number(prev), title: "", prestige: 0 };
  return prev && typeof prev === "object" ? prev : null;
}

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
 * Bewusste Grenze: auf einem anderen Gerät (oder in der App) erscheint der Aufstieg dort noch einmal - der Stand liegt
 * nur im Gerät, nicht auf dem Server.
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

/**
 * Level-Aufstieg erkennen (#617) und als Zeremonie feiern (E8, #618): die Zahl bricht auf, die neue
 * fällt ein, alle fünf Level ein Titel-Banner, Sterne bei Prestige. Gemerkt wird je Konto im Browser,
 * damit derselbe Aufstieg nicht zweimal gefeiert wird.
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

  const check = useCallback(async () => {
    if (!userId || busyRef.current === userId) return;
    busyRef.current = userId;
    try {
      const { data } = await api.get("/users/me/level");
      if (currentRef.current !== userId) return;
      const next = { level: Number(data?.level || 1), title: String(data?.title || ""), prestige: Number(data?.prestige || 0) };
      const levelUp = await claimLevelUp(storeKey(userId), next);
      if (levelUp && currentRef.current === userId) enqueueLevelUp(levelUp);
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
