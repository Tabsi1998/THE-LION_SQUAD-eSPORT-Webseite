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

export function normalizeAnalyticsPayload(source = {}) {
  const payload = { ...source };
  payload.google_analytics_id = normalizeGoogleMeasurementId(payload.google_analytics_id);
  payload.plausible_domain = normalizePlausibleDomain(payload.plausible_domain);
  return payload;
}
