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

/** Der Pfad (mit Abfrage) auf der eigenen Website - oder null, wenn die Adresse woanders hinführt. */
export function ownPath(url?: string | null): string | null {
  const text = String(url || "").trim();
  if (!text) return null;
  if (text.startsWith("/")) return text.startsWith("//") ? null : text;
  if (!isOwnUrl(text)) return null;
  const parsed = new URL(text);
  return `${parsed.pathname || "/"}${parsed.search}`;
}
