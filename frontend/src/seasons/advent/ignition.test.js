import { CALM_MS, LIGHTING_MS, STORAGE_KEY, dueIgnitions, markIgnited, readLit } from "./ignition";

// Anzünden (S6, W1): nur am Sonntag der Kerze, nur einmal je Tag und Kerze, mit Speicher; ohne Speicher jedes Mal.

function memory(initial = {}) {
  const store = { ...initial };
  return { getItem: (key) => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); }, store };
}

const SUNDAYS = ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"];

test("fällig nur am Sonntag der Kerze, die brennen darf", () => {
  expect(dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 1, today: "2026-11-29" })).toEqual([0]);
  expect(dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-06" })).toEqual([1]);
  expect(dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-07" })).toEqual([]);
  expect(dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 1, today: "2026-12-06" })).toEqual([]);
  expect(dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 4, today: "2026-12-20" })).toEqual([3]);
  expect(dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 0, today: "2026-11-29" })).toEqual([]);
  expect(dueIgnitions({ year: 2026, sundays: [], candles: 2, today: "2026-12-06" })).toEqual([]);
});

test("einmal je Tag und Kerze: der Speicher merkt sich das Anzünden je Jahr", () => {
  const storage = memory();
  expect(dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-06", storage })).toEqual([1]);
  markIgnited(storage, 2026, 1, "2026-12-06");
  expect(readLit(storage)).toEqual({ 2026: { 1: "2026-12-06" } });
  expect(dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-06", storage })).toEqual([]);
  // Nächstes Jahr zählt der Eintrag nicht; ein kaputter Eintrag auch nicht.
  expect(dueIgnitions({ year: 2027, sundays: ["2027-11-28", "2027-12-05", "2027-12-12", "2027-12-19"], candles: 2, today: "2027-12-05", storage })).toEqual([1]);
  storage.store[STORAGE_KEY] = "kaputt";
  expect(readLit(storage)).toEqual({});
  expect(dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-06", storage })).toEqual([1]);
  markIgnited(null, 2026, 1, "2026-12-06");
  markIgnited({ getItem: () => null, setItem: () => { throw new Error("voll"); } }, 2026, 1, "2026-12-06");
  expect(LIGHTING_MS).toBeLessThan(CALM_MS);
});
