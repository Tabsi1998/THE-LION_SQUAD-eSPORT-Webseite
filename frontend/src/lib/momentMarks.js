// Saisonende-Moment (#1639): Browser-Marken je Person und Moment - der Geräte-Schlüssel fürs Holen und „fertig, aber noch nicht beim
// Server“. Sie hängen an der Konto-ID: Meldet sich am selben Browser eine andere Person an, gilt ihr Moment nicht still als gesehen.
// Abmelden räumt sie weg (AuthContext.logout). Ohne Speicher (privates Fenster) gelten sie je Sitzung.

const PREFIX = "tls_moment_";
const memory = new Map();

export const claimKey = (userId, id) => `${PREFIX}claim:${userId || "gast"}:${id}`;
export const doneKey = (userId, id) => `${PREFIX}done:${userId || "gast"}:${id}`;

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
