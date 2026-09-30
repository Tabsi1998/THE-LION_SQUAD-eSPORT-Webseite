import * as SecureStore from "expo-secure-store";
import { MAX_COUNT, MAX_OUTBOX, OUTBOX_KEY, REPLAY_DAYS, onSignal, outboxSize, pendingSignals, recordSignal, setSignalOwner, settleSignals, signalCount, viennaDay } from "./signals";

// Saison-Signale in der App (#678): dieselben Regeln wie im Web - Tag in Wien, Ausgang am Gerät, Grenzen des Servers,
// nichts Fremdes. Der sichere Speicher ist klein, also bleibt auch der Ausgang klein.

const NOW = new Date("2026-10-30T19:00:00Z");

async function outbox(): Promise<{ owner: string | null; items: Record<string, number> }> {
  return JSON.parse((await SecureStore.getItemAsync(OUTBOX_KEY)) || "{}");
}

beforeEach(async () => {
  await SecureStore.deleteItemAsync(OUTBOX_KEY);
  await SecureStore.deleteItemAsync("season_signals");
  setSignalOwner(null);
});

test("der Tag ist der Tag in Wien - ohne Zeitzonen-Daten gerechnet, auch über Mitternacht und die Zeitumstellung", () => {
  expect(viennaDay(new Date("2026-10-30T19:00:00Z"))).toBe("2026-10-30");
  // Sommerzeit bis zum letzten Sonntag im Oktober, 01:00 UTC: Mitternacht in Wien ist 22:00 UTC.
  expect(viennaDay(new Date("2026-10-24T21:59:59Z"))).toBe("2026-10-24");
  expect(viennaDay(new Date("2026-10-24T22:00:00Z"))).toBe("2026-10-25");
  // Danach Winterzeit: Mitternacht in Wien ist 23:00 UTC.
  expect(viennaDay(new Date("2026-10-25T22:59:59Z"))).toBe("2026-10-25");
  expect(viennaDay(new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-26");
  expect(viennaDay(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01");
  // Ab dem letzten Sonntag im März wieder Sommerzeit.
  expect(viennaDay(new Date("2027-03-27T22:59:59Z"))).toBe("2027-03-27");
  expect(viennaDay(new Date("2027-03-27T23:00:00Z"))).toBe("2027-03-28");
  expect(viennaDay(new Date("2027-03-28T21:59:59Z"))).toBe("2027-03-28");
  expect(viennaDay(new Date("2027-03-28T22:00:00Z"))).toBe("2027-03-29");
  // Schaltjahr.
  expect(viennaDay(new Date("2028-02-28T23:30:00Z"))).toBe("2028-02-29");
});

test("zählen: einmal am Tag oder jedes Mal; jede Zählung liegt im Ausgang und meldet sich bei den Zuhörern", async () => {
  const heard: Array<{ name: string; count: number }> = [];
  const stop = onSignal((detail) => heard.push(detail));
  expect(await recordSignal("halloween_pumpkin", { now: NOW })).toBe(true);
  expect(await recordSignal("halloween_pumpkin", { now: NOW })).toBe(false);
  expect(await recordSignal("halloween_bats_scared", { onceIf: false, now: NOW })).toBe(true);
  expect(await recordSignal("halloween_bats_scared", { onceIf: false, now: NOW })).toBe(true);
  expect(await recordSignal("", { now: NOW })).toBe(false);
  stop();
  await recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  expect(heard).toEqual([{ name: "halloween_pumpkin", count: 1 }, { name: "halloween_bats_scared", count: 1 }, { name: "halloween_bats_scared", count: 2 }]);
  expect(await signalCount("halloween_pumpkin", NOW)).toBe(1);
  expect(await signalCount("halloween_bats_scared", NOW)).toBe(3);
  expect(await outbox()).toEqual({ owner: null, items: { "halloween_pumpkin|2026-10-30": 1, "halloween_bats_scared|2026-10-30": 3 } });
  expect(await outboxSize(NOW)).toBe(4);
  // Am nächsten Tag zählt der Kürbis wieder; gemerkt werden nur heute und gestern.
  expect(await recordSignal("halloween_pumpkin", { now: new Date("2026-10-31T19:00:00Z") })).toBe(true);
  await recordSignal("halloween_bats_scared", { onceIf: false, now: new Date("2026-11-02T10:00:00Z") });
  expect(Object.keys(JSON.parse((await SecureStore.getItemAsync("season_signals")) || "{}"))).toEqual(["halloween_bats_scared:2026-11-02"]);
});

test("schnelle Tipper hintereinander überschreiben einander nicht", async () => {
  await Promise.all(Array.from({ length: 12 }, () => recordSignal("halloween_bats_scared", { onceIf: false, now: NOW })));
  expect(await signalCount("halloween_bats_scared", NOW)).toBe(12);
  expect(await outboxSize(NOW)).toBe(12);
});

test("wem was gehört: als Gast Gesammeltes übernimmt, wer sich anmeldet - eine andere Person bekommt nichts Fremdes", async () => {
  await recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  expect(await pendingSignals(null, NOW)).toEqual([]);
  expect(await pendingSignals("anna", NOW)).toEqual([{ name: "halloween_bats_scared", day: "2026-10-30", count: 1 }]);
  setSignalOwner("anna");
  await recordSignal("halloween_ghosts_freed", { onceIf: false, now: NOW });
  expect((await outbox()).owner).toBe("anna");
  expect(await pendingSignals("anna", NOW)).toEqual([
    { name: "halloween_bats_scared", day: "2026-10-30", count: 1 },
    { name: "halloween_ghosts_freed", day: "2026-10-30", count: 1 },
  ]);
  expect(await pendingSignals("ben", NOW)).toEqual([]);
  // Ben meldet sich an und sammelt: der Ausgang beginnt neu, Annas Rest ist weg - nicht bei Ben.
  setSignalOwner("ben");
  await recordSignal("halloween_cat_petted", { onceIf: false, now: NOW });
  expect(await outbox()).toEqual({ owner: "ben", items: { "halloween_cat_petted|2026-10-30": 1 } });
  expect(await pendingSignals("anna", NOW)).toEqual([]);
});

test("nach der Meldung geht nur das Gemeldete aus dem Ausgang; ist er leer, gehört er niemandem mehr", async () => {
  setSignalOwner("anna");
  for (let i = 0; i < 5; i += 1) await recordSignal("snowflakes_clicked", { onceIf: false, now: NOW });
  const sent = await pendingSignals("anna", NOW);
  await recordSignal("snowflakes_clicked", { onceIf: false, now: NOW });
  expect(await settleSignals(sent, NOW)).toBe(1);
  expect(await pendingSignals("anna", NOW)).toEqual([{ name: "snowflakes_clicked", day: "2026-10-30", count: 1 }]);
  expect(await settleSignals(await pendingSignals("anna", NOW), NOW)).toBe(0);
  expect(await outbox()).toEqual({ owner: null, items: {} });
});

test("Grenzen: zweihundert je Zeile, eine Woche zurück, nichts aus der Zukunft, nichts Kaputtes, kleiner Ausgang", async () => {
  await SecureStore.setItemAsync(OUTBOX_KEY, JSON.stringify({ owner: "anna", items: {
    "snowflakes_clicked|2026-10-30": 450,
    "halloween_bats_scared|2026-10-23": 4,
    "halloween_bats_scared|2026-10-22": 9,
    "halloween_bats_scared|2026-10-31": 2,
    "halloween_bats_scared|kaputt": 2,
    "halloween_ghosts_freed|2026-10-29": 0,
    "|2026-10-30": 1,
  } }));
  expect(await pendingSignals("anna", NOW)).toEqual([
    { name: "halloween_bats_scared", day: "2026-10-23", count: 4 },
    { name: "snowflakes_clicked", day: "2026-10-30", count: MAX_COUNT },
  ]);
  expect(REPLAY_DAYS).toBe(7);
  const full: Record<string, number> = {};
  for (let i = 0; i < MAX_OUTBOX; i += 1) full[`signal_${String(i).padStart(2, "0")}|2026-10-2${i % 2 ? 9 : 8}`] = 1;
  await SecureStore.setItemAsync(OUTBOX_KEY, JSON.stringify({ owner: null, items: full }));
  await recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  const stored = await outbox();
  expect(Object.keys(stored.items)).toHaveLength(MAX_OUTBOX);
  expect(stored.items["halloween_bats_scared|2026-10-30"]).toBe(1);
  // Klein genug für den sicheren Speicher (rund 2 kB je Eintrag).
  expect(JSON.stringify(stored).length).toBeLessThan(1800);
  await SecureStore.setItemAsync(OUTBOX_KEY, "{kaputt");
  expect(await pendingSignals("anna", NOW)).toEqual([]);
});
