// Spielzeit-Uhr (#1167, #2393): dieselbe Rechnung wie im Web (frontend/src/lib/matchClock.js) - Stationen im Cockpit,
// Liste „läuft“ der Turnierleitung und der Turnierbaum. Reine Rechnung: „jetzt“ gibt der Aufrufer, und zwar als
// Serverzeit (`serverNow` mit dem Abstand aus der Antwort des Servers), damit ein Handy mit falsch gehender Uhr dasselbe
// zeigt wie der TV. Die Fälle in matchClock.test.ts sind dieselben wie in Vitest.
import { asInstant } from "./vienna";

// Knapp ab 80 % der Dauer (Orange, Rolle `warn`), überschritten ab 100 % (orange gefüllt mit Warn-Symbol, ebenfalls
// `warn`) - Rot bleibt allein „läuft“ (Fabians Auswahl vom 07.10.).
export const CLOCK_WARN_AT = 0.8;

export type ClockTone = "run" | "warn" | "over" | "none";

export type MatchClockInfo = {
  text: string;
  seconds: number;
  limit: string;
  ratio: number | null;
  tone: ClockTone;
  status: string;
  overMinutes: number;
  paused: boolean;
};

type Moment = string | number | Date | null | undefined;
export type ClockPause = { pausedAt?: Moment; pausedSeconds?: number | null };

const pad = (value: number) => String(value).padStart(2, "0");

function timeOf(value: Moment): number | null {
  if (value === null || value === undefined || value === "") return null;
  const time = typeof value === "number" ? value : asInstant(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Die Serverzeit jetzt (ms) aus dem Abstand zur Geräteuhr - wie `serverNow` im Web (seasons/clock.js). */
export function serverNow(offset: number | null | undefined = 0, now: number = Date.now()): number {
  return now + (Number(offset) || 0);
}

/** „04:34“, „12:34“, ab einer Stunde „1:02:03“. Ohne gültige Zahl leer. */
export function clockText(seconds: number | string | null | undefined): string {
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
export function elapsedSeconds(startedAt: Moment, now: number = Date.now(), { pausedAt = null, pausedSeconds = 0 }: ClockPause = {}): number | null {
  const started = timeOf(startedAt);
  if (started === null) return null;
  const paused = timeOf(pausedAt);
  const end = paused === null ? now : Math.min(now, paused);
  const pauses = Math.max(0, Number(pausedSeconds) || 0);
  return Math.max(0, Math.floor((end - started) / 1000 - pauses));
}

/**
 * Die Spielzeit-Uhr: „12:34“ gegen „30 Min.“, Anteil für den Balken, Farbe (`run`, `warn` ab 80 %, `over` ab 100 %,
 * `none` ohne Dauer) und der Zustand in Worten für den Vorleser („knapp“, „Zeit überschritten“). `stepped`: der Balken
 * springt minutenweise („Bewegung reduzieren“). Ohne Start `null`.
 */
export function matchClock(
  startedAt: Moment,
  durationMinutes: number | string | null | undefined,
  now: number = Date.now(),
  { stepped = false, pausedAt = null, pausedSeconds = 0 }: ClockPause & { stepped?: boolean } = {},
): MatchClockInfo | null {
  const elapsed = elapsedSeconds(startedAt, now, { pausedAt, pausedSeconds });
  if (elapsed === null) return null;
  const paused = timeOf(pausedAt) !== null;
  const text = clockText(elapsed);
  const limit = Number(durationMinutes) > 0 ? Number(durationMinutes) : null;
  if (!limit) return { text, seconds: elapsed, limit: "", ratio: null, tone: "none", status: "", overMinutes: 0, paused };
  const exact = elapsed / (limit * 60);
  const share = (stepped ? Math.floor(elapsed / 60) * 60 : elapsed) / (limit * 60);
  const tone: ClockTone = exact >= 1 ? "over" : exact >= CLOCK_WARN_AT ? "warn" : "run";
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

/** Was der Vorleser sagt: „Spielzeit 24:00 von 30 Min., knapp“ - mit Pause „…, angehalten“. */
export function clockLabel(info: MatchClockInfo | null | undefined): string {
  if (!info) return "";
  const base = info.limit ? `Spielzeit ${info.text} von ${info.limit}` : `Spielzeit ${info.text}`;
  return [base, info.status, info.paused ? "angehalten" : ""].filter(Boolean).join(", ");
}
