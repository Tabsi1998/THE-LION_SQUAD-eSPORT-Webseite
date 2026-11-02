// Einzahl und Mehrzahl an der Event-Anmeldung (#1223): „1 Platz“, „2 Plätze, davon 1 Begleitperson“,
// „3 Plätze, davon 2 Begleitpersonen“ - ohne Begleitung kein „davon 0“, nie mehr „Platz/Plätze“ oder „Person(en)“.

/** „1 Anmeldung“, „3 Anmeldungen“. */
export function countText(count, one, many) {
  const value = Math.max(0, Number(count) || 0);
  return `${value} ${value === 1 ? one : many}`;
}

/** „1 Platz“, „2 Plätze“ - mindestens ein Platz. */
export function placesText(count) {
  return countText(Math.max(1, Number(count) || 1), "Platz", "Plätze");
}

function companionsOf(registration) {
  return Math.max(0, Number(registration?.companion_count) || 0);
}

function seatsOf(registration) {
  return Math.max(1, Number(registration?.seat_count) || 1 + companionsOf(registration));
}

/** „, davon 1 Begleitperson“ - ohne Begleitung leer. */
function companionsPart(registration) {
  const companions = companionsOf(registration);
  return companions ? `, davon ${countText(companions, "Begleitperson", "Begleitpersonen")}` : "";
}

/** Der Satz zur eigenen Anmeldung: reserviert, auf der Warteliste oder eingecheckt. */
export function ownSeatsSentence(registration) {
  const places = placesText(seatsOf(registration));
  // „mit 3 Plätzen“ - nach „mit“ steht die Mehrzahl im Dativ.
  if (registration?.status === "waitlist") return `Du stehst mit ${countText(seatsOf(registration), "Platz", "Plätzen")} auf der Warteliste${companionsPart(registration)}.`;
  if (registration?.status === "checked_in") return `Eingecheckt · ${places}${companionsPart(registration)}.`;
  return `${places} reserviert${companionsPart(registration)}.`;
}

/**
 * Kommt die Anmeldung auf die Warteliste (#2127, EV7)? Dieselbe Rechnung wie der Server: reservierte Plätze plus die
 * eigenen über der Grenze - auch wenn es nur an den Begleitpersonen liegt. Der Satz fürs Formular, sonst leer.
 */
export function waitlistNotice(event, seats) {
  const max = Number(event?.max_participants) || 0;
  if (!max) return "";
  const free = Math.max(max - (Number(event?.registration_summary?.reserved_seats) || 0), 0);
  const wanted = Math.max(1, Number(seats) || 1);
  if (wanted <= free) return "";
  if (!free) return "Das Event ist voll – du kommst auf die Warteliste.";
  return `Nur noch ${placesText(free)} frei – mit ${countText(wanted, "Platz", "Plätzen")} kommst du auf die Warteliste.`;
}

/**
 * Wer öffentlich als angemeldet steht (#2127, EV10): nur Angemeldete und Eingecheckte, die Warteliste getrennt. Die
 * Verwaltung bekommt alle Stände in einer Liste - Stornierte gehören nicht hierher, die stehen auf der Leitungsseite.
 */
export function participantLists(event) {
  const rows = event?.registrations || [];
  return {
    active: rows.filter((row) => !row.status || row.status === "registered" || row.status === "checked_in"),
    waitlist: [...rows.filter((row) => row.status === "waitlist"), ...(event?.waitlist_registrations || [])],
  };
}

/** Plätze einer Anmeldung in der Teilnehmerliste: „1 Platz“, „2 Plätze“. */
export function seatsLabel(registration) {
  return placesText(seatsOf(registration));
}
