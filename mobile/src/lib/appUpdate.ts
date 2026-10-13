import Constants from "expo-constants";

// Update aus der App (#250, #421, #593). Seit der Play-Fassung kommt jedes Update über
// Google Play: die App fragt höchstens einmal pro Stunde den Server, ob es einen neueren
// Build gibt, zeigt den Banner mit „Was ist neu“ und startet Googles Update-Dialog oder
// öffnet die Store-Seite. Den eigenen APK-Download mit Installer gibt es nicht mehr -
// Google erlaubt die Berechtigung dafür nur App-Stores. Alles, was sich ohne Gerät prüfen
// lässt, steht hier.

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

/** Die Rückfrage vor dem Update (#309): je Art ein eigener Satz, Pflicht bleibt Pflicht. */
export function installPrompt(channel: ReleaseChannel, mandatory: boolean): { title: string; message: string } {
  const duty = mandatory ? " Dieses Update ist Pflicht – ohne geht es nicht weiter." : "";
  if (channel === "beta") {
    // Ohne Pfad in der App: „Mehr → Kontakt“ gab es nie als Eintrag, und den Tab „Mehr“ gibt es seit #1143 nicht mehr.
    return { title: "Testversion installieren?", message: `Diese Version ist eine Beta – sie kann Fehler enthalten. Rückmeldungen bitte an den Vorstand.${duty}` };
  }
  return { title: "Release installieren?", message: `Die neue Version ist geprüft und freigegeben.${duty}` };
}

export type AppVersionInfo = {
  current: AppRelease | null;
  own_build?: number | null;
  update_available: boolean;
  mandatory: boolean;
  next_check_after?: string;
  /** Vom Server noch geliefert; seit der Play-Fassung (#593) ohne Wirkung in der App. */
  server_updater_enabled?: boolean;
  play_store_url?: string | null;
};

// Woher die App kommt (#421): über Google Play signiert Google; nur dort gibt es den Update-Dialog
// in der App. Bei Sideload-Installationen (Geräte ohne Google Play) führt der Banner in den Store.
export type InstallSource = "play" | "sideload" | "unknown";

export const PLAY_STORE_URL = "market://details?id=at.lionsquad.app";
export const PLAY_STORE_WEB_URL = "https://play.google.com/store/apps/details?id=at.lionsquad.app";

export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const SNOOZE_KEY = "tls.mobile.updateSnoozedBuild";
/** „Später“ (#1003) gilt für den angebotenen Build und höchstens einen Tag, auch über einen Neustart hinweg. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
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

/** Gespeichertes „Später“ (#1003): welcher Build und wann. */
export type UpdateSnooze = { build: number; at: number };

/** Liest den gespeicherten Aufschub. Alles andere (alter Wert ohne Zeit, kaputter Text) gilt als kein Aufschub. */
export function parseSnooze(raw: string | null | undefined): UpdateSnooze | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<UpdateSnooze> | null;
    if (!value || typeof value !== "object") return null;
    const { build, at } = value;
    if (typeof build !== "number" || !Number.isInteger(build) || build <= 0) return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    return { build, at };
  } catch {
    return null;
  }
}

/** Der Build, für den „Später“ gerade gilt - null, wenn nichts gespeichert oder die Frist um ist. */
export function activeSnoozeBuild(snooze: UpdateSnooze | null | undefined, now = Date.now(), duration = SNOOZE_MS): number | null {
  if (!snooze) return null;
  const age = now - snooze.at;
  // Eine zurückgestellte Uhr darf den Aufschub nicht beliebig verlängern.
  if (age < 0 || age >= duration) return null;
  return snooze.build;
}

export type UpdateDecision = { show: boolean; mandatory: boolean; release: AppRelease | null };

/**
 * Ob der Banner erscheint: nur bei einem neueren Build; „Später“ blendet ihn für
 * diesen Build aus (#1003: SNOOZE_MS lang, auch nach einem Neustart) - außer das
 * Update ist Pflicht. Ein neuerer Build zeigt ihn wieder.
 */
export function decideUpdate(info: AppVersionInfo | null | undefined, snoozedBuild: number | null | undefined): UpdateDecision {
  const release = info?.current || null;
  if (!info || !release || !info.update_available) return { show: false, mandatory: false, release: null };
  const mandatory = Boolean(info.mandatory);
  if (!mandatory && snoozedBuild && snoozedBuild >= release.build) return { show: false, mandatory: false, release };
  return { show: true, mandatory, release };
}

/**
 * Ob unser eigener Update-Hinweis erscheint (#926): nie für eine App aus Google Play - dort kommt jedes Update über
 * Googles eigenen Dialog, sobald Play es anbietet; der Vereinsserver kennt einen neuen Build oft früher als Play.
 * Solange die Quelle noch nicht feststeht, auch nicht - sonst blitzt der Hinweis bei Play-Installationen kurz auf.
 * Nur die Server-APK (`sideload`) und Geräte ohne erkennbare Quelle (`unknown`) bekommen ihn.
 */
export function showOwnUpdateHint(decision: UpdateDecision, source: InstallSource | null | undefined, whatsNewOpen = false): boolean {
  if (!decision.show || !decision.release || whatsNewOpen) return false;
  return source === "sideload" || source === "unknown";
}

export function releaseTitle(release: AppRelease) {
  return `Build ${release.build} ist da – v${release.version}`;
}
