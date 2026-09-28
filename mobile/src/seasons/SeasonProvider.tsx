import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { useReduceMotion } from "../components/FadeIn";
import { api } from "../lib/api";
import { isGuestUser } from "../live";

// Jahreszeiten in der App (#636): dieselbe Quelle wie die Website (/seasonal/active, Kanal „app“),
// alle zehn Minuten im Vordergrund nachgefragt, rund um Mitternacht am 31.12. alle 30 Sekunden.
// Die persönliche Wahl (an, dezent, aus) kommt aus dem Konto oder - für Gäste - aus dem Gerät;
// „Bewegung reduzieren“ des Systems macht alles dezent. Der Server entscheidet, was läuft;
// ein neuer Build ist nur für neue Saison-Module nötig.

export type SeasonPreference = "on" | "subtle" | "off";
export type Intensity = "subtle" | "normal" | "full";
export type Season = {
  key: string;
  label: string;
  phase: string;
  intensity: Intensity;
  channels: string[];
  texts: Record<string, string>;
  starts_at: string;
  ends_at: string;
  forced: boolean;
  data: Record<string, unknown>;
};
export type ActiveSeason = Season & { effective: Intensity | "off" };
type Payload = { seasons: Season[]; preview?: boolean };

export const PREFERENCES: SeasonPreference[] = ["on", "subtle", "off"];
export const PREFERENCE_KEY = "season_preference";
export const REFRESH_MS = 10 * 60 * 1000;
export const FAST_REFRESH_MS = 30 * 1000;
const FAST_PHASES = new Set(["pre_countdown", "countdown", "show", "fade"]);

export function effectiveIntensity(season: Pick<Season, "intensity">, preference: SeasonPreference, reducedMotion: boolean): Intensity | "off" {
  if (preference === "off") return "off";
  if (reducedMotion || preference === "subtle") return "subtle";
  return season.intensity || "normal";
}

export function refreshDelayFor(seasons: Season[], now = Date.now()): number {
  if (seasons.some((season) => season.key === "new_year" && FAST_PHASES.has(season.phase))) return FAST_REFRESH_MS;
  const evening = seasons.find((season) => season.key === "new_year" && season.phase === "evening_31");
  if (evening) {
    const end = new Date(evening.ends_at).getTime();
    if (Number.isFinite(end)) return Math.max(FAST_REFRESH_MS, Math.min(REFRESH_MS, end - now + 1000));
  }
  return REFRESH_MS;
}

export async function readStoredPreference(): Promise<SeasonPreference> {
  try {
    const value = await SecureStore.getItemAsync(PREFERENCE_KEY);
    return PREFERENCES.includes(value as SeasonPreference) ? (value as SeasonPreference) : "on";
  } catch {
    return "on";
  }
}

export type SeasonToast = { id: number; text: string };

type SeasonContextValue = {
  ready: boolean;
  seasons: ActiveSeason[];
  byKey: Record<string, ActiveSeason>;
  preference: SeasonPreference;
  setPreference: (value: SeasonPreference) => Promise<void>;
  reducedMotion: boolean;
  reload: () => Promise<void>;
  /** Gruß als Overlay-Karte (#655): ein Text für ein paar Sekunden, unabhängig vom Screen-Layout. */
  toast: SeasonToast | null;
  showToast: (text: string, ms?: number) => void;
};

const EMPTY: SeasonContextValue = { ready: false, seasons: [], byKey: {}, preference: "on", setPreference: async () => {}, reducedMotion: false, reload: async () => {}, toast: null, showToast: () => {} };
const SeasonContext = createContext<SeasonContextValue>(EMPTY);

export function SeasonProvider({ children }: { children: React.ReactNode }) {
  const { user, refreshMe } = useAuth();
  const reducedMotion = useReduceMotion();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [stored, setStored] = useState<SeasonPreference>("on");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<SeasonToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string, ms = 4000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Payload>("/seasonal/active");
      setPayload(data && Array.isArray(data.seasons) ? data : { seasons: [] });
    } catch {
      setPayload((current) => current || { seasons: [] });
    }
  }, []);

  useEffect(() => {
    void readStoredPreference().then(setStored);
    void load();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => {
    if (!payload) return undefined;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (AppState.currentState === "active") void load();
    }, refreshDelayFor(payload.seasons));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [payload, load]);

  const accountPreference = (user as { seasonal_decorations?: string } | null)?.seasonal_decorations;
  const preference: SeasonPreference = PREFERENCES.includes(accountPreference as SeasonPreference) ? (accountPreference as SeasonPreference) : stored;

  const setPreference = useCallback(async (value: SeasonPreference) => {
    if (!PREFERENCES.includes(value)) return;
    setStored(value);
    try {
      await SecureStore.setItemAsync(PREFERENCE_KEY, value);
    } catch {
      // Ohne sicheren Speicher gilt die Wahl für diese Sitzung.
    }
    if (user?.id && !isGuestUser(user)) {
      try {
        await api.patch("/users/me", { seasonal_decorations: value });
        await refreshMe?.();
      } catch {
        // Das Gerät merkt sich die Wahl trotzdem.
      }
    }
  }, [refreshMe, user]);

  const value = useMemo<SeasonContextValue>(() => {
    const byKey: Record<string, ActiveSeason> = {};
    (payload?.seasons || []).filter((season) => (season.channels || []).includes("app")).forEach((season) => {
      byKey[season.key] = { ...season, effective: effectiveIntensity(season, preference, reducedMotion) };
    });
    return { ready: payload !== null, seasons: Object.values(byKey), byKey, preference, setPreference, reducedMotion, reload: load, toast, showToast };
  }, [payload, preference, reducedMotion, setPreference, load, toast, showToast]);

  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>;
}

export function useSeason(): SeasonContextValue {
  return useContext(SeasonContext);
}
