import { formatWhen, fromDateTimeLocal, toDateTimeLocalInput } from "@/lib/datetime";

// Mindestanzahl bis zu einer Frist (#2614): die Rechnung ohne React - für Event-Seite und Verwaltung. Den Stand rechnet der
// Server (`event.minimum`, services/event_minimum.py); hier stehen nur die Wörter und das Formular.

/** Grund der Absage: so lang muss er mindestens sein (Server: event_minimum.REASON_MIN). */
export const MIN_REASON = 5;

/** „Person“/„Personen“, wenn Begleitpersonen mitzählen, sonst „Anmeldung“/„Anmeldungen“. */
export function minimumUnit(countCompanions, count) {
  if (countCompanions) return count === 1 ? "Person" : "Personen";
  return count === 1 ? "Anmeldung" : "Anmeldungen";
}

/**
 * Die Zeile im Fakten-Kasten der Event-Seite: „Findet ab 8 Anmeldungen statt“ und darunter „Noch 3 bis Fr 18. Dezember · 18:00“.
 * Keine Zeile ohne Mindestzahl und bei einem abgesagten oder vergangenen Event.
 */
export function minimumFact(event, { now = new Date(), over = false } = {}) {
  const minimum = event?.minimum;
  if (!minimum || over || event.status === "cancelled") return null;
  const title = `Findet ab ${minimum.count} ${minimumUnit(minimum.count_companions, minimum.count)} statt`;
  let line;
  if (minimum.state === "reached") line = "Mindestzahl erreicht.";
  else if (minimum.state === "short") line = "Bis zur Frist nicht erreicht – der Verein entscheidet, ob das Event stattfindet.";
  else line = `Noch ${minimum.missing} bis ${formatWhen(minimum.deadline, { now })}`;
  return { key: "minimum", label: "Mindestzahl", title, lines: [line] };
}

/** Das Schild in der Verwaltung: [Art, Wort] - nie „live“; fehlt etwas nach der Frist, ist es ein Problem. */
export function minimumChip(minimum) {
  if (minimum?.state === "reached") return { kind: "joined", variant: "quiet", label: "Erreicht" };
  if (minimum?.state === "short") return { kind: "problem", label: "Zu wenige" };
  return { kind: "waiting", label: "Noch offen" };
}

/** Der Stand in einem Satz für die Verwaltung: „5 von 8 Personen (davon 2 Begleitpersonen) · Frist Fr 18. Dezember · 18:00“. */
export function minimumSummary(minimum, { now = new Date() } = {}) {
  if (!minimum) return "";
  const companions = minimum.count_companions && minimum.companions
    ? ` (davon ${minimum.companions} ${minimum.companions === 1 ? "Begleitperson" : "Begleitpersonen"})` : "";
  const deadline = formatWhen(minimum.deadline, { now });
  return `${minimum.have} von ${minimum.count} ${minimumUnit(minimum.count_companions, minimum.count)}${companions} · `
    + `${minimum.deadline_passed ? "Frist war" : "Frist"} ${deadline}`;
}

/** Das Formular aus der gespeicherten Einstellung. */
export function minimumToForm(settings) {
  return {
    enabled: Boolean(settings?.count),
    count: settings?.count ? String(settings.count) : "",
    deadline: toDateTimeLocalInput(settings?.deadline),
    count_companions: settings?.count_companions !== false,
    public: settings?.public !== false,
  };
}

/** Was der Server bekommt - `null` heißt: keine Mindestzahl. */
export function formToMinimum(form) {
  if (!form?.enabled) return null;
  return {
    count: Number.parseInt(form.count, 10),
    deadline: fromDateTimeLocal(form.deadline),
    count_companions: Boolean(form.count_companions),
    public: Boolean(form.public),
  };
}

/** Warum das Formular noch nicht passt - leer heißt: passt. Dieselben Regeln prüft der Server. */
export function minimumFormError(form, { startDate = "", maxParticipants = "" } = {}) {
  if (!form?.enabled) return "";
  const count = Number(form.count);
  if (!Number.isInteger(count) || count < 1) return "Mindestanzahl: Bitte eine Zahl ab 1 eintragen.";
  if (!form.deadline || !fromDateTimeLocal(form.deadline)) return "Mindestanzahl: Bitte eine Frist eintragen.";
  if (startDate && fromDateTimeLocal(startDate) && new Date(form.deadline) > new Date(startDate)) {
    return "Mindestanzahl: Die Frist muss vor dem Beginn des Events liegen.";
  }
  const seats = Number(maxParticipants);
  if (seats && count > seats) return `Mindestanzahl: ${count} ist mehr als die Plätze (${seats}) – so würde sie nie erreicht.`;
  return "";
}

/** Prüfung für das Feld „Grund“ im Absage-Dialog. */
export function reasonProblem(value) {
  return String(value || "").trim().length < MIN_REASON ? `Bitte einen Grund angeben (mindestens ${MIN_REASON} Zeichen).` : "";
}
