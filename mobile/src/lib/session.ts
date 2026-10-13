// Sitzung beim App-Start (#942): ein Weg statt zwei. Das Zugangs-Token verrät selbst, ob es noch gilt - dann braucht
// der Start keinen Probeaufruf, der bei abgelaufenem Token erst scheitert und eine zweite Erneuerung auslöst. Und ein
// Netzfehler ist keine abgelehnte Sitzung: offline bleibt die Sitzung samt gemerktem Konto bestehen.

/** Ablauf aus dem JWT lesen (Sekunden seit 1970) - null, wenn das Token keins ist. */
export function tokenExpiry(token: string | null | undefined): number | null {
  return tokenClaim(token, "exp");
}

function tokenClaim(token: string | null | undefined, name: "exp" | "iat"): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const value = (JSON.parse(decodeBase64(padded)) as Record<string, unknown>)[name];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Laufzeit des Tokens in Sekunden (exp - iat, #1519) - unabhängig von jeder Uhr; null ohne beide Angaben. */
export function tokenLifetime(token: string | null | undefined): number | null {
  const exp = tokenClaim(token, "exp");
  const iat = tokenClaim(token, "iat");
  return exp !== null && iat !== null && exp > iat ? exp - iat : null;
}

/**
 * Gilt das Zugangs-Token noch mindestens `marginSeconds`? Mit dem Zeitpunkt des Erhalts (`receivedAt`, Geräteuhr) und
 * der Laufzeit aus dem Token rechnet die App ab Erhalt (#1519) - eine vor- oder nachgehende Geräteuhr verschiebt das
 * Ende dann nicht. Wurde die Uhr seit dem Erhalt zurückgestellt, lieber einmal erneuern. Ohne diese Angaben (ältere
 * Tokens) wie bisher gegen `exp`; ohne lesbaren Ablauf gilt es als abgelaufen.
 */
export function accessTokenExpired(
  token: string | null | undefined,
  now: number = Date.now(),
  marginSeconds = 30,
  receivedAt: number | null = null,
): boolean {
  const lifetime = tokenLifetime(token);
  if (lifetime !== null && receivedAt !== null && Number.isFinite(receivedAt)) {
    if (now < receivedAt) return true;
    return receivedAt + lifetime * 1000 <= now + marginSeconds * 1000;
  }
  const exp = tokenExpiry(token);
  if (exp === null) return true;
  return exp * 1000 <= now + marginSeconds * 1000;
}

/** Netz weg, Zeitüberschreitung, Server nicht erreichbar - alles, was keine Antwort des Servers ist. */
export function isNetworkError(error: unknown): boolean {
  const raised = error as { response?: unknown; code?: string; message?: string } | null;
  if (!raised || typeof raised !== "object") return false;
  if (raised.response) return false;
  const code = String(raised.code || "");
  const message = String(raised.message || "");
  return code === "ERR_NETWORK" || code === "ECONNABORTED" || code === "ETIMEDOUT" || /network error|timeout/i.test(message);
}

/** Antwort des Servers, die die Sitzung wirklich beendet - nur 401 (abgelehnt) und 403 (gesperrt/deaktiviert). */
export function isSessionRejected(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 401 || status === 403;
}

function decodeBase64(value: string): string {
  if (typeof globalThis.atob === "function") return decodeURIComponent(escape(globalThis.atob(value)));
  // Hermes ohne atob: von Hand.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bits = "";
  for (const char of value.replace(/=+$/, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("kein Base64");
    bits += index.toString(2).padStart(6, "0");
  }
  let out = "";
  for (let i = 0; i + 8 <= bits.length; i += 8) out += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
  return decodeURIComponent(escape(out));
}
