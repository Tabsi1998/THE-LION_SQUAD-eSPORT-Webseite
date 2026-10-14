import { API_BASE_URL } from "../config";

// Eigene Adressen erkennen (#921): nur Links auf die eigene Website werden einem Screen der App zugeordnet - eine
// fremde Adresse mit zufällig gleichem Pfad (etwa start.gg/tournaments/…) ist nie ein eigenes Turnier. Gezählt
// werden die Adresse des Servers (im Entwicklungsbuild der Rechner) und die öffentliche Domain, mit und ohne www -
// jeweils als ganze Origin (Schema, Host, Port).

export const WEB_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");
const PUBLIC_HOST = "lionsquad.at";

/**
 * Die Origin einer Adresse - Schema, Host und Port (ein Standard-Port fällt weg) - oder null. Eine Adresse mit
 * Anmeldedaten („gast:geheim@…“) hat keine eigene Origin: so sieht kein Link der Website aus.
 */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

// Eigene Origins (Codex-Prüfung #1512): nicht nur der Host - https://lionsquad.at:4444 oder http://lionsquad.at ist
// eine andere Origin. Die öffentliche Domain nur mit https und Standard-Port; die Server-Adresse (im Entwicklungsbuild
// http mit Port) genau mit ihrem Schema und Port.
const OWN_ORIGINS = new Set(
  [originOf(WEB_BASE_URL) || "", `https://${PUBLIC_HOST}`, `https://www.${PUBLIC_HOST}`].filter(Boolean),
);

/** Ist das eine Adresse der eigenen Website (absolut, gleiche Origin)? Relative Pfade zählen nicht - die prüft `ownPath`. */
export function isOwnUrl(url?: string | null): boolean {
  const text = String(url || "").trim();
  if (!/^https?:\/\//i.test(text)) return false;
  const origin = originOf(text);
  return Boolean(origin && OWN_ORIGINS.has(origin));
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
