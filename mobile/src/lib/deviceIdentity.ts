import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Das Gerät je Installation (#942): eine zufällige Kennung, einmal angelegt und im sicheren Speicher behalten, dazu
// ein Name wie „Pixel 9 / Android 16“. Beides geht als Kopfzeile mit jedem Aufruf - der Server zeigt das Gerät in der
// Sitzungsliste, schließt beim Neu-Login die alte Sitzung desselben Geräts und lässt dem Gerät beim Erneuern ein
// längeres Gnadenfenster. Kopfzeilen sind ASCII: alles andere wird ersetzt. Kein Fingerabdruck - die Kennung ist
// Zufall, sagt nichts über das Handy und fällt mit der App.

export const DEVICE_ID_KEY = "tls.mobile.deviceId";
export const DEVICE_ID_HEADER = "X-Device-Id";
export const DEVICE_NAME_HEADER = "X-Device-Name";
const NAME_MAX = 120;

export type DeviceIdentity = { id: string; name: string };

/** Nur druckbares ASCII - HTTP-Kopfzeilen vertragen nichts anderes (Android lehnt sie sonst ab). */
export function asciiHeaderValue(value: string, max = NAME_MAX): string {
  return value.replace(/\s+/g, " ").replace(/[^\x20-\x7e]/g, "?").trim().slice(0, max);
}

/** „Pixel 9 / Android 16“ - Modell und System, ohne Konto- oder Personenbezug. */
export function deviceName(model: string | null | undefined = Device.modelName, osVersion: string | null | undefined = Device.osVersion, os: string = Platform.OS): string {
  const system = os === "android" ? "Android" : os === "ios" ? "iOS" : os;
  const left = String(model || "").trim() || system;
  const right = `${system}${osVersion ? ` ${String(osVersion).trim()}` : ""}`;
  return asciiHeaderValue(`${left} / ${right}`);
}

export function randomDeviceId(random: () => number = Math.random): string {
  // 32 Hex-Zeichen aus Zufall und Zeit - eine Kennung, kein Geheimnis.
  let out = Date.now().toString(16);
  while (out.length < 32) out += Math.floor(random() * 16).toString(16);
  return out.slice(0, 32);
}

let cached: Promise<DeviceIdentity> | null = null;

/** Die Kennung dieser Installation - beim ersten Mal angelegt, danach aus dem sicheren Speicher; nie zweimal gleichzeitig. */
export function getDeviceIdentity(): Promise<DeviceIdentity> {
  if (!cached) {
    cached = (async () => {
      let id = "";
      try {
        id = (await SecureStore.getItemAsync(DEVICE_ID_KEY)) || "";
        if (!/^[a-f0-9]{16,64}$/.test(id)) {
          id = randomDeviceId();
          await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
        }
      } catch {
        // Ohne sicheren Speicher (sehr alte Geräte): eine Kennung nur für diesen Lauf.
        id = id || randomDeviceId();
      }
      return { id, name: deviceName() };
    })();
  }
  return cached;
}

/** Nur für Tests: die gemerkte Kennung vergessen. */
export function resetDeviceIdentity() {
  cached = null;
}

/** Die Kopfzeilen für einen Aufruf - leer, wenn die Kennung (noch) nicht da ist. */
export async function deviceHeaders(): Promise<Record<string, string>> {
  try {
    const identity = await getDeviceIdentity();
    return { [DEVICE_ID_HEADER]: identity.id, [DEVICE_NAME_HEADER]: identity.name };
  } catch {
    return {};
  }
}
