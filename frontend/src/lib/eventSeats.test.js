import { countText, ownSeatsSentence, participantLists, placesText, seatsLabel, waitlistNotice } from "@/lib/eventSeats";

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

test("Warteliste schon im Formular: voll oder nur wegen der Begleitpersonen (#2127)", () => {
  const event = { max_participants: 10, registration_summary: { reserved_seats: 9 } };
  expect(waitlistNotice(event, 1)).toBe("");
  expect(waitlistNotice(event, 2)).toBe("Nur noch 1 Platz frei – mit 2 Plätzen kommst du auf die Warteliste.");
  expect(waitlistNotice({ max_participants: 10, registration_summary: { reserved_seats: 8 } }, 3)).toBe("Nur noch 2 Plätze frei – mit 3 Plätzen kommst du auf die Warteliste.");
  expect(waitlistNotice({ max_participants: 10, registration_summary: { reserved_seats: 10 } }, 1)).toBe("Das Event ist voll – du kommst auf die Warteliste.");
  // Ohne Platzgrenze gibt es keine Warteliste.
  expect(waitlistNotice({ registration_summary: { reserved_seats: 100 } }, 5)).toBe("");
});

test("Angemeldet und Warteliste getrennt, Stornierte stehen nicht öffentlich (#2127)", () => {
  const rows = [
    { id: "a", status: "registered" }, { id: "b", status: "checked_in" }, { id: "c", status: "waitlist" },
    { id: "d", status: "cancelled" }, { id: "e", status: "no_show" },
  ];
  const staff = participantLists({ registrations: rows });
  expect(staff.active.map((row) => row.id)).toEqual(["a", "b"]);
  expect(staff.waitlist.map((row) => row.id)).toEqual(["c"]);
  // Öffentlich liefert der Server die Warteliste getrennt.
  const open = participantLists({ registrations: [rows[0]], waitlist_registrations: [rows[2]] });
  expect(open.active.map((row) => row.id)).toEqual(["a"]);
  expect(open.waitlist.map((row) => row.id)).toEqual(["c"]);
  expect(participantLists({})).toEqual({ active: [], waitlist: [] });
});

test("Warteliste und eingecheckt", () => {
  expect(ownSeatsSentence({ status: "waitlist", seat_count: 1 })).toBe("Du stehst mit 1 Platz auf der Warteliste.");
  expect(ownSeatsSentence({ status: "waitlist", seat_count: 3, companion_count: 2 })).toBe("Du stehst mit 3 Plätzen auf der Warteliste, davon 2 Begleitpersonen.");
  expect(ownSeatsSentence({ status: "checked_in", seat_count: 2, companion_count: 1 })).toBe("Eingecheckt · 2 Plätze, davon 1 Begleitperson.");
});
