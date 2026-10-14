// Rundenzeiten als Text (#613, #1584): „1:32.450“, „1:32,450“, „92.45“ oder „1:32“ → Millisekunden, und zurück. Leer
// heißt „keine Zeit“ (null); Unlesbares gibt NaN, damit das Formular es melden kann. Der eine Parser für Zeiten und
// Zielzeiten - dieselben Fälle (laptime.cases.json) prüfen auch die App und der Server.

export function parseLapTime(text) {
  const raw = String(text ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const match = raw.match(/^(?:(\d{1,3}):)?(\d{1,2}|\d{1,3}(?=\.|$))(?:\.(\d{1,3}))?$/);
  if (!match) return Number.NaN;
  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2]);
  const fraction = match[3] ? Number(match[3].padEnd(3, "0")) : 0;
  if (match[1] !== undefined && seconds >= 60) return Number.NaN;
  return minutes * 60000 + seconds * 1000 + fraction;
}

export function formatLapTime(ms) {
  if (ms == null || Number.isNaN(Number(ms)) || Number(ms) < 0) return "";
  const total = Math.round(Number(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

// Plausibilität je Strecke (#1584): Standard unter 20 Sekunden oder über 10 Minuten - wie services/laptime.py.
export const DEFAULT_MIN_PLAUSIBLE_MS = 20000;
export const DEFAULT_MAX_PLAUSIBLE_MS = 600000;

export function plausibleRange(track) {
  const low = track?.min_plausible_ms;
  const high = track?.max_plausible_ms;
  return [low == null ? DEFAULT_MIN_PLAUSIBLE_MS : Number(low), high == null ? DEFAULT_MAX_PLAUSIBLE_MS : Number(high)];
}

/** "too_fast", "too_slow" oder null. */
export function plausibilityWarning(ms, track) {
  const [low, high] = plausibleRange(track);
  if (ms < low) return "too_fast";
  if (ms > high) return "too_slow";
  return null;
}

/** Die Rückfrage vor dem Speichern - leer, wenn die Zeit plausibel ist. */
export function plausibilityText(ms, track) {
  const warning = plausibilityWarning(ms, track);
  if (!warning) return "";
  const [low, high] = plausibleRange(track);
  return warning === "too_fast"
    ? `${formatLapTime(ms)} ist schneller als die erwartete Untergrenze ${formatLapTime(low)}. Trotzdem speichern?`
    : `${formatLapTime(ms)} ist langsamer als die erwartete Obergrenze ${formatLapTime(high)}. Trotzdem speichern?`;
}
