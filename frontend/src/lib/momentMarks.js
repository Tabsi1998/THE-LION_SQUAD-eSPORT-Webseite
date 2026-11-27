// Saisonende-Moment (#1639): Browser-Marken je Person und Moment - der Geräte-Schlüssel fürs Holen und „fertig, aber noch nicht beim
// Server“. Sie hängen an der Konto-ID: Meldet sich am selben Browser eine andere Person an, gilt ihr Moment nicht still als gesehen.
// Abmelden räumt sie weg (AuthContext.logout). Ohne Speicher (privates Fenster) gelten sie je Sitzung.

const PREFIX = "tls_moment_";
const memory = new Map();

export const claimKey = (userId, id) => `${PREFIX}claim:${userId || "gast"}:${id}`;
export const doneKey = (userId, id) => `${PREFIX}done:${userId || "gast"}:${id}`;

/**
 * Der Stand eines Moments (Nr. 277, #2591) - dieselbe Regel wie die App (`mobile/src/lib/leagueMoments.ts`, `momentVersion`): Eine
 * Korrektur des Endstands bringt den Moment mit derselben Kennung neu - mit neuem `confirmed_at`, `corrected` und oft anderem Ausgang
 * oder anderer Liga N. Die Marke „fertig“ hält diesen Stand fest: Eine alte Marke meldet einen korrigierten Moment nie still als fertig.
 * Gleicher Ausgang ergibt gleichen Stand (Texte, Belohnungen und der nächste Schritt zählen nicht) - kein neuer Moment.
 */
export function momentVersion(moment) {
  return [moment?.confirmed_at || "", moment?.corrected ? "k" : "", moment?.outcome ?? "", moment?.to?.level ?? ""].join("|");
}

export function readMark(key) {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeMark(key, value) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Kein Speicher - die Marke gilt dann je Sitzung.
  }
}

/** Beim Abmelden: alle Marken des Moments weg - im Speicher und im Browser. */
export function clearMomentMarks() {
  memory.clear();
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Kein Speicher - dann gab es nur die Marken im Speicher.
  }
}
