import * as SecureStore from "expo-secure-store";
import { STORAGE_KEY, dueFrom, dueIgnitions, markIgnited, readLit } from "./ignition";

// Anzünden (S6, W1, S11): nur am Sonntag der Kerze, nur einmal je Tag und Kerze - gemerkt im sicheren Speicher.

const SUNDAYS = ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"];

test("fällig ist die Kerze, deren Sonntag heute ist und die brennen darf - nicht am Montag, nicht doppelt", () => {
  expect(dueFrom({}, { year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-06" })).toEqual([1]);
  expect(dueFrom({}, { year: 2026, sundays: SUNDAYS, candles: 1, today: "2026-12-06" })).toEqual([]);
  expect(dueFrom({}, { year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-07" })).toEqual([]);
  expect(dueFrom({ 2026: { 1: "2026-12-06" } }, { year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-06" })).toEqual([]);
  // Ein anderes Jahr im Speicher zählt nicht, ein alter Tag auch nicht.
  expect(dueFrom({ 2025: { 1: "2025-12-07" } }, { year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-06" })).toEqual([1]);
  expect(dueFrom({ 2026: { 1: "2026-12-05" } }, { year: 2026, sundays: SUNDAYS, candles: 2, today: "2026-12-06" })).toEqual([1]);
  expect(dueFrom({}, { year: 2026, today: "2026-12-06" })).toEqual([]);
});

test("merken und lesen über den sicheren Speicher", async () => {
  expect(await readLit()).toEqual({});
  expect(await dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 3, today: "2026-12-13" })).toEqual([2]);
  await markIgnited(2026, 2, "2026-12-13");
  expect(await dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 3, today: "2026-12-13" })).toEqual([]);
  expect(JSON.parse(String(await SecureStore.getItemAsync(STORAGE_KEY)))).toEqual({ 2026: { 2: "2026-12-13" } });
  await markIgnited(2026, 3, "2026-12-20");
  expect(await readLit()).toEqual({ 2026: { 2: "2026-12-13", 3: "2026-12-20" } });
});

test("kaputter oder fehlender Speicher stört nicht", async () => {
  await SecureStore.setItemAsync(STORAGE_KEY, "kaputt");
  expect(await readLit()).toEqual({});
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ 2026: [1, 2], 2027: { 0: 5, 1: "2027-11-28" } }));
  expect(await readLit()).toEqual({ 2027: { 1: "2027-11-28" } });
  (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error("voll"));
  await expect(markIgnited(2026, 0, "2026-11-29")).resolves.toBeUndefined();
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("gesperrt"));
  expect(await dueIgnitions({ year: 2026, sundays: SUNDAYS, candles: 1, today: "2026-11-29" })).toEqual([0]);
});
