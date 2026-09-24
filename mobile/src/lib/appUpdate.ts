import Constants from "expo-constants";
import { API_BASE_URL } from "../config";

// Update aus der App (#250). Der Server hält je Build eine APK; die App fragt
// höchstens einmal pro Stunde nach, lädt mit ihrer Anmeldung und öffnet den
// Installer. Alles, was sich ohne Gerät prüfen lässt, steht hier.

export type AppRelease = {
  build: number;
  version: string;
  notes: string;
  sha256?: string | null;
  md5?: string | null;
  size: number;
  published_at?: string | null;
  min_build?: number | null;
  is_current?: boolean;
  /** Beta (Pre-Release) oder Release (#309); fehlt der Wert, entscheidet die Versionsnummer. */
  channel?: ReleaseChannel | null;
  filename: string;
  download_url: string;
};

export type ReleaseChannel = "beta" | "release";

export function releaseChannel(release: Pick<AppRelease, "channel" | "version">): ReleaseChannel {
  if (release.channel === "beta" || release.channel === "release") return release.channel;
  return /-beta$/i.test(String(release.version || "")) ? "beta" : "release";
}

export function channelLabel(channel: ReleaseChannel) {
  return channel === "beta" ? "BETA · Testversion" : "RELEASE";
}

/** Die Rückfrage vor dem Installieren (#309): je Art ein eigener Satz, Pflicht bleibt Pflicht. */
export function installPrompt(channel: ReleaseChannel, mandatory: boolean): { title: string; message: string } {
  const duty = mandatory ? " Dieses Update ist Pflicht – ohne geht es nicht weiter." : "";
  if (channel === "beta") {
    return { title: "Testversion installieren?", message: `Diese Version ist eine Beta – sie kann Fehler enthalten. Rückmeldungen bitte an den Vorstand (Mehr → Kontakt).${duty}` };
  }
  return { title: "Release installieren?", message: `Die neue Version ist geprüft und freigegeben.${duty}` };
}

export type AppVersionInfo = {
  current: AppRelease | null;
  own_build?: number | null;
  update_available: boolean;
  mandatory: boolean;
  next_check_after?: string;
  /** Ob der Betreiber die Server-APK noch anbietet (#421); fehlt der Wert, gilt ja. */
  server_updater_enabled?: boolean;
  play_store_url?: string | null;
};

// Woher die App kommt (#421): über Google Play signiert Google - eine Server-APK lässt sich
// darüber nicht installieren. Deshalb bekommen Play-Installationen Googles Update-Dialog, die
// Server-APK bleibt für Sideload und den Notfall.
export type InstallSource = "play" | "sideload" | "unknown";
export type UpdatePath = "play" | "server";

export const PLAY_STORE_URL = "market://details?id=at.lionsquad.app";
export const PLAY_STORE_WEB_URL = "https://play.google.com/store/apps/details?id=at.lionsquad.app";

/** Welchen Weg der Banner zeigt: Play, sobald die App von dort kommt oder der Server-Updater aus ist. */
export function updatePath(source: InstallSource, info: AppVersionInfo | null | undefined): UpdatePath {
  if (source === "play") return "play";
  if (info?.server_updater_enabled === false) return "play";
  return "server";
}

export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const SNOOZE_KEY = "tls.mobile.updateSnoozedBuild";
export const LAST_CHECK_KEY = "tls.mobile.updateCheckedAt";

/** Der eigene Build aus der App-Konfiguration (Android versionCode). */
export function ownBuild(): number {
  const fromConfig = Number(Constants.expoConfig?.android?.versionCode || 0);
  return Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : 0;
}

export function ownVersion(): string {
  return String(Constants.expoConfig?.version || "");
}

/** Höchstens einmal pro Stunde nachfragen, auch wenn die App oft in den Vordergrund kommt. */
export function shouldCheck(lastCheckedAt: number | null | undefined, now = Date.now(), interval = CHECK_INTERVAL_MS) {
  if (!lastCheckedAt || !Number.isFinite(lastCheckedAt)) return true;
  return now - lastCheckedAt >= interval;
}

export type UpdateDecision = { show: boolean; mandatory: boolean; release: AppRelease | null };

/**
 * Ob der Banner erscheint: nur bei einem neueren Build; „Später“ blendet ihn
 * bis zur nächsten Sitzung aus - außer das Update ist Pflicht.
 */
export function decideUpdate(info: AppVersionInfo | null | undefined, snoozedBuild: number | null | undefined): UpdateDecision {
  const release = info?.current || null;
  if (!info || !release || !info.update_available) return { show: false, mandatory: false, release: null };
  const mandatory = Boolean(info.mandatory);
  if (!mandatory && snoozedBuild && snoozedBuild >= release.build) return { show: false, mandatory: false, release };
  return { show: true, mandatory, release };
}

export function releaseTitle(release: AppRelease) {
  return `Build ${release.build} ist da – v${release.version}`;
}

export function releaseSizeLabel(size: number) {
  if (!size) return "";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(size / 1024)} KB`;
}

/** Absolute Download-Adresse, gleich für Emulator und Server. */
export function downloadUrl(release: AppRelease) {
  const path = release.download_url || `/api/mobile/app-download/${release.build}`;
  return path.startsWith("/") ? `${API_BASE_URL}${path}` : path;
}

/**
 * Stimmt die geladene Datei? Größe muss passen; MD5 wird verglichen, wenn
 * der Server einen hat. Ein Fehler hier heißt: nicht installieren.
 */
export function verifyDownload(release: AppRelease, info: { size?: number; md5?: string | null }): string | null {
  if (release.size && info.size !== undefined && info.size !== release.size) {
    return `Datei unvollständig (${info.size} von ${release.size} Bytes).`;
  }
  if (release.md5 && info.md5 && info.md5.toLowerCase() !== release.md5.toLowerCase()) {
    return "Prüfsumme stimmt nicht - Download verworfen.";
  }
  return null;
}

/** Wie der Fortschritt angezeigt wird: 0 bis 1, nie über 1. */
export function progressShare(written: number, expected: number) {
  if (!expected || expected <= 0) return 0;
  return Math.min(1, Math.max(0, written / expected));
}
