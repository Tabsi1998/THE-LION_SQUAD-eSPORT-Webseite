import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { authenticate, lockAvailability, readAppLock, shouldRelock, writeAppLock, type LockAvailability } from "../lib/appLock";

// App-Sperre (#217, Stufe 1): Ist der Schalter an, ist die App beim Start gesperrt und wieder,
// sobald sie länger als eine Minute im Hintergrund war. Einschalten verlangt einmal den
// Fingerabdruck - so sperrt sich niemand mit einer Methode aus, die am Gerät nicht geht.

type AppLockValue = {
  ready: boolean;
  enabled: boolean;
  locked: boolean;
  availability: LockAvailability;
  /** Liefert true, wenn der Schalter übernommen wurde. */
  setEnabled: (next: boolean) => Promise<boolean>;
  unlock: () => Promise<boolean>;
};

const NO_LOCK: LockAvailability = { available: false, reason: "not_enrolled", method: "" };

// Ohne Provider (Tests einzelner Screens) gibt es keine Sperre.
const AppLockContext = createContext<AppLockValue>({
  ready: true,
  enabled: false,
  locked: false,
  availability: NO_LOCK,
  setEnabled: async () => false,
  unlock: async () => true,
});

/** So lange darf das Lesen von Schalter und Gerätesperre dauern (#1052), danach gilt die App als gesperrt. */
export const LOCK_READ_TIMEOUT_MS = 5000;

export function AppLockProvider({ children, now = Date.now, readTimeoutMs = LOCK_READ_TIMEOUT_MS }: {
  children: React.ReactNode;
  now?: () => number;
  readTimeoutMs?: number;
}) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [availability, setAvailability] = useState<LockAvailability>(NO_LOCK);
  const enabledRef = useRef(false);
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    let settled = false;
    let timedOut = false;
    // Hängt die Abfrage (#1052), wartet die App nicht ewig auf dem Startbild: nach LOCK_READ_TIMEOUT_MS gilt sie als
    // gesperrt. Entsperren oder Abmelden gehen dann über den Sperrbildschirm.
    const timer = setTimeout(() => {
      if (!mounted || settled) return;
      timedOut = true;
      enabledRef.current = true;
      setEnabledState(true);
      setLocked(true);
      setReady(true);
    }, readTimeoutMs);
    void (async () => {
      const [stored, found] = await Promise.all([readAppLock(), lockAvailability()]);
      if (!mounted) return;
      settled = true;
      clearTimeout(timer);
      // Eine gespeicherte Sperre ohne Gerätesperre wäre nicht zu öffnen - dann gilt sie nicht.
      const on = stored && found.available;
      enabledRef.current = on;
      setEnabledState(on);
      setAvailability(found);
      // Kam die Antwort erst nach der Wartezeit, hebt sie eine Sperre nur auf, sperrt aber nicht nach dem Entsperren neu.
      setLocked((current) => (timedOut ? current && on : on));
      setReady(true);
    })();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [readTimeoutMs]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background" || state === "inactive") {
        if (hiddenAtRef.current == null) hiddenAtRef.current = now();
        return;
      }
      if (state === "active") {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (enabledRef.current && shouldRelock(hiddenAt, now())) setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [now]);

  const unlock = useCallback(async () => {
    const ok = await authenticate();
    if (ok) setLocked(false);
    return ok;
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    if (next && !availability.available) return false;
    if (next && !(await authenticate())) return false;
    enabledRef.current = next;
    setEnabledState(next);
    if (!next) setLocked(false);
    await writeAppLock(next);
    return true;
  }, [availability.available]);

  const value = useMemo(() => ({ ready, enabled, locked, availability, setEnabled, unlock }), [ready, enabled, locked, availability, setEnabled, unlock]);
  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockValue {
  return useContext(AppLockContext);
}
