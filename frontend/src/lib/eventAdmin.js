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

// Absagen, Verschieben, Löschen (#2118). Was der Server dabei tut, steht in backend/services/event_changes.py.
const SCHEDULE_OR_PLACE_FIELDS = ["start_date", "end_date", "days", "location", "address", "postal_code", "city", "locations", "is_online"];

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Angemeldete (samt Eingecheckten) und Warteliste - wer bei Absage oder neuem Termin Nachricht bekommt. Die Verwaltungsliste
 * zählt alle bestehenden Anmeldungen (`active_registration_count`), auch bei ausgeschalteter Anmeldung. */
export function affectedRegistrations(event) {
  if (event?.active_registration_count != null) return Number(event.active_registration_count) || 0;
  const summary = event?.registration_summary || {};
  return Number(summary.registered_count || 0) + Number(summary.waitlist_count || 0);
}

export function cancelConfirmText(count) {
  if (!count) return "Niemand ist angemeldet. Das Event steht danach als „abgesagt“ auf der Seite.";
  return `${plural(count, "Anmeldung", "Anmeldungen")} (samt Warteliste) werden storniert und benachrichtigt, offene `
    + "Rechnungsaufträge storniert. Schon gestellte Rechnungen kommen als Prüffall in die Finanzübersicht. "
    + "Das Event steht danach als „abgesagt“ auf der Seite. Wird die Absage zurückgenommen, bleiben die Anmeldungen "
    + "storniert – die Personen müssen sich neu anmelden.";
}

/** Ob die Änderung Termin oder Ort betrifft - dann fragt die Verwaltung, ob die Angemeldeten es erfahren sollen. */
export function touchesScheduleOrPlace(patch) {
  return SCHEDULE_OR_PLACE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(patch || {}, field));
}

export function savedEventMessage(saved) {
  const cancellation = saved?.cancellation;
  if (cancellation) {
    return `Event abgesagt: ${plural(cancellation.registrations, "Anmeldung", "Anmeldungen")} storniert, `
      + `${plural(cancellation.notified, "Person", "Personen")} benachrichtigt, `
      + `${plural(cancellation.orders, "Rechnungsauftrag", "Rechnungsaufträge")} storniert.`;
  }
  if (saved?.change_notice) return `Gespeichert. ${plural(saved.change_notice.notified, "Person", "Personen")} benachrichtigt.`;
  return "Gespeichert.";
}

export function deleteConfirmText(event) {
  const count = affectedRegistrations(event);
  if (count) {
    return `„${event?.name || "Event"}“ hat noch ${plural(count, "Anmeldung", "Anmeldungen")}. Löschen geht erst danach – `
      + "bitte das Event zuerst absagen (Status „Abgesagt“): dann werden alle informiert und offene Rechnungsaufträge storniert.";
  }
  return `„${event?.name || "Event"}“ wird endgültig gelöscht – samt stornierter Anmeldungen. Turniere, Fast Laps und Alben `
    + "bleiben, sind danach aber keinem Event mehr zugeordnet. Mit Rechnungen geht Löschen nicht; dann bitte archivieren.";
}

// Kurze Wörter für die Liste; der Server liefert sie mit (`short` in /events/meta). Die Liste hier ist nur der
// Ersatz, solange /events/meta noch lädt - einen Rohwert wie „PUBLIC“ zeigt die Liste nie.
const VISIBILITY_WORDS = { public: "Alle", community: "Community", members: "Mitglieder", internal: "Intern" };

export function visibilityWord(value, visibilities = []) {
  const known = (visibilities || []).find((item) => item.k === value);
  return known?.short || VISIBILITY_WORDS[value] || known?.l || "Unbekannt";
}
