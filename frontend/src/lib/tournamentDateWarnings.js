// Widersprüchliche Zeiten im Turnier-Formular (#368, #1938): Anlegen und Bearbeiten warnen unter „Planung prüfen“ gleich.
// Gespeichert wird trotzdem - die Warnung sagt nur, was nicht zusammenpasst (etwa „Check-in endet“ vor „Check-in öffnet“).

function dateFromInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Die Warnungen zu den Zeiten eines Formulars (Werte aus den Datumsfeldern). */
export function dateWarnings(form) {
  const start = dateFromInput(form?.start_date);
  const end = dateFromInput(form?.end_date);
  const registrationFrom = dateFromInput(form?.registration_open_from);
  const registrationUntil = dateFromInput(form?.registration_open_until);
  const checkinFrom = dateFromInput(form?.check_in_from);
  const checkinUntil = dateFromInput(form?.check_in_until);
  const warnings = [];
  if (start && end && end < start) warnings.push("Das Ende liegt vor dem Start.");
  if (registrationFrom && registrationUntil && registrationUntil < registrationFrom) warnings.push("Die Anmeldung endet vor ihrer Öffnung.");
  if (checkinFrom && checkinUntil && checkinUntil < checkinFrom) warnings.push("Der Check-in endet vor seiner Öffnung.");
  if (registrationUntil && start && registrationUntil > start) warnings.push("Die Anmeldung endet nach dem Turnierstart.");
  if (checkinUntil && start && checkinUntil > start) warnings.push("Der Check-in endet nach dem Turnierstart.");
  return warnings;
}
