import * as SecureStore from "expo-secure-store";
import { claimLevelUp, withKeyLock } from "./levelSeen";

// Codex-Prüfung zu #1502: zwei Prüfungen auf demselben Gerät zeigen denselben Aufstieg nur einmal.

test("zwei gleichzeitige Prüfungen: nur eine bekommt den Aufstieg, der neue Stand ist gemerkt", async () => {
  await SecureStore.setItemAsync("tls_level_seen_u1", JSON.stringify({ level: 24, title: "Silbermähne", prestige: 0 }));
  const next = { level: 25, title: "Goldmähne", prestige: 0 };
  const results = await Promise.all([claimLevelUp("tls_level_seen_u1", next), claimLevelUp("tls_level_seen_u1", next)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(JSON.parse((await SecureStore.getItemAsync("tls_level_seen_u1")) || "null")).toEqual(next);
});

test("ist das Konto nicht mehr angemeldet, bleibt der Merker unberührt", async () => {
  await SecureStore.setItemAsync("tls_level_seen_u2", JSON.stringify({ level: 3, title: "", prestige: 0 }));
  expect(await claimLevelUp("tls_level_seen_u2", { level: 9, title: "", prestige: 0 }, () => false)).toBeNull();
  expect(JSON.parse((await SecureStore.getItemAsync("tls_level_seen_u2")) || "null")).toMatchObject({ level: 3 });
});

test("die Sperre lässt Aufrufe je Schlüssel nacheinander laufen, auch nach einem Fehler", async () => {
  const order: string[] = [];
  const slow = withKeyLock("k", async () => { await new Promise((resolve) => setTimeout(resolve, 10)); order.push("a"); });
  const failing = withKeyLock("k", async () => { order.push("b"); throw new Error("kaputt"); });
  const last = withKeyLock("k", async () => { order.push("c"); });
  await Promise.allSettled([slow, failing, last]);
  expect(order).toEqual(["a", "b", "c"]);
});
