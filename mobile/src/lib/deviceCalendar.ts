import { Linking, Platform } from "react-native";
import * as Calendar from "expo-calendar";
import { calendarWindow, googleCalendarUrl, type CalendarItem } from "./calendar";

// „In meinen Kalender“ (#216): erst beim Antippen um die Berechtigung fragen; verweigert oder
// ohne beschreibbaren Kalender öffnet sich Google Kalender mit dem vorausgefüllten Termin.

export type AddResult = { via: "device"; eventId: string } | { via: "google" } | { via: "none" };

async function writableCalendarId(): Promise<string | null> {
  const preferred = await Calendar.getDefaultCalendarAsync().catch(() => null);
  if (preferred?.id && preferred.allowsModifications !== false) return preferred.id;
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT).catch(() => []);
  const writable = calendars.filter((entry) => entry.allowsModifications !== false);
  const primary = writable.find((entry) => (entry as { isPrimary?: boolean }).isPrimary) || writable[0];
  return primary?.id || null;
}

export async function addToDeviceCalendar(item: CalendarItem): Promise<AddResult> {
  const window = calendarWindow(item);
  if (!window) return { via: "none" };
  try {
    const permission = await Calendar.requestCalendarPermissionsAsync();
    if (permission.granted) {
      const calendarId = await writableCalendarId();
      if (calendarId) {
        const eventId = await Calendar.createEventAsync(calendarId, {
          title: item.title,
          startDate: window.start,
          endDate: window.end,
          location: item.location || undefined,
          notes: [item.detail, item.url].filter(Boolean).join("\n") || undefined,
          url: Platform.OS === "ios" ? item.url || undefined : undefined,
          timeZone: "Europe/Vienna",
        });
        return { via: "device", eventId };
      }
    }
  } catch {
    // Kein Kalender-Zugriff auf diesem Gerät: unten der Weg über Google Kalender.
  }
  const url = googleCalendarUrl(item);
  if (!url) return { via: "none" };
  await Linking.openURL(url);
  return { via: "google" };
}
