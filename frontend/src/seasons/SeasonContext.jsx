import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useReducedMotion } from "@/hooks/useLiveChanges";

// Jahreszeiten-Bühne (#634): eine Quelle für „was ist gerade aktiv“ (Server, /seasonal/active), die
// persönliche Einstellung (an, dezent, aus - im Konto oder im Browser), „Bewegung reduzieren“ des
// Systems und die Vorschau aus dem Admin (Token in dieser Sitzung, 60 Sekunden).

export const PREVIEW_STORAGE_KEY = "tls-season-preview";
export const PREFERENCE_STORAGE_KEY = "tls-season-preference";
export const PREFERENCES = ["on", "subtle", "off"];
export const REFRESH_MS = 10 * 60 * 1000;
export const FAST_REFRESH_MS = 30 * 1000;
// Rund um Mitternacht am 31.12. fragt der Client alle 30 Sekunden - der Server bestimmt die Phase.
const FAST_PHASES = new Set(["pre_countdown", "countdown", "show", "fade"]);

const SeasonContext = createContext(null);

export function readPreviewToken(now = Date.now()) {
  try {
    const raw = sessionStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !(parsed.expires > now)) {
      sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readStoredPreference() {
  try {
    const value = localStorage.getItem(PREFERENCE_STORAGE_KEY);
    return PREFERENCES.includes(value) ? value : "on";
  } catch {
    return "on";
  }
}

/** Welche Stärke wirklich gezeichnet wird: Person und System dürfen die Saison nur leiser machen. */
export function effectiveIntensity(season, preference, reducedMotion) {
  if (preference === "off") return "off";
  if (reducedMotion || preference === "subtle") return "subtle";
  return season?.intensity || "normal";
}

export function refreshDelayFor(seasons) {
  const fast = (seasons || []).some((season) => season.key === "new_year" && FAST_PHASES.has(season.phase));
  if (fast) return FAST_REFRESH_MS;
  const evening31 = (seasons || []).find((season) => season.key === "new_year" && season.phase === "evening_31");
  if (evening31) {
    const end = new Date(evening31.ends_at).getTime();
    if (Number.isFinite(end)) return Math.max(FAST_REFRESH_MS, Math.min(REFRESH_MS, end - Date.now() + 1000));
  }
  return REFRESH_MS;
}

export function SeasonProvider({ children, channel = "web" }) {
  const { user } = useAuth();
  const reducedMotion = useReducedMotion();
  const [payload, setPayload] = useState(null);
  const [localPreference, setLocalPreference] = useState(readStoredPreference);
  const [previewToken, setPreviewToken] = useState(() => readPreviewToken()?.token || null);
  const timer = useRef(0);

  const load = useCallback(async () => {
    const preview = readPreviewToken();
    setPreviewToken(preview?.token || null);
    try {
      const { data } = await api.get("/seasonal/active", { params: preview ? { preview: preview.token } : {}, skipInvalidation: true });
      setPayload(data && Array.isArray(data.seasons) ? data : { seasons: [] });
    } catch {
      setPayload((current) => current || { seasons: [] });
    }
  }, []);

  // Laden, dann nach Plan nachfragen; nach einer Vorschau genau bei ihrem Ende noch einmal.
  useEffect(() => {
    load();
    const onVisible = () => {
      if (!document.hidden) load();
    };
    const onPreview = () => load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("tls:season-preview", onPreview);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("tls:season-preview", onPreview);
    };
  }, [load]);

  useEffect(() => {
    if (!payload) return undefined;
    const preview = readPreviewToken();
    const delay = preview ? Math.max(1000, preview.expires - Date.now() + 500) : refreshDelayFor(payload.seasons);
    timer.current = window.setTimeout(load, delay);
    return () => window.clearTimeout(timer.current);
  }, [payload, load]);

  const preference = PREFERENCES.includes(user?.seasonal_decorations) ? user.seasonal_decorations : localPreference;
  const setPreference = useCallback(async (value) => {
    if (!PREFERENCES.includes(value)) return;
    setLocalPreference(value);
    try {
      localStorage.setItem(PREFERENCE_STORAGE_KEY, value);
    } catch {
      // Privates Fenster: die Wahl gilt für diese Seite.
    }
    if (user?.id) {
      try {
        await api.patch("/users/me", { seasonal_decorations: value });
      } catch {
        // Der Browser merkt sich die Wahl trotzdem.
      }
    }
  }, [user?.id]);

  const value = useMemo(() => {
    const seasons = (payload?.seasons || []).filter((season) => (season.channels || []).includes(channel));
    const byKey = {};
    seasons.forEach((season) => {
      byKey[season.key] = { ...season, effective: effectiveIntensity(season, preference, reducedMotion) };
    });
    return {
      ready: payload !== null,
      seasons: Object.values(byKey),
      byKey,
      preference,
      setPreference,
      reducedMotion,
      preview: Boolean(previewToken && payload?.preview),
      reload: load,
    };
  }, [payload, channel, preference, setPreference, reducedMotion, previewToken, load]);

  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>;
}

const EMPTY = { ready: false, seasons: [], byKey: {}, preference: "on", setPreference: () => {}, reducedMotion: false, preview: false, reload: () => {} };

export function useSeason() {
  return useContext(SeasonContext) || EMPTY;
}
