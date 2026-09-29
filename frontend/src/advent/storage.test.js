import { STORAGE_KEY, forgetOpened, readOpened, rememberOpened, rememberedYear } from "./storage";

// Was ein Gast geöffnet hat, merkt sich nur sein Browser - je Jahr, ohne Doppelte, ohne Unsinn.

beforeEach(() => localStorage.clear());

test("merken, lesen, vergessen", () => {
  expect(readOpened(2026)).toEqual([]);
  expect(rememberedYear()).toBeNull();
  expect(rememberOpened(2026, 5)).toEqual([5]);
  expect(rememberOpened(2026, 2)).toEqual([2, 5]);
  expect(rememberOpened(2026, "5")).toEqual([2, 5]);
  expect(readOpened(2026)).toEqual([2, 5]);
  expect(rememberedYear()).toBe(2026);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ year: 2026, days: [2, 5] });
  expect(forgetOpened(2026, 2)).toEqual([5]);
  expect(forgetOpened(2026)).toEqual([]);
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("ein anderes Jahr fängt leer an", () => {
  rememberOpened(2026, 1);
  expect(readOpened(2027)).toEqual([]);
  expect(rememberOpened(2027, 3)).toEqual([3]);
  expect(readOpened(2026)).toEqual([]);
  expect(rememberedYear()).toBe(2027);
});

test("was kein Türchen ist, wird nicht gemerkt", () => {
  for (const wrong of [0, 25, -1, 1.5, "abc", null, undefined]) expect(rememberOpened(2026, wrong)).toEqual([]);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ year: 2026, days: [3, 3, "7", 99, 0, "x", 1] }));
  expect(readOpened(2026)).toEqual([1, 3, 7]);
  localStorage.setItem(STORAGE_KEY, "kaputt{");
  expect(readOpened(2026)).toEqual([]);
  expect(rememberedYear()).toBeNull();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ year: 2026 }));
  expect(readOpened(2026)).toEqual([]);
});

test("ohne Speicher bleibt alles ruhig", () => {
  const prototype = Object.getPrototypeOf(window.localStorage);
  const setItem = vi.spyOn(prototype, "setItem").mockImplementation(() => {
    throw new Error("voll");
  });
  const getItem = vi.spyOn(prototype, "getItem").mockImplementation(() => {
    throw new Error("gesperrt");
  });
  expect(() => rememberOpened(2026, 4)).not.toThrow();
  expect(readOpened(2026)).toEqual([]);
  expect(rememberedYear()).toBeNull();
  setItem.mockRestore();
  getItem.mockRestore();
});
