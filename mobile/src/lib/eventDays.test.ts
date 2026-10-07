import { eventDayItems, scheduleLine } from "./eventDays";
import type { ClubEvent, EventSchedule } from "../types";

// Mehrtägige Events (#884): die Zeile für Karten und der Kalendereintrag je Tag.

const schedule: EventSchedule = {
  multi_day: true,
  count: 2,
  label: "2 Tage · Fr 16.10. – Sa 17.10.",
  range_label: "Fr 16.10. – Sa 17.10.",
  next_at: "2026-10-17T08:00:00+00:00",
  now: { state: "break", day_index: 2, text: "Tag 2 beginnt morgen um 10:00" },
  days: [
    { index: 1, date: "2026-10-16", label: "Fr 16.10.", time_label: "18:00–23:00", start: "18:00", end: "23:00", door: "17:00", title: "Warm-up", start_at: "2026-10-16T16:00:00+00:00", end_at: "2026-10-16T21:00:00+00:00", state: "past" },
    { index: 2, date: "2026-10-17", label: "Sa 17.10.", time_label: "10:00–16:00", start: "10:00", end: "16:00", location_name: "Vereinsheim", start_at: "2026-10-17T08:00:00+00:00", end_at: "2026-10-17T14:00:00+00:00", state: "next" },
  ],
};

const event: ClubEvent = { id: "e1", slug: "lan", title: "LAN-Wochenende", location: "Vereinsheim", city: "Telfs", event_type: "lan", schedule };

test("Zeile: Zeitraum und, wenn es läuft oder pausiert, der Satz zum Jetzt", () => {
  expect(scheduleLine(schedule)).toBe("2 Tage · Fr 16.10. – Sa 17.10. · Tag 2 beginnt morgen um 10:00");
  expect(scheduleLine({ ...schedule, now: { state: "before", text: "Beginnt am Fr 16.10. um 18:00" } })).toBe("2 Tage · Fr 16.10. – Sa 17.10.");
  expect(scheduleLine(schedule, false)).toBe("2 Tage · Fr 16.10. – Sa 17.10.");
  expect(scheduleLine(null)).toBe("");
  expect(scheduleLine({ ...schedule, multi_day: false })).toBe("");
});

test("Kalender: ein Eintrag je Tag mit Tageszeiten, Titel und Ort des Tages", () => {
  const items = eventDayItems(event)!;
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({ id: "e1-tag-1", kind: "event", title: "LAN-Wochenende – Tag 1/2 · Warm-up", start: "2026-10-16T16:00:00+00:00", end: "2026-10-16T21:00:00+00:00", location: "Vereinsheim, Telfs", url: "https://lionsquad.at/events/lan" });
  expect(items[1].title).toBe("LAN-Wochenende – Tag 2/2");
  expect(items[1].location).toBe("Vereinsheim");
  expect(eventDayItems({ id: "e2", title: "Stammtisch" })).toBeNull();
});
