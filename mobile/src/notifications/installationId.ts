import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

// Installations-Kennung für Push (#2470): Der Server ersetzt beim neuen Token den alten Eintrag derselben Installation,
// statt einen weiteren anzulegen (#2467). Die Kennung ist reiner Zufall (UUID, 122 Bit Zufall), keine Hardware- oder
// Android-ID. Sie bleibt nur auf diesem Gerät: im Schlüsselbund ohne Mitnahme in iCloud-Sicherungen
// (THIS_DEVICE_ONLY); unter Android nimmt das Plugin von expo-secure-store den Speicher vom Auto-Backup aus.
// Sonst käme sie bei einer Wiederherstellung auf ein zweites Gerät mit, und beide löschten sich gegenseitig.
// Abmelden und Kontowechsel lassen sie stehen: Sie gehört zur Installation, nicht zum Konto.
// Nie loggen - nicht in Konsole, Client-Logs, Absturzberichten oder Analytics.

export const INSTALLATION_ID_KEY = "tls.mobile.pushInstallationId";
const STORE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/** Die Form, die der Server annimmt: 16 bis 64 Zeichen, nur Buchstaben, Ziffern, `_` und `-`. */
export function isValidInstallationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

let cached: Promise<string | null> | null = null;

async function loadOrCreate(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(INSTALLATION_ID_KEY, STORE_OPTIONS);
  if (isValidInstallationId(stored)) return stored;
  const created = Crypto.randomUUID();
  if (!isValidInstallationId(created)) return null;
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, created, STORE_OPTIONS);
  return created;
}

/**
 * Die Kennung dieser Installation - beim ersten Mal erzeugt, danach aus dem sicheren Speicher; nie zweimal gleichzeitig.
 * Ohne sicheren Speicher `null`: dann meldet die App den Token wie bisher ohne Kennung, statt bei jedem Start eine
 * neue zu schicken. Ein Fehlschlag wird nicht gemerkt, der nächste Aufruf versucht es erneut.
 */
export function getInstallationId(): Promise<string | null> {
  if (!cached) {
    const attempt = loadOrCreate().catch(() => null);
    cached = attempt;
    void attempt.then((id) => {
      if (!id && cached === attempt) cached = null;
    });
  }
  return cached;
}

/** Nur für Tests: die gemerkte Kennung vergessen (der sichere Speicher bleibt). */
export function resetInstallationIdCache() {
  cached = null;
}
