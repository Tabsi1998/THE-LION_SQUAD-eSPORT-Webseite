// Rundenzeiten als Text (#1584): derselbe Parser wie Website (frontend/src/lib/laptime.js) und Server
// (backend/services/laptime.py), geprüft mit denselben Fällen (frontend/src/lib/laptime.cases.json). Komma oder Punkt,
// m:ss.mmm oder ss.mmm, eine nackte Zahl sind Sekunden. Leer heißt keine Zeit (null), Unlesbares gibt NaN. Angezeigt
// wird mit Komma (`showLapTime`, #1969), gespeichert unverändert mit Punkt.

import { formatRaceTime } from "./raceTime";

export const DEFAULT_MIN_PLAUSIBLE_MS = 20000;
export const DEFAULT_MAX_PLAUSIBLE_MS = 600000;

export type PlausibilityTrack = { min_plausible_ms?: number | null; max_plausible_ms?: number | null } | null | undefined;

export function parseLapTime(text: string | null | undefined): number | null {
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

export function formatLapTime(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(Number(ms)) || Number(ms) < 0) return "";
  const total = Math.round(Number(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/** Zum Anzeigen (#1969): mit Komma wie im Web (`showLapTime`) und bei den Rennserien - „1:24,587“, „+0,412“. Nimmt
 *  Millisekunden oder einen Text vom Server (time_str, gap_str). Gespeichert, gesendet und verglichen wird weiter mit
 *  `formatLapTime` (Punkt). */
export function showLapTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return formatRaceTime(typeof value === "number" ? formatLapTime(value) : value);
}

export function plausibleRange(track: PlausibilityTrack): [number, number] {
  const low = track?.min_plausible_ms;
  const high = track?.max_plausible_ms;
  return [low == null ? DEFAULT_MIN_PLAUSIBLE_MS : Number(low), high == null ? DEFAULT_MAX_PLAUSIBLE_MS : Number(high)];
}

export function plausibilityWarning(ms: number, track: PlausibilityTrack): "too_fast" | "too_slow" | null {
  const [low, high] = plausibleRange(track);
  if (ms < low) return "too_fast";
  if (ms > high) return "too_slow";
  return null;
}

/** Die Rückfrage vor dem Speichern - leer, wenn die Zeit plausibel ist. */
export function plausibilityText(ms: number, track: PlausibilityTrack): string {
  const warning = plausibilityWarning(ms, track);
  if (!warning) return "";
  const [low, high] = plausibleRange(track);
  return warning === "too_fast"
    ? `${showLapTime(ms)} ist schneller als die erwartete Untergrenze ${showLapTime(low)}. Trotzdem speichern?`
    : `${showLapTime(ms)} ist langsamer als die erwartete Obergrenze ${showLapTime(high)}. Trotzdem speichern?`;
}
