// „Zum Kalender hinzufügen“ im Web (#216, #580): Google Kalender, Outlook und die ICS - vom Server
// je Event und Turnier (mit Erinnerung), sonst im Browser gebaut. Dieselbe Rechnung wie in der App
// (mobile/src/lib/calendar.ts). Ohne Ende zwei Stunden.

function parseIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (match) => `\\${match}`);
}

export function calendarWindow(item) {
  const start = parseIso(item?.start);
  if (!start) return null;
  const end = parseIso(item?.end);
  return { start, end: end && end.getTime() > start.getTime() ? end : new Date(start.getTime() + 2 * 60 * 60 * 1000) };
}

export function icsFor(item, now = new Date()) {
  const window = calendarWindow(item);
  if (!window) return "";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//THE LION SQUAD//Website//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${item.kind || "event"}-${item.id}@lionsquad.at`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(window.start)}`,
    `DTEND:${stamp(window.end)}`,
    `SUMMARY:${icsText(item.title || "")}`,
  ];
  if (item.detail) lines.push(`DESCRIPTION:${icsText(item.detail)}`);
  if (item.location) lines.push(`LOCATION:${icsText(item.location)}`);
  if (item.url) lines.push(`URL:${item.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function googleCalendarUrl(item) {
  const window = calendarWindow(item);
  if (!window) return "";
  const params = new URLSearchParams({ action: "TEMPLATE", text: item.title || "", dates: `${stamp(window.start)}/${stamp(window.end)}` });
  const details = [item.detail, item.url].filter(Boolean).join("\n");
  if (details) params.set("details", details);
  if (item.location) params.set("location", item.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(item) {
  const window = calendarWindow(item);
  if (!window) return "";
  const params = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: item.title || "", startdt: window.start.toISOString(), enddt: window.end.toISOString() });
  const body = [item.detail, item.url].filter(Boolean).join("\n");
  if (body) params.set("body", body);
  if (item.location) params.set("location", item.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** Die ICS vom Server (#580) - nur für Events und Turniere mit Kennung; sonst leer. */
export function serverIcsPath(item) {
  const key = item?.slug || item?.id;
  if (!key || !["event", "tournament"].includes(item?.kind)) return "";
  return `/api/calendar/${item.kind === "event" ? "events" : "tournaments"}/${encodeURIComponent(key)}.ics`;
}

export function icsFileName(item) {
  const base = String(item?.title || "termin").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "termin"}.ics`;
}

/** Lädt die .ics herunter - im Browser über einen kurzlebigen Blob-Link. */
export function downloadIcs(item, doc = typeof document !== "undefined" ? document : null) {
  const text = icsFor(item);
  if (!text || !doc) return false;
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = icsFileName(item);
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
