import whatsNew from "../whatsnew.json";

// „Was ist neu“ (#249): der Abschnitt der aktuellen Version aus CHANGELOG.md
// wird beim Versionssprung nach src/whatsnew.json geschrieben (npm run
// whatsnew) und vom Release-Preflight geprüft. Kein Server nötig.

export type WhatsNew = { version: string; build: number; date: string; items: string[] };

export const SEEN_BUILD_KEY = "tls.mobile.whatsNewSeenBuild";

export function currentWhatsNew(): WhatsNew {
  const data = whatsNew as Partial<WhatsNew>;
  return {
    version: String(data.version || ""),
    build: Number(data.build || 0),
    date: String(data.date || ""),
    items: Array.isArray(data.items) ? data.items.map(String).filter(Boolean) : [],
  };
}

/**
 * Die Karte erscheint genau einmal nach einem Update: gespeicherter Build
 * kleiner als der eigene. Beim allerersten Start (nichts gespeichert) nicht -
 * wer die App gerade installiert hat, kennt „neu“ noch nicht.
 */
export function shouldShowWhatsNew(seenBuild: number | null | undefined, ownBuild: number, items: string[] = currentWhatsNew().items) {
  if (!ownBuild || !items.length) return false;
  if (seenBuild === null || seenBuild === undefined || !Number.isFinite(seenBuild)) return false;
  return seenBuild < ownBuild;
}

export function whatsNewTitle(entry: WhatsNew) {
  return `Neu in v${entry.version}${entry.build ? ` (Build ${entry.build})` : ""}`;
}

/** Ein Changelog-Punkt ohne das Präfix „Mobile:“ und ohne die Issue-Nummer am Ende. */
export function tidyItem(line: string) {
  return String(line || "")
    .replace(/^\s*-\s*/, "")
    .replace(/^(Mobile|App):\s*/i, "")
    .replace(/\s*\((#\d+(,\s*#\d+)*)\)\s*\.?$/, ".")
    .replace(/\.\.$/, ".")
    .trim();
}
