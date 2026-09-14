import { fetch as expoFetch } from "expo/fetch";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { API_URL } from "../config";
import { api } from "../lib/api";
import { createLiveConnection, liveChangeMatches, type LiveChange, type StreamFetch } from "./liveChanges";

type LiveChangesValue = {
  connected: boolean;
  subscribe: (listener: (event: LiveChange) => void) => () => void;
};

// Ohne Provider (etwa in Tests einzelner Screens) gilt der Strom als getrennt:
// useLiveRefresh fragt dann wie bisher im Intervall ab.
const LiveChangesContext = createContext<LiveChangesValue>({
  connected: false,
  subscribe: () => () => {},
});

export function LiveChangesProvider({ children }: { children: React.ReactNode }) {
  const { user, accessToken } = useAuth();
  const tokenRef = useRef<string | null>(accessToken);
  tokenRef.current = accessToken;
  const [connected, setConnected] = useState(false);

  const connection = useMemo(() => createLiveConnection({
    url: `${API_URL}/changes/stream`,
    fetchImpl: expoFetch as unknown as StreamFetch,
    getToken: () => tokenRef.current,
    // Der API-Client erneuert eine abgelaufene Sitzung selbst; ein Aufruf genügt.
    refreshSession: async () => {
      try {
        await api.get("/auth/me");
        return true;
      } catch {
        return false;
      }
    },
  }), []);

  useEffect(() => connection.onStatus(setConnected), [connection]);

  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      connection.stop();
      return undefined;
    }
    connection.restart();
    let wasInBackground = false;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        wasInBackground = true;
        connection.stop();
      } else if (state === "active" && wasInBackground) {
        wasInBackground = false;
        connection.start();
        // Im Hintergrund lief kein Strom: offene Ansichten laden einmal neu.
        connection.emitLocal({ reset: true, reason: "app_resumed" });
      }
    });
    return () => {
      subscription.remove();
      connection.stop();
    };
  }, [connection, userId]);

  const value = useMemo(() => ({ connected, subscribe: connection.subscribe }), [connected, connection]);
  return <LiveChangesContext.Provider value={value}>{children}</LiveChangesContext.Provider>;
}

export function useLiveConnected() {
  return useContext(LiveChangesContext).connected;
}

/**
 * Lädt eine Ansicht neu, sobald der Server eine passende Änderung meldet.
 * Solange keine Live-Verbindung besteht, wird wie bisher im Intervall abgefragt.
 */
export function useLiveRefresh(
  callback: () => unknown,
  resources: readonly string[],
  options: { fallbackMs?: number; debounceMs?: number; enabled?: boolean } = {},
) {
  const { connected, subscribe } = useContext(LiveChangesContext);
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = options.enabled ?? true;
  const debounceMs = options.debounceMs ?? 250;
  const fallbackMs = options.fallbackMs ?? 0;
  const resourceKey = resources.join("|");

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;
    const selected = resourceKey ? resourceKey.split("|") : [];
    const unsubscribe = subscribe((event) => {
      if (!liveChangeMatches(event, selected)) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        runSafely(callbackRef.current);
      }, debounceMs);
    });
    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [debounceMs, enabled, resourceKey, subscribe]);

  useEffect(() => {
    if (!enabled || connected || !fallbackMs) return undefined;
    const timer = setInterval(() => runSafely(callbackRef.current), fallbackMs);
    return () => clearInterval(timer);
  }, [connected, enabled, fallbackMs]);
}

function runSafely(callback: () => unknown) {
  try {
    Promise.resolve(callback()).catch(() => {});
  } catch {
    // Ein fehlgeschlagenes Neuladen zeigt die Ansicht selbst an.
  }
}
