import { useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { enqueueLevelUp } from "@/components/achievements/ceremony/queue";

const storeKey = (uid) => `tls-level-seen:${uid}`;

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

/**
 * Level-Aufstieg erkennen (#617) und als Zeremonie feiern (E8, #618): die Zahl bricht auf, die neue
 * fällt ein, alle fünf Level ein Titel-Banner, Sterne bei Prestige. Gemerkt wird je Konto im Browser,
 * damit derselbe Aufstieg nicht zweimal gefeiert wird.
 */
export function LevelUpCelebration() {
  const { user } = useAuth();
  const busyRef = useRef(false);

  const check = useCallback(async () => {
    if (!user?.id || busyRef.current) return;
    busyRef.current = true;
    try {
      const { data } = await api.get("/users/me/level");
      const nextLevel = Number(data?.level || 1);
      const nextTitle = String(data?.title || "");
      const nextPrestige = Number(data?.prestige || 0);
      const key = storeKey(user.id);
      let prev = null;
      try { prev = JSON.parse(localStorage.getItem(key) || "null"); } catch { prev = null; }
      if (typeof prev === "number" || (typeof prev === "string" && /^\d+$/.test(prev))) prev = { level: Number(prev), title: "", prestige: 0 };
      if (prev && Number(prev.level) && isLevelGain(prev, { level: nextLevel, prestige: nextPrestige })) {
        enqueueLevelUp({
          level: nextLevel,
          previous: Number(prev.level),
          title: nextTitle,
          titleChanged: Boolean(nextTitle) && nextTitle !== String(prev.title || "") && nextPrestige <= Number(prev.prestige || 0),
          prestige: nextPrestige,
          prestigeGained: nextPrestige > Number(prev.prestige || 0),
        });
      }
      try { localStorage.setItem(key, JSON.stringify({ level: nextLevel, title: nextTitle, prestige: nextPrestige })); } catch { /* egal */ }
    } catch { /* rein kosmetisch */ }
    finally { busyRef.current = false; }
  }, [user?.id]);

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
