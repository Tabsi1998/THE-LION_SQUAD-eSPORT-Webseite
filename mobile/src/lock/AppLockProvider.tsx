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

export function AppLockProvider({ children, now = Date.now }: { children: React.ReactNode; now?: () => number }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [availability, setAvailability] = useState<LockAvailability>(NO_LOCK);
  const enabledRef = useRef(false);
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [stored, found] = await Promise.all([readAppLock(), lockAvailability()]);
      if (!mounted) return;
      // Eine gespeicherte Sperre ohne Gerätesperre wäre nicht zu öffnen - dann gilt sie nicht.
      const on = stored && found.available;
      enabledRef.current = on;
      setEnabledState(on);
      setAvailability(found);
      setLocked(on);
      setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
