import { changeText, companionsText, counterText, filterRows, leadCounts, matchesSearch, messagePreview, seatsText } from "./eventLead";

// Anmeldungen & Einlass (#1372): Suche, Filter, Zähler und Vorschau der Nachricht. Namen sind erfunden.

const ROWS = [
  { id: "r1", display_name: "Max Mustermann", status: "checked_in", seat_count: 1, companion_count: 0 },
  { id: "r2", display_name: "Paula Brünner", status: "registered", seat_count: 2, companion_count: 1 },
  { id: "r3", display_name: "Zoë Adler", status: "registered", seat_count: 1, companion_count: 0 },
  { id: "r4", display_name: "Ella Wartend", status: "waitlist", seat_count: 1, companion_count: 0 },
  { id: "r5", display_name: "Otto Storno", status: "cancelled", seat_count: 1, companion_count: 0 },
];

test("Filter „noch nicht da“, „da“, „Warteliste“ und „alle“", () => {
  expect(filterRows(ROWS, "open").map((row) => row.id)).toEqual(["r2", "r3"]);
  expect(filterRows(ROWS, "here").map((row) => row.id)).toEqual(["r1"]);
  expect(filterRows(ROWS, "waitlist").map((row) => row.id)).toEqual(["r4"]);
  expect(filterRows(ROWS, "all")).toHaveLength(5);
});

test("Suche: Groß/klein, Umlaute, Teile und mehrere Wörter", () => {
  expect(matchesSearch(ROWS[1], "brun")).toBe(true);
  expect(matchesSearch(ROWS[2], "ZOE")).toBe(true);
  expect(matchesSearch(ROWS[1], "paula br")).toBe(true);
  expect(matchesSearch(ROWS[1], "paula x")).toBe(false);
  expect(matchesSearch(ROWS[0], "")).toBe(true);
  expect(filterRows(ROWS, "open", "zo").map((row) => row.id)).toEqual(["r3"]);
  expect(filterRows(ROWS, "here", "paula")).toEqual([]);
});

test("Zähler „1 von 3 da“ - Plätze mit Begleitpersonen nur, wenn sie abweichen", () => {
  const counts = leadCounts(ROWS);
  expect(counts).toMatchObject({ open: 2, here: 1, waitlist: 1, all: 5, expected: 3, expected_seats: 4, here_seats: 1 });
  expect(counterText(counts)).toBe("1 von 3 da");
  expect(seatsText(counts)).toBe("1 von 4 Plätzen mit Begleitpersonen");
  expect(seatsText(leadCounts(ROWS.filter((row) => row.id !== "r2")))).toBe("");
  // Nach dem Einchecken stimmt der Zähler sofort.
  const after = ROWS.map((row) => (row.id === "r3" ? { ...row, status: "checked_in" } : row));
  expect(counterText(leadCounts(after))).toBe("2 von 3 da");
});

test("Begleitpersonen, Vorschau der Nachricht und Rückmeldung", () => {
  expect(companionsText(ROWS[1])).toBe("+1 Begleitperson");
  expect(companionsText({ companion_count: 2 })).toBe("+2 Begleitpersonen");
  expect(companionsText(ROWS[0])).toBe("");
  expect(messagePreview(42)).toMatch(/^Geht an 42 Angemeldete – je Person einmal/);
  expect(messagePreview(1)).toMatch(/^Geht an 1 angemeldete Person/);
  expect(messagePreview(0)).toBe("Für dieses Event ist niemand angemeldet.");
  expect(changeText(ROWS[1], "checked_in")).toBe("Paula Brünner ist da.");
  expect(changeText(ROWS[3], "registered")).toBe("Ella Wartend ist nachgerückt.");
  expect(changeText(ROWS[0], "registered")).toBe("Max Mustermann ist wieder „noch nicht da“.");
});
