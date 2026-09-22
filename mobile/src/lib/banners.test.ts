import * as SecureStore from "expo-secure-store";
import { dismissKey, loadDismissed, rememberDismissed, tickerDurationMs, toneColor, visibleBanners } from "./banners";

// Laufbanner in der App (#245): nur aktive mit Text, nach Priorität; weggewischt bis zur Änderung.

const A = { id: "a", text: "Anmeldung offen", priority: 10, tone: "success" };
const B = { id: "b", text: "Server in Wartung", priority: 50, tone: "warning" };

test("sichtbar sind aktive Banner mit Text, sortiert nach Priorität, ohne die weggewischten", () => {
  expect(visibleBanners([A, B, { id: "c", text: "  ", priority: 99 }, { id: "d", text: "aus", enabled: false }], []).map((b) => b.id)).toEqual(["b", "a"]);
  expect(visibleBanners([A, B], [dismissKey(B)]).map((b) => b.id)).toEqual(["a"]);
  // Ändert sich der Text, kommt der Banner wieder.
  expect(visibleBanners([{ ...B, text: "Server wieder da" }], [dismissKey(B)]).map((b) => b.id)).toEqual(["b"]);
});

test("Laufzeit nie unter der eingestellten Zeit, länger bei langem Text; Farben je Ton", () => {
  expect(tickerDurationMs("kurz", 22)).toBe(22000);
  expect(tickerDurationMs("x".repeat(600), 22)).toBe(50000);
  expect(tickerDurationMs("kurz", 3)).toBe(8000);
  expect(toneColor("live")).toBe("#FF3B30");
  expect(toneColor("warning")).toBe("#FFD700");
  expect(toneColor(undefined)).toBe("#29B6E8");
});

test("Wegwischen bleibt im Gerätespeicher, höchstens 40 Einträge", async () => {
  const store = new Map<string, string>();
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => { store.set(key, value); });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => store.get(key) ?? null);
  expect(await loadDismissed()).toEqual([]);
  let list = await rememberDismissed([], dismissKey(A));
  list = await rememberDismissed(list, dismissKey(B));
  expect(await loadDismissed()).toEqual([dismissKey(A), dismissKey(B)]);
  for (let i = 0; i < 45; i += 1) list = await rememberDismissed(list, `x${i}:t`);
  expect(list).toHaveLength(40);
  expect(list[0]).toBe("x5:t");
});
