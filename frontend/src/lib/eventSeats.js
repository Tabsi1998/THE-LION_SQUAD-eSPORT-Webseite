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

/** Plätze einer Anmeldung in der Teilnehmerliste: „1 Platz“, „2 Plätze“. */
export function seatsLabel(registration) {
  return placesText(seatsOf(registration));
}
