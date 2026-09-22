import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

// App-Sperre (#217, Stufe 1): Fingerabdruck, Gesicht oder Gerätesperre, bevor Chats und Profil
// sichtbar sind. Der Schalter liegt nur am Gerät (SecureStore); zum Server geht nichts davon.

export const APP_LOCK_KEY = "tls.mobile.appLock";
/** Wer kurz in eine andere App wechselt, muss nicht gleich wieder entsperren. */
export const RELOCK_AFTER_MS = 60_000;

export type LockAvailability = {
  available: boolean;
  /** "not_enrolled": am Gerät ist keine Bildschirmsperre eingerichtet - dann gäbe es kein Zurück. */
  reason: "" | "not_enrolled";
  /** In Worten, für die Erklärung: "Fingerabdruck", "Gesicht", "Gerätesperre" ... */
  method: string;
};

export function shouldRelock(hiddenAt: number | null, now: number, threshold = RELOCK_AFTER_MS): boolean {
  if (hiddenAt == null) return false;
  return now - hiddenAt >= threshold;
}

export function methodLabel(types: number[], level?: number): string {
  const T = LocalAuthentication.AuthenticationType;
  if (level === LocalAuthentication.SecurityLevel.SECRET) return "Gerätesperre";
  const face = types.includes(T.FACIAL_RECOGNITION);
  const finger = types.includes(T.FINGERPRINT);
  if (face && finger) return "Fingerabdruck oder Gesicht";
  if (face) return "Gesicht";
  if (finger) return "Fingerabdruck";
  if (types.includes(T.IRIS)) return "Iris";
  return "Gerätesperre";
}

export function availabilityText(availability: LockAvailability): string {
  if (availability.reason === "not_enrolled") {
    return "Auf diesem Gerät ist keine Bildschirmsperre eingerichtet – zuerst in den Geräte-Einstellungen anlegen.";
  }
  return `Beim Start und nach einer Minute im Hintergrund fragt die App nach ${availability.method || "deiner Gerätesperre"}.`;
}

export async function lockAvailability(): Promise<LockAvailability> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return { available: false, reason: "not_enrolled", method: "" };
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return { available: true, reason: "", method: methodLabel(types, level) };
  } catch {
    return { available: false, reason: "not_enrolled", method: "" };
  }
}

/** Fragt das System. Abgebrochen oder nicht erkannt heißt: bleibt gesperrt. */
export async function authenticate(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "LionsAPP entsperren",
      cancelLabel: "Abbrechen",
      disableDeviceFallback: false,
    });
    return Boolean(result.success);
  } catch {
    return false;
  }
}

export async function readAppLock(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(APP_LOCK_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function writeAppLock(enabled: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(APP_LOCK_KEY, enabled ? "true" : "false");
  } catch {
    // Ohne SecureStore gilt der Schalter nur bis zum nächsten Start.
  }
}
