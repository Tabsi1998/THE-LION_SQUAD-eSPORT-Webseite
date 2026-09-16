import { formatVienna } from "@/lib/dashboard";

// Interne Events für den Mitgliederbereich (#283): aus der Event-Liste nur
// die, die Mitglieder oder der Vorstand sehen, und nur die, die noch
// anstehen – nach Datum sortiert.
const MEMBER_LEVELS = new Set(["members", "internal"]);

function toTime(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function memberEvents(events, now = new Date()) {
  const cutoff = now.getTime();
  return (Array.isArray(events) ? events : [])
    .filter((event) => MEMBER_LEVELS.has(event?.visibility))
    .filter((event) => {
      const start = toTime(event.start_date);
      const end = toTime(event.end_date) ?? start;
      return start === null || end === null || end >= cutoff;
    })
    .sort((a, b) => (toTime(a.start_date) ?? Infinity) - (toTime(b.start_date) ?? Infinity));
}

export function eventDateLine(event) {
  const start = formatVienna(event?.start_date);
  if (!start) return "Termin folgt";
  const end = event?.end_date ? formatVienna(event.end_date, { withTime: false }) : "";
  const startDay = formatVienna(event.start_date, { withTime: false });
  return end && end !== startDay ? `${start} – ${end}` : start;
}
