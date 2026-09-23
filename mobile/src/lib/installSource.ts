import { Platform } from "react-native";
import type { InstallSource } from "./appUpdate";

// Installationsquelle (#421): Google Play kennt nur Apps, die es selbst installiert hat. Antwortet
// der Play-Dienst auf die Update-Anfrage, kommt die App von dort; ein Fehler heißt Sideload (die
// Server-APK) - oder ein Gerät ohne Play-Dienste. Genauer geht es ohne eigenes natives Modul nicht.

export type PlayUpdateState = {
  source: InstallSource;
  updateAvailable: boolean;
  immediateAllowed: boolean;
  flexibleAllowed: boolean;
};

type InAppUpdates = {
  checkForUpdate: () => Promise<{ updateAvailable?: boolean; immediateAllowed?: boolean; flexibleAllowed?: boolean }>;
  startUpdate: (immediate?: boolean) => Promise<boolean>;
};

function loadModule(): InAppUpdates | null {
  try {
    // require statt import(): Metro und Jest laden das Modul so gleich; fehlt es (Build ohne das
    // Modul), bleibt die Quelle „unknown“ und der Server-Weg gilt wie bisher.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-in-app-updates") as InAppUpdates;
    return mod && typeof mod.checkForUpdate === "function" ? mod : null;
  } catch {
    return null;
  }
}

export async function detectInstallSource(): Promise<PlayUpdateState> {
  const unknown: PlayUpdateState = { source: "unknown", updateAvailable: false, immediateAllowed: false, flexibleAllowed: false };
  if (Platform.OS !== "android") return unknown;
  const mod = loadModule();
  if (!mod) return unknown;
  try {
    const result = await mod.checkForUpdate();
    return {
      source: "play",
      updateAvailable: Boolean(result?.updateAvailable),
      immediateAllowed: Boolean(result?.immediateAllowed),
      flexibleAllowed: Boolean(result?.flexibleAllowed),
    };
  } catch {
    return { ...unknown, source: "sideload" };
  }
}

/** Googles Dialog starten - sofort bei Pflicht, sonst im Hintergrund. Liefert, ob er aufging. */
export async function startPlayUpdate(immediate: boolean): Promise<boolean> {
  const mod = loadModule();
  if (!mod) return false;
  try {
    return Boolean(await mod.startUpdate(immediate));
  } catch {
    return false;
  }
}
