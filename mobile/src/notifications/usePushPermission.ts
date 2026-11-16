import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { getPushPermission, onPushPermissionChange, type PushPermission } from "./PushService";
import { isPushAsked } from "./pushPrompt";

/** Die Erlaubnis und ob die App Android schon gefragt hat (#1208: Android 13 meldet vorher schon „denied“). */
export type PushPermissionView = PushPermission & { asked: boolean };

/**
 * Die Erlaubnis des Systems für Benachrichtigungen (#1208) - beim Öffnen gelesen, nach der Rückkehr aus den
 * Systemeinstellungen neu und sofort, wenn die App selbst gefragt hat. `null`, solange unbekannt.
 */
export function usePushPermission(enabled = true): PushPermissionView | null {
  const [permission, setPermission] = useState<PushPermissionView | null>(null);

  const read = useCallback(() => {
    let alive = true;
    Promise.all([getPushPermission(), isPushAsked()])
      .then(([value, asked]) => { if (alive) setPermission({ ...value, asked }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const stop = read();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });
    const off = onPushPermissionChange((value) => setPermission({ ...value, asked: true }));
    return () => {
      stop();
      subscription?.remove?.();
      off();
    };
  }, [enabled, read]);

  return enabled ? permission : null;
}
