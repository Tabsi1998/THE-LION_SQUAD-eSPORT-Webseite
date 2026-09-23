import { getCrashlytics, log as crashLog, recordError as crashRecordError, setCrashlyticsCollectionEnabled } from "@react-native-firebase/crashlytics";

// Absturzberichte (#219, Entscheidung des Betreibers vom 23.09.): Firebase Crashlytics. Gesendet
// werden Gerätemodell, Android-Version, App-Version und die Stelle im Programm - keine Namen, keine
// Nachrichten, keine Inhalte; Nutzer werden nicht gekennzeichnet. Im Entwicklungsmodus bleibt es aus.
// Abstürze der App selbst fängt Crashlytics nativ; hier gehen die abgefangenen Fehler dazu.

let enabled = false;

export function crashReportsEnabled(): boolean {
  return enabled;
}

export async function installCrashReporting(isDev: boolean = __DEV__): Promise<boolean> {
  try {
    await setCrashlyticsCollectionEnabled(getCrashlytics(), !isDev);
    enabled = !isDev;
  } catch {
    enabled = false;
  }
  return enabled;
}

/** Ein abgefangener Fehler mit seinem Ort. Vom Kontext gehen nur die Schlüssel mit - nie die Werte. */
export function recordError(error: unknown, source = "app", context?: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    const instance = getCrashlytics();
    const keys = context ? Object.keys(context).slice(0, 10).join(",") : "";
    crashLog(instance, keys ? `${source}: ${keys}` : source);
    crashRecordError(instance, error instanceof Error ? error : new Error(String(error)), source);
  } catch {
    // Absturzberichte dürfen nie selbst ein Problem werden.
  }
}
