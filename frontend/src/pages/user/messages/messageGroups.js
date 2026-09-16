// Reine Logik der Unterhaltung (#254): Datum-Trenner („Heute“, „Gestern“,
// „12.09.2026“), zusammengefasste Köpfe wie in der App (#220) und das
// Zusammenführen von nachgeladenen oder neu eingetroffenen Nachrichten.
// Ohne React, damit es sich ohne Oberfläche testen lässt.

const DAY_MS = 24 * 60 * 60 * 1000;
// Nachrichten desselben Absenders innerhalb dieser Spanne teilen einen Kopf.
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

export function dayLabel(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = startOfDay(date);
  const today = startOfDay(now);
  if (day === today) return "Heute";
  if (day === today - DAY_MS) return "Gestern";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// Aus der zeitlich sortierten Liste wird eine Folge aus Tages-Trennern und
// Nachrichten; showHeader sagt, ob die Sprechblase Absender und Uhrzeit trägt.
export function buildTimeline(messages, meId, now = new Date()) {
  const items = [];
  let lastDay = null;
  let previous = null;
  for (const message of messages || []) {
    const stamp = new Date(message.created_at || 0).getTime();
    const day = Number.isNaN(stamp) ? null : startOfDay(stamp);
    if (day !== lastDay) {
      items.push({ type: "day", key: `day-${day}`, label: dayLabel(message.created_at, now) });
      lastDay = day;
      previous = null;
    }
    const previousStamp = previous ? new Date(previous.created_at || 0).getTime() : null;
    const sameSender = previous && previous.sender_id === message.sender_id;
    const closeInTime = previousStamp !== null && stamp - previousStamp <= GROUP_WINDOW_MS;
    items.push({
      type: "message",
      key: message.id,
      message,
      mine: message.sender_id === meId,
      showHeader: !(sameSender && closeInTime),
    });
    previous = message;
  }
  return items;
}

function sortByTime(rows) {
  return [...rows].sort((a, b) => {
    const at = String(a.created_at || "");
    const bt = String(b.created_at || "");
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

// Führt zwei Seiten derselben Unterhaltung zusammen: kein Duplikat, sortiert
// nach Zeit. Meldet, wie viele Nachrichten neu hinten dazukamen (für den
// Hinweis „N neue Nachrichten“) und ob vorne ältere ankamen.
export function mergeMessages(existing, incoming) {
  const known = new Map((existing || []).map((row) => [row.id, row]));
  let appended = 0;
  const lastKnownStamp = existing && existing.length ? String(existing[existing.length - 1].created_at || "") : "";
  for (const row of incoming || []) {
    if (!known.has(row.id)) {
      if (String(row.created_at || "") > lastKnownStamp || !lastKnownStamp) appended += 1;
    }
    known.set(row.id, row);
  }
  return { messages: sortByTime([...known.values()]), appended };
}
