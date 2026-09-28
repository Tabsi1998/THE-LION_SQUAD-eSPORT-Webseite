// Rundenzeiten als Text (#613, Zielzeit je Strecke): „1:32.450“, „1:32,450“, „92.45“ oder „1:32“ → Millisekunden,
// und zurück. Leer heißt „keine Zielzeit“ (null); Unlesbares gibt NaN, damit das Formular es melden kann.

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
