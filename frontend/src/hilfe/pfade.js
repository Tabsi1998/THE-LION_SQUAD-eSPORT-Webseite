// Adressen der FAQ (#2448) - ohne Daten, damit Menü, „?“-Links und die Weiterleitung im Start-Chunk nichts von den
// Texten mitziehen. Die FAQ liegt unter /faq, eine Anleitung unter /faq/<thema>, ein Schritt unter /faq/<thema>#<schritt>
// und eine Frage unter /faq#frage-<id>. Die alte Hilfe (/hilfe, #2295) leitet hierher weiter - auch jeder Schritt-Link.

export const FAQ_PFAD = "/faq";
export const ALTER_PFAD = "/hilfe";

export function hilfePfad(slug, schrittId = "") {
  return schrittId ? `${FAQ_PFAD}/${slug}#${schrittId}` : `${FAQ_PFAD}/${slug}`;
}

export function fragePfad(id) {
  return `${FAQ_PFAD}#frage-${id}`;
}

/** Anker aus der Adresse ohne „#“, entschlüsselt. Ein kaputter Anker (z. B. #%E0%A4) zählt als keiner, statt die Seite
 * mit einem Fehler zu beenden. */
export function ankerAus(hash = "") {
  try {
    return decodeURIComponent(String(hash || "").replace(/^#/, ""));
  } catch {
    return "";
  }
}

/**
 * Wohin eine alte Hilfe-Adresse führt: /hilfe → /faq, /hilfe/<thema> → /faq/<thema>; Suche (?q=) und Anker (#schritt)
 * bleiben stehen. Für alles andere null. Dieselbe Regel steht in frontend/nginx.conf (301 für Suchmaschinen).
 */
export function hilfeUmleitung(pathname = "", search = "", hash = "") {
  const path = String(pathname || "").replace(/\/+$/, "");
  if (path.toLowerCase() === ALTER_PFAD) return `${FAQ_PFAD}${search}${hash}`;
  const match = path.match(/^\/hilfe\/([^/]+)$/i);
  if (!match) return null;
  return `${FAQ_PFAD}/${match[1].toLowerCase()}${search}${hash}`;
}
