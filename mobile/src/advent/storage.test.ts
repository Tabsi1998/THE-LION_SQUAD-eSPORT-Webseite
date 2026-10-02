import * as SecureStore from "expo-secure-store";
import { STORAGE_KEY, forgetOpened, readOpened, rememberOpened, remembered } from "./storage";

// Adventkalender in der App (#641, #642): was ein Gast geöffnet hat, merkt sich nur das Gerät - je Jahr, ohne
// Doppelte, und ohne dass ein kaputter oder fehlender Speicher den Kalender stört.

test("merken, lesen, vergessen", async () => {
  expect(await readOpened(2026)).toEqual([]);
  expect(await remembered()).toBeNull();
  expect(await rememberOpened(2026, 5)).toEqual([5]);
  expect(await rememberOpened(2026, 2)).toEqual([2, 5]);
  expect(await rememberOpened(2026, 5)).toEqual([2, 5]);
  expect(await remembered()).toEqual({ year: 2026, days: [2, 5] });
  expect(await forgetOpened(2026, 2)).toEqual([5]);
  expect(await readOpened(2026)).toEqual([5]);
  expect(await forgetOpened(2026)).toEqual([]);
  expect(await SecureStore.getItemAsync(STORAGE_KEY)).toBeNull();
});

test("ein anderes Jahr fängt leer an", async () => {
  await rememberOpened(2026, 3);
  expect(await readOpened(2027)).toEqual([]);
  expect(await rememberOpened(2027, 1)).toEqual([1]);
  expect(await readOpened(2026)).toEqual([]);
  expect(await remembered()).toEqual({ year: 2027, days: [1] });
});

test("was kein Türchen ist, wird nicht gemerkt", async () => {
  for (const day of [0, 25, 1.5, Number.NaN, -3]) expect(await rememberOpened(2026, day)).toEqual([]);
  expect(await SecureStore.getItemAsync(STORAGE_KEY)).toBeNull();
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ year: 2026, days: [3, "4", 99, 3, "x"] }));
  expect(await readOpened(2026)).toEqual([3, 4]);
  await SecureStore.setItemAsync(STORAGE_KEY, "kaputt");
  expect(await remembered()).toBeNull();
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ year: "heuer", days: [1] }));
  expect(await remembered()).toBeNull();
});

test("ohne Speicher bleibt alles ruhig", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("kein Speicher"));
  expect(await readOpened(2026)).toEqual([]);
  (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error("voll"));
  expect(await rememberOpened(2026, 4)).toEqual([4]);
  expect(await readOpened(2026)).toEqual([]);
});
