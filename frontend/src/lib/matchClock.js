// Spielzeit-Uhr (#1167): die eine Rechnung für jede Uhr eines laufenden Spiels - Stationskacheln (#1162), Liste „läuft“
// der Turnierleitung (#1156), öffentlicher Spielplan und TV (Warteschlange #1634, Live-Spotlight #1116). Reine Rechnung:
// „jetzt“ gibt der Aufrufer, und zwar als Serverzeit (seasons/clock.serverNow mit dem Abstand aus dem Saison-Kontext),
// damit ein Handy mit falsch gehender Uhr dasselbe zeigt wie der TV. Die App (mobile/) rechnet dieselben Fälle (#2393).
import { asInstant } from "@/lib/vienna";

// Die Uhr wird knapp (Orange, Token `warn`) ab 80 % der Dauer und überschritten (Token `live`) ab 100 %.
export const CLOCK_WARN_AT = 0.8;

const pad = (value) => String(value).padStart(2, "0");

function timeOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = typeof value === "number" ? value : asInstant(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** „04:34“, „12:34“, ab einer Stunde „1:02:03“. Ohne gültige Zahl leer. */
export function clockText(seconds) {
  if (seconds === null || seconds === undefined || seconds === "" || Number.isNaN(Number(seconds))) return "";
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = pad(total % 60);
  return hours ? `${hours}:${pad(minutes)}:${rest}` : `${pad(minutes)}:${rest}`;
}

/**
 * Ganze Sekunden seit dem Start - `null` ohne (gültige) Startzeit. Eine Startzeit in der Zukunft ist 0. Pause: steht
 * `pausedAt` (die Turnierpause läuft), bleibt die Uhr dort stehen; `pausedSeconds` (frühere Pausen) zählen nicht mit.
 */
export function elapsedSeconds(startedAt, now = Date.now(), { pausedAt = null, pausedSeconds = 0 } = {}) {
  const started = timeOf(startedAt);
  if (started === null) return null;
  const paused = timeOf(pausedAt);
  const end = paused === null ? now : Math.min(now, paused);
  const pauses = Math.max(0, Number(pausedSeconds) || 0);
  return Math.max(0, Math.floor((end - started) / 1000 - pauses));
}

/**
 * Die Spielzeit-Uhr: „12:34“ gegen „30 Min.“, Anteil für den Balken, Farbe (`run`, `warn` ab 80 %, `over` ab 100 %,
 * `none` ohne Dauer) und der Zustand in Worten für Screenreader („knapp“, „Zeit überschritten“). `stepped`: der Balken
 * springt minutenweise („Bewegung reduzieren“). `pausedAt`/`pausedSeconds` wie bei `elapsedSeconds`. Ohne Start `null`.
 */
export function matchClock(startedAt, durationMinutes, now = Date.now(), { stepped = false, pausedAt = null, pausedSeconds = 0 } = {}) {
  const elapsed = elapsedSeconds(startedAt, now, { pausedAt, pausedSeconds });
  if (elapsed === null) return null;
  const paused = timeOf(pausedAt) !== null;
  const text = clockText(elapsed);
  const limit = Number(durationMinutes) > 0 ? Number(durationMinutes) : null;
  if (!limit) return { text, seconds: elapsed, limit: "", ratio: null, tone: "none", status: "", overMinutes: 0, paused };
  const exact = elapsed / (limit * 60);
  const share = (stepped ? Math.floor(elapsed / 60) * 60 : elapsed) / (limit * 60);
  const tone = exact >= 1 ? "over" : exact >= CLOCK_WARN_AT ? "warn" : "run";
  return {
    text,
    seconds: elapsed,
    limit: `${limit} Min.`,
    ratio: Math.min(1, share),
    tone,
    status: tone === "over" ? "Zeit überschritten" : tone === "warn" ? "knapp" : "",
    overMinutes: Math.max(0, Math.floor(elapsed / 60) - limit),
    paused,
  };
}

/** Was ein Screenreader sagt: „Spielzeit 24:00 von 30 Min., knapp“ - mit Pause „…, angehalten“. */
export function clockLabel(info) {
  if (!info) return "";
  const base = info.limit ? `Spielzeit ${info.text} von ${info.limit}` : `Spielzeit ${info.text}`;
  return [base, info.status, info.paused ? "angehalten" : ""].filter(Boolean).join(", ");
}
