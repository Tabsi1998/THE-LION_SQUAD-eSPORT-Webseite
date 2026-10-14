// Vor-Ort-Zugang (#1592): Der QR-Code auf TV und Aushang führt auf „/vor-ort#<code>“. Hinter dem „#“ geht der Code an
// keinen Server - nicht in Server-Logs, nicht in den Referrer. Damit er auch keine Statistik, kein Fehlerprotokoll und
// keinen Verlauf erreicht, nimmt ihn `captureOnsiteToken` vor dem Start der Website aus der Adresse und hält ihn nur
// im Speicher, bis die Seite „/vor-ort“ ihn einlöst.

export const ONSITE_PATH = "/vor-ort";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

let pending = "";

/** Den Code aus „/vor-ort#…“ übernehmen und die Adresse sofort bereinigen. Gibt zurück, ob einer da war. */
export function captureOnsiteToken(location = window.location, history = window.history) {
  if (!location || location.pathname.replace(/\/+$/, "") !== ONSITE_PATH || !location.hash) return false;
  history.replaceState(history.state, "", ONSITE_PATH);
  let raw = "";
  try {
    raw = decodeURIComponent(location.hash.slice(1)).trim();
  } catch {
    raw = "";
  }
  pending = TOKEN_PATTERN.test(raw) ? raw : "";
  return Boolean(pending);
}

/** Der übernommene Code - bis `forgetOnsiteToken` (React prüft Effekte im Entwicklungsmodus doppelt). */
export function peekOnsiteToken() {
  return pending;
}

/** Nach dem Einlösen vergessen: Neuladen heißt dann neu scannen. */
export function forgetOnsiteToken() {
  pending = "";
}
