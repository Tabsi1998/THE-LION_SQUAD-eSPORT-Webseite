export const GOOGLE_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,}$/;

export function normalizeGoogleMeasurementId(value) {
  return String(value || "").trim().toUpperCase();
}

export function isGoogleMeasurementId(value) {
  return GOOGLE_MEASUREMENT_ID_PATTERN.test(normalizeGoogleMeasurementId(value));
}

export function normalizePlausibleDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

// Schlüssel in Links (#1110): Anzeige-Schlüssel der TV-Links (`key`), Speziallinks (`access`) und Vorschau-Tokens
// gehen nie an eine Statistik - sie würden dort jedem zeigen, wie man den Link öffnet.
const SECRET_PARAMS = ["key", "access", "preview", "token"];

/** Die Adresse ohne Schlüssel - für Seitenaufrufe in Google Analytics und Plausible. */
export function withoutSecretParams(url) {
  const text = String(url || "");
  try {
    const parsed = new URL(text, "http://placeholder.invalid");
    let changed = false;
    for (const name of SECRET_PARAMS) {
      if (parsed.searchParams.has(name)) {
        parsed.searchParams.delete(name);
        changed = true;
      }
    }
    if (!changed) return text;
    const query = parsed.searchParams.toString();
    const rest = `${parsed.pathname}${query ? `?${query}` : ""}${parsed.hash}`;
    return /^[a-z][a-z0-9+.-]*:/i.test(text) ? `${parsed.origin}${rest}` : rest;
  } catch {
    return text.split("?")[0];
  }
}

export function normalizeAnalyticsPayload(source = {}) {
  const payload = { ...source };
  payload.google_analytics_id = normalizeGoogleMeasurementId(payload.google_analytics_id);
  payload.plausible_domain = normalizePlausibleDomain(payload.plausible_domain);
  return payload;
}
