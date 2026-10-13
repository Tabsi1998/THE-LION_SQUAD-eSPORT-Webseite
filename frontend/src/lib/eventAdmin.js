// Eventliste in der Verwaltung (#1373): wann „Rückblick schreiben“ erscheint und wie die Sichtbarkeit heißt.
// „Vorbei“ rechnet wie der Server (backend/services/event_recap.py → is_over): beendet oder archiviert - oder der
// letzte Tag des Events (Wiener Zeit) ist vorüber. Mehrtägige Events zählen mit ihrem letzten Tag, abgesagte nie.
import { viennaDay } from "@/lib/vienna";

const ENDED_STATUSES = new Set(["completed", "results_published", "archived"]);

/** Der letzte Tag des Events in Wien als „JJJJ-MM-TT“: das Ende, sonst der letzte Programmtag, sonst der Beginn. */
export function eventLastDay(event) {
  const days = Array.isArray(event?.days) ? event.days : [];
  const lastDay = days.length ? days[days.length - 1] : null;
  return viennaDay(event?.end_date || lastDay?.end_at || event?.start_date);
}

export function eventIsOver(event, now = new Date()) {
  if (!event || event.status === "cancelled") return false;
  if (ENDED_STATUSES.has(event.status)) return true;
  const last = eventLastDay(event);
  return Boolean(last) && viennaDay(now) > last;
}

// Kurze Wörter für die Liste; der Server liefert sie mit (`short` in /events/meta). Die Liste hier ist nur der
// Ersatz, solange /events/meta noch lädt - einen Rohwert wie „PUBLIC“ zeigt die Liste nie.
const VISIBILITY_WORDS = { public: "Alle", community: "Community", members: "Mitglieder", internal: "Intern" };

export function visibilityWord(value, visibilities = []) {
  const known = (visibilities || []).find((item) => item.k === value);
  return known?.short || VISIBILITY_WORDS[value] || known?.l || "Unbekannt";
}
