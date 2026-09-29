import { useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { enqueueLevelUp } from "@/components/achievements/ceremony/queue";

const storeKey = (uid) => `tls-level-seen:${uid}`;

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
      if (prev && Number(prev.level) && (nextLevel > Number(prev.level) || nextPrestige > Number(prev.prestige || 0))) {
        enqueueLevelUp({
          level: nextLevel,
          previous: Number(prev.level),
          title: nextTitle,
          titleChanged: Boolean(nextTitle) && nextTitle !== String(prev.title || ""),
          prestige: nextPrestige,
          prestigeGained: nextPrestige > Number(prev.prestige || 0),
        });
      }
      try { localStorage.setItem(key, JSON.stringify({ level: nextLevel, title: nextTitle, prestige: nextPrestige })); } catch { /* egal */ }
    } catch { /* rein kosmetisch */ }
    finally { busyRef.current = false; }
  }, [user?.id]);

  useEffect(() => { check(); }, [check]);
  useApiInvalidation(check, ["achievements", "admin/notifications", "notifications"]);
  useEffect(() => {
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  return null;
}
