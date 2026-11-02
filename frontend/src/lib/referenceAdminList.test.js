import { filterReferences, pageOf, referenceFilterOptions, REFERENCE_PAGE_SIZE } from "./referenceAdminList";

const ITEMS = [
  { id: "a", display_title: "Herbst Cup", game_id: "g1", game: { display_name: "Rocket League" }, start_date: "2025-10-01", status: "completed", organizer: "Probe Liga", entries: [{ team_name: "Löwen Eins", lineup_members: [{ display_name: "Anni" }] }] },
  { id: "b", display_title: "Winter Open", game_id: "g2", game: { name: "Call of Duty" }, start_date: "2026-01-10", status: "active", entries: [{ lineup: ["Ben Beispiel"] }] },
  { id: "c", display_title: "Alte Liga", game_name: "Mario Kart", start_date: "2024-05-05", status: "completed", is_active: false },
  { id: "d", display_title: "Ohne Spiel", status: "planned" },
];

const ids = (rows) => rows.map((row) => row.id);

test("Suche findet Titel, Veranstalter, Spiel, Team und Personen - ohne Groß/klein", () => {
  expect(ids(filterReferences(ITEMS, { query: "herbst" }))).toEqual(["a"]);
  expect(ids(filterReferences(ITEMS, { query: "probe liga" }))).toEqual(["a"]);
  expect(ids(filterReferences(ITEMS, { query: "duty" }))).toEqual(["b"]);
  expect(ids(filterReferences(ITEMS, { query: "löwen" }))).toEqual(["a"]);
  expect(ids(filterReferences(ITEMS, { query: "anni" }))).toEqual(["a"]);
  expect(ids(filterReferences(ITEMS, { query: "ben beispiel" }))).toEqual(["b"]);
  expect(ids(filterReferences(ITEMS, { query: "gibt es nicht" }))).toEqual([]);
});

test("Filter nach Spiel, Jahr und Status, auch zusammen; „Archiviert“ meint den Schalter", () => {
  expect(ids(filterReferences(ITEMS, { game: "g1" }))).toEqual(["a"]);
  expect(ids(filterReferences(ITEMS, { game: "name:Mario Kart" }))).toEqual(["c"]);
  expect(ids(filterReferences(ITEMS, { year: "2026" }))).toEqual(["b"]);
  expect(ids(filterReferences(ITEMS, { status: "archived" }))).toEqual(["c"]);
  expect(ids(filterReferences(ITEMS, { status: "completed" }))).toEqual(["a"]);
  expect(ids(filterReferences(ITEMS, { status: "active", year: "2025" }))).toEqual([]);
  expect(ids(filterReferences(ITEMS))).toEqual(["a", "b", "c", "d"]);
});

test("die Auswahl enthält nur, was es gibt", () => {
  const options = referenceFilterOptions(ITEMS);
  expect(options.games).toEqual([["g2", "Call of Duty"], ["name:Mario Kart", "Mario Kart"], ["g1", "Rocket League"]]);
  expect(options.years).toEqual(["2026", "2025", "2024"]);
  expect(referenceFilterOptions(null)).toEqual({ games: [], years: [] });
});

test("Seiten: feste Größe, eine zu große Seitenzahl landet auf der letzten", () => {
  const many = Array.from({ length: REFERENCE_PAGE_SIZE + 3 }, (_, index) => ({ id: String(index) }));
  expect(pageOf(many, 1).rows).toHaveLength(REFERENCE_PAGE_SIZE);
  expect(pageOf(many, 1).pages).toBe(2);
  expect(ids(pageOf(many, 2).rows)).toEqual([String(REFERENCE_PAGE_SIZE), String(REFERENCE_PAGE_SIZE + 1), String(REFERENCE_PAGE_SIZE + 2)]);
  expect(pageOf(many, 9).page).toBe(2);
  expect(pageOf(many, 0).page).toBe(1);
  expect(pageOf([], 1)).toEqual({ rows: [], page: 1, pages: 1 });
});
