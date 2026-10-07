import { countText, ownSeatsSentence, placesText, seatsLabel } from "@/lib/eventSeats";

// Einzahl und Mehrzahl (#1223): 1, 2 und 3 Plätze mit und ohne Begleitung - kein „Platz/Plätze“, kein „davon 0“.

test("Plätze und Zähler in Einzahl und Mehrzahl", () => {
  expect(placesText(1)).toBe("1 Platz");
  expect(placesText(2)).toBe("2 Plätze");
  expect(placesText(0)).toBe("1 Platz");
  expect(countText(1, "Anmeldung", "Anmeldungen")).toBe("1 Anmeldung");
  expect(countText(4, "Anmeldung", "Anmeldungen")).toBe("4 Anmeldungen");
  expect(seatsLabel({ seat_count: 3 })).toBe("3 Plätze");
  expect(seatsLabel({ companion_count: 1 })).toBe("2 Plätze");
});

test("eigene Anmeldung: reserviert mit und ohne Begleitung", () => {
  expect(ownSeatsSentence({ status: "registered", seat_count: 1, companion_count: 0 })).toBe("1 Platz reserviert.");
  expect(ownSeatsSentence({ status: "registered", seat_count: 2, companion_count: 1 })).toBe("2 Plätze reserviert, davon 1 Begleitperson.");
  expect(ownSeatsSentence({ status: "registered", seat_count: 3, companion_count: 2 })).toBe("3 Plätze reserviert, davon 2 Begleitpersonen.");
});

test("Warteliste und eingecheckt", () => {
  expect(ownSeatsSentence({ status: "waitlist", seat_count: 1 })).toBe("Du stehst mit 1 Platz auf der Warteliste.");
  expect(ownSeatsSentence({ status: "waitlist", seat_count: 3, companion_count: 2 })).toBe("Du stehst mit 3 Plätzen auf der Warteliste, davon 2 Begleitpersonen.");
  expect(ownSeatsSentence({ status: "checked_in", seat_count: 2, companion_count: 1 })).toBe("Eingecheckt · 2 Plätze, davon 1 Begleitperson.");
});
