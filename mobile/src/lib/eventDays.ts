import type { CalendarItem } from "./calendar";
import type { ClubEvent } from "../types";

// Mehrtägige Events (#884): dieselben Sätze wie im Web - der Server liefert sie fertig (`schedule`), damit
// Website, App und Discord dasselbe sagen.

export function scheduleLine(schedule: ClubEvent["schedule"] | undefined, withNow = true): string {
  if (!schedule?.multi_day) return "";
  const now = withNow && (schedule.now?.state === "running" || schedule.now?.state === "break") ? schedule.now.text : "";
  return [schedule.label, now].filter(Boolean).join(" · ");
}

// Ein Kalendereintrag je Tag - „Name – Tag 2/3 · Finaltag“ mit den Zeiten des Tages.
export function eventDayItems(event: ClubEvent): CalendarItem[] | null {
  const schedule = event.schedule;
  if (!schedule?.multi_day || !schedule.days?.length) return null;
  const name = event.title || event.name || "Event";
  return schedule.days.map((day) => ({
    id: `${event.id}-tag-${day.index}`,
    kind: "event",
    title: `${name} – Tag ${day.index}/${schedule.count}${day.title ? ` · ${day.title}` : ""}`,
    start: day.start_at,
    end: day.end_at,
    location: day.location_name || [event.location, event.city].filter(Boolean).join(", ") || null,
    detail: event.event_type || null,
    url: event.slug ? `https://lionsquad.at/events/${event.slug}` : null,
  }));
}
