import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { getPushPermission, onPushPermissionChange, type PushPermission } from "./PushService";

/**
 * Die Erlaubnis des Systems für Benachrichtigungen (#1208) - beim Öffnen gelesen, nach der Rückkehr aus den
 * Systemeinstellungen neu und sofort, wenn die App selbst gefragt hat. `null`, solange unbekannt.
 */
export function usePushPermission(enabled = true): PushPermission | null {
  const [permission, setPermission] = useState<PushPermission | null>(null);

  const read = useCallback(() => {
    let alive = true;
    getPushPermission().then((value) => { if (alive) setPermission(value); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const stop = read();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });
    const off = onPushPermissionChange(setPermission);
    return () => {
      stop();
      subscription?.remove?.();
      off();
    };
  }, [enabled, read]);

  return enabled ? permission : null;
}
