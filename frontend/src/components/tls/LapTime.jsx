import { CountUp } from "@/components/tls/motion/CountUp";
import { MOTION } from "@/lib/motion";
import { formatRaceTime } from "@/lib/raceTime";

// Timing-Board (#1077): eine Rundenzeit zählt beim ersten Erscheinen der Bestenliste einmal hoch - wie auf einer
// Anzeigetafel. Gezählt wird mit dem einen Baustein CountUp (#1969); angezeigt wie überall mit Komma („1:24,587“,
// lib/raceTime), gespeichert bleibt der Text vom Server. Ohne `play`, mit „Bewegung reduzieren“ oder bei einem Text,
// der keine Zeit ist, steht der Wert sofort da.
// Neue Bestzeit (#1585): mit `from` (Millisekunden der alten Zeit) läuft die Zahl kurz von der alten zur neuen.

const LAP = /^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2})[.,](\d{1,3})$/;
export const LAP_COUNT_MS = MOTION.slow * 2;

/** „1:24.587“ → Millisekunden; auch „59.123“ und „1:02:03.456“. Sonst null. */
export function parseLap(text) {
  const match = LAP.exec(String(text ?? "").trim());
  if (!match) return null;
  const [, first, second, seconds, fraction] = match;
  const hours = second !== undefined ? Number(first || 0) : 0;
  const minutes = second !== undefined ? Number(second) : Number(first || 0);
  return ((hours * 60 + minutes) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, "0"));
}

/** Millisekunden in der Form der Vorlage: gleich viele Stellen, gleiche Trennzeichen - die Spalte bleibt ruhig. */
export function formatLapLike(ms, template) {
  const shape = LAP.exec(String(template ?? "").trim());
  if (!shape) return String(template ?? "");
  const [, first, second, seconds, fraction] = shape;
  const separator = String(template).includes(",") ? "," : ".";
  const total = Math.max(0, Math.floor(ms));
  const part = String(Math.floor((total % 1000) / 10 ** (3 - fraction.length))).padStart(fraction.length, "0");
  let rest = Math.floor(total / 1000);
  if (first === undefined && second === undefined) return `${String(rest).padStart(seconds.length, "0")}${separator}${part}`;
  const secondsText = String(rest % 60).padStart(2, "0");
  rest = Math.floor(rest / 60);
  if (second === undefined) return `${String(rest).padStart(first.length, "0")}:${secondsText}${separator}${part}`;
  const minutesText = String(rest % 60).padStart(2, "0");
  return `${String(Math.floor(rest / 60)).padStart(first.length, "0")}:${minutesText}:${secondsText}${separator}${part}`;
}

export function LapTime({ value, play = false, from = 0, duration = LAP_COUNT_MS, className = "", ...rest }) {
  const shown = formatRaceTime(value);
  const start = Number(from);
  // Die alte Zeit in der Form der neuen - CountUp zählt von dort aus.
  const startText = Number.isFinite(start) && start > 0 ? formatLapLike(start, shown) : undefined;
  // Live-Aktualisierung: die Tafel setzt eine neue Zeit selbst in Szene (useLapBoardMotion) - kein zweites Aufleuchten.
  return <CountUp value={shown} from={startText} play={play} duration={duration} flash={false} className={className} {...rest} />;
}

/** Einmal je Besuch und Schlüssel: true beim ersten Aufruf, danach false (auch nach einem Neuladen im selben Tab). */
export function firstShow(key, storage = typeof window === "undefined" ? null : window.sessionStorage) {
  try {
    if (!storage) return true;
    const name = `tls.shown.${key}`;
    if (storage.getItem(name)) return false;
    storage.setItem(name, "1");
    return true;
  } catch {
    return true;
  }
}

const introKeys = new Map();

/** Läuft für diese Liste gerade der erste Auftritt? Einmal je Besuch - und nur, solange das Hochzählen dauert:
 *  wer später dazukommt (neue Bestzeit, anderer Reiter und zurück), steht sofort da. */
export function introOnce(key, ms = LAP_COUNT_MS + 300) {
  if (!key) return false;
  if (!introKeys.has(key)) {
    const first = firstShow(key);
    introKeys.set(key, first);
    if (first && typeof window !== "undefined") window.setTimeout(() => introKeys.set(key, false), ms);
  }
  return introKeys.get(key);
}
