// Datum und Uhrzeit zum Antippen (#1139): der Terminvorschlag auf der Matchseite der App - statt Freitext
// („2026-05-19 20:00“) Tage zum Antippen und die Uhrzeit in Schritten. Gerechnet wird in Wiener Zeit (#960): ein
// Vorschlag „20:00“ meint 20:00 in Wien, auch auf einem Handy im Ausland. Reine Rechnung - testbar ohne Gerät.
import { asInstant, dayNoon, viennaDate, viennaDay } from "./vienna";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
let clockFormat: Intl.DateTimeFormat | undefined;

/** Ein Zeitpunkt als Wiener Uhr: „2026-05-19T20:00“ - ohne Wert der nächste volle Halbstunden-Schritt ab `now`. */
export function viennaWall(value?: string | Date | null, now: Date = new Date()): string {
  const instant = value ? asInstant(value) : roundUp(now);
  if (Number.isNaN(instant.getTime())) return viennaWall(null, now);
  clockFormat = clockFormat || new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of clockFormat.formatToParts(instant)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

function roundUp(now: Date): Date {
  const step = 30 * 60 * 1000;
  return new Date(Math.ceil(now.getTime() / step) * step);
}

/** Die Wiener Uhr als Zeitpunkt für den Server (ISO, UTC). */
export function wallToIso(wall: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) return null;
  const instant = asInstant(wall);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/** Tage zum Antippen ab heute (Wien): „Heute“, „Morgen“, dann „Fr 9.10.“. */
export function dayOptions(now: Date = new Date(), count = 21): Array<{ day: string; label: string }> {
  const today = viennaDay(now);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(dayNoon(today).getTime() + index * DAY_MS).toISOString().slice(0, 10);
    const noon = dayNoon(day);
    const label = index === 0 ? "Heute" : index === 1 ? "Morgen" : `${WEEKDAYS[noon.getUTCDay()]} ${viennaDate(noon, { day: "numeric", month: "numeric" })}`;
    return { day, label };
  });
}

/** Den Tag tauschen, die Uhrzeit behalten. */
export function withDay(wall: string, day: string): string {
  return `${day}T${wall.slice(11, 16) || "20:00"}`;
}

/** Die Uhrzeit um Minuten verschieben - innerhalb des Tages, in Schritten von `step` Minuten. */
export function shiftTime(wall: string, minutes: number, step = 15): string {
  const [hours, mins] = (wall.slice(11, 16) || "20:00").split(":").map(Number);
  const total = Math.round((hours * 60 + mins + minutes) / step) * step;
  const clamped = Math.min(23 * 60 + 60 - step, Math.max(0, total));
  return `${wall.slice(0, 10)}T${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}
