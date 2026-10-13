import { API_BASE_URL } from "../config";

// Eigene Adressen erkennen (#921): nur Links auf die eigene Website werden einem Screen der App zugeordnet - eine
// fremde Adresse mit zufällig gleichem Pfad (etwa start.gg/tournaments/…) ist nie ein eigenes Turnier. Gezählt
// werden die Adresse des Servers (im Entwicklungsbuild der Rechner) und die öffentliche Domain, mit und ohne www.

export const WEB_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");
const PUBLIC_HOST = "lionsquad.at";

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const OWN_HOSTS = new Set([hostOf(WEB_BASE_URL) || "", PUBLIC_HOST, `www.${PUBLIC_HOST}`].filter(Boolean));

/** Ist das eine Adresse der eigenen Website (absolut)? Relative Pfade zählen nicht - die prüft `ownPath`. */
export function isOwnUrl(url?: string | null): boolean {
  const text = String(url || "").trim();
  if (!/^https?:\/\//i.test(text)) return false;
  const host = hostOf(text);
  return Boolean(host && OWN_HOSTS.has(host));
}

// Ein Platzhalter-Ursprung, gegen den relative Pfade aufgelöst werden (#998): bleibt er gleich, ist es ein Pfad auf der
// eigenen Seite. „//host/…“, „/\host/…“, „\\host/…“ oder ein Tab zwischen den Schrägstrichen liest jeder URL-Parser als
// fremden Host - der Platzhalter ändert sich dann, und der Pfad zählt nicht.
const LOCAL_ORIGIN = "https://pfad.invalid";

/** Ist das ein Pfad ohne eigene Herkunft, der beim Auflösen auf der eigenen Seite bleibt (#998)? Ohne Schema. */
export function isLocalPath(value?: string | null): boolean {
  const text = String(value || "").trim();
  if (!text || /^[a-z][a-z0-9+.-]*:/i.test(text)) return false;
  try {
    return new URL(text, LOCAL_ORIGIN).origin === LOCAL_ORIGIN;
  } catch {
    return false;
  }
}

/** Der Pfad (mit Abfrage) auf der eigenen Website - oder null, wenn die Adresse woanders hinführt. */
export function ownPath(url?: string | null): string | null {
  const text = String(url || "").trim();
  if (!text) return null;
  // Ein relativer Pfad nur, wenn er wirklich auf der eigenen Seite bleibt - protokoll-relativ ist fremd (#998).
  if (text.startsWith("/") || text.startsWith("\\")) return text.startsWith("/") && isLocalPath(text) ? text : null;
  if (!isOwnUrl(text)) return null;
  const parsed = new URL(text);
  return `${parsed.pathname || "/"}${parsed.search}`;
}
