import { MAX_COUNT, MAX_ITEMS, MAX_OUTBOX, OUTBOX_KEY, REPLAY_DAYS, outboxSize, pendingSignals, recordSignal, setSignalOwner, settleSignals, signalCount, viennaDay } from "./signals";

// Saison-Signale (#616, #678): der Browser zählt je Tag in Wien, legt jede Zählung in den Ausgang, gibt einer Person
// nur ihre eigenen und die ohne Anmeldung gesammelten Zählungen, hält sich an die Grenzen des Servers und wirft weg,
// was älter als eine Woche ist.

const NOW = new Date("2026-10-30T19:00:00Z");

function outbox() {
  return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "{}");
}

beforeEach(() => {
  localStorage.clear();
  setSignalOwner(null);
});

test("der Tag ist der Tag in Wien - auch kurz nach Mitternacht und über die Zeitumstellung", () => {
  expect(viennaDay(new Date("2026-10-30T19:00:00Z"))).toBe("2026-10-30");
  expect(viennaDay(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
  expect(viennaDay(new Date("2026-10-25T22:59:00Z"))).toBe("2026-10-25");
  expect(viennaDay(new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-26");
  expect(viennaDay(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01");
  expect(viennaDay(new Date("2027-03-28T21:59:00Z"))).toBe("2027-03-28");
  expect(viennaDay(new Date("2027-03-28T22:00:00Z"))).toBe("2027-03-29");
});

test("zählen: einmal am Tag oder jedes Mal; jede Zählung liegt im Ausgang und meldet sich als Ereignis", () => {
  const events = [];
  const listener = (event) => events.push(event.detail);
  window.addEventListener("tls:season-signal", listener);
  expect(recordSignal("halloween_pumpkin", { now: NOW })).toBe(true);
  expect(recordSignal("halloween_pumpkin", { now: NOW })).toBe(false);
  expect(recordSignal("halloween_bats_scared", { onceIf: false, now: NOW })).toBe(true);
  expect(recordSignal("halloween_bats_scared", { onceIf: false, now: NOW })).toBe(true);
  expect(recordSignal("", { now: NOW })).toBe(false);
  window.removeEventListener("tls:season-signal", listener);
  expect(signalCount("halloween_pumpkin", NOW)).toBe(1);
  expect(signalCount("halloween_bats_scared", NOW)).toBe(2);
  expect(events).toEqual([{ name: "halloween_pumpkin", count: 1 }, { name: "halloween_bats_scared", count: 1 }, { name: "halloween_bats_scared", count: 2 }]);
  expect(outbox()).toEqual({ "-|halloween_pumpkin|2026-10-30": 1, "-|halloween_bats_scared|2026-10-30": 2 });
  expect(outboxSize(NOW)).toBe(3);
  // Am nächsten Tag zählt der Kürbis wieder; gemerkt werden nur heute und gestern.
  const tomorrow = new Date("2026-10-31T19:00:00Z");
  expect(recordSignal("halloween_pumpkin", { now: tomorrow })).toBe(true);
  expect(signalCount("halloween_pumpkin", tomorrow)).toBe(1);
  const later = new Date("2026-11-02T10:00:00Z");
  recordSignal("halloween_bats_scared", { onceIf: false, now: later });
  expect(Object.keys(JSON.parse(localStorage.getItem("tls-season-signals")))).toEqual(["halloween_bats_scared:2026-11-02"]);
});

test("wem was gehört: eigene Zählungen und die ohne Anmeldung - nie die einer anderen Person", () => {
  recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  setSignalOwner("anna");
  recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  recordSignal("halloween_ghosts_freed", { onceIf: false, now: NOW });
  setSignalOwner("ben");
  recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  expect(pendingSignals(null, NOW)).toEqual([]);
  const anna = pendingSignals("anna", NOW);
  expect(anna.map(({ name, day, count }) => ({ name, day, count }))).toEqual([
    { name: "halloween_bats_scared", day: "2026-10-30", count: 3 },
    { name: "halloween_ghosts_freed", day: "2026-10-30", count: 1 },
  ]);
  // Anna hat gemeldet: ihre und die namenlosen Zählungen sind weg, Bens bleibt liegen, bis er sich anmeldet.
  expect(settleSignals(anna, NOW)).toBe(1);
  expect(outbox()).toEqual({ "ben|halloween_bats_scared|2026-10-30": 1 });
  expect(pendingSignals("anna", NOW)).toEqual([]);
  expect(pendingSignals("ben", NOW).map(({ name, count }) => [name, count])).toEqual([["halloween_bats_scared", 1]]);
});

test("während die Meldung unterwegs ist, kommt Neues dazu: nur das Gemeldete geht aus dem Ausgang", () => {
  setSignalOwner("anna");
  for (let i = 0; i < 5; i += 1) recordSignal("snowflakes_clicked", { onceIf: false, now: NOW });
  const sent = pendingSignals("anna", NOW);
  recordSignal("snowflakes_clicked", { onceIf: false, now: NOW });
  recordSignal("snowflakes_clicked", { onceIf: false, now: NOW });
  settleSignals(sent, NOW);
  expect(pendingSignals("anna", NOW).map(({ name, count }) => [name, count])).toEqual([["snowflakes_clicked", 2]]);
});

test("Grenzen des Servers: höchstens vierzig Zeilen und zweihundert je Zeile - der Rest wartet auf die nächste Meldung", () => {
  setSignalOwner("anna");
  localStorage.setItem(OUTBOX_KEY, JSON.stringify({ "anna|snowflakes_clicked|2026-10-30": 450 }));
  let pending = pendingSignals("anna", NOW);
  expect(pending.map((row) => row.count)).toEqual([MAX_COUNT]);
  settleSignals(pending, NOW);
  pending = pendingSignals("anna", NOW);
  expect(pending.map((row) => row.count)).toEqual([MAX_COUNT]);
  settleSignals(pending, NOW);
  expect(pendingSignals("anna", NOW).map((row) => row.count)).toEqual([50]);
  const many = {};
  for (let i = 0; i < 55; i += 1) many[`anna|signal_${String(i).padStart(2, "0")}|2026-10-30`] = 1;
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(many));
  expect(pendingSignals("anna", NOW)).toHaveLength(MAX_ITEMS);
  expect(MAX_ITEMS).toBe(40);
  expect(MAX_COUNT).toBe(200);
});

test("was der Server nicht mehr annähme, fliegt hinaus: älter als eine Woche, aus der Zukunft, kaputt", () => {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify({
    "-|halloween_bats_scared|2026-10-23": 4,
    "-|halloween_bats_scared|2026-10-22": 9,
    "-|halloween_bats_scared|2026-10-31": 2,
    "-|halloween_bats_scared|kaputt": 2,
    "-|halloween_ghosts_freed|2026-10-29": 0,
    "-|halloween_ghosts_freed|2026-10-28": "drei",
    "-||2026-10-30": 1,
  }));
  expect(pendingSignals("anna", NOW).map(({ name, day, count }) => [name, day, count])).toEqual([["halloween_bats_scared", "2026-10-23", 4]]);
  expect(REPLAY_DAYS).toBe(7);
  // Kaputter Speicher: leer statt Absturz.
  localStorage.setItem(OUTBOX_KEY, "{kaputt");
  expect(pendingSignals("anna", NOW)).toEqual([]);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(["liste"]));
  expect(pendingSignals("anna", NOW)).toEqual([]);
});

test("der Ausgang bleibt klein: ist er voll, fallen die ältesten Tage heraus", () => {
  const full = {};
  for (let i = 0; i < MAX_OUTBOX; i += 1) full[`-|signal_${String(i).padStart(2, "0")}|2026-10-2${i % 2 ? 9 : 8}`] = 1;
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(full));
  recordSignal("halloween_bats_scared", { onceIf: false, now: NOW });
  const keys = Object.keys(outbox());
  expect(keys).toHaveLength(MAX_OUTBOX);
  expect(keys).toContain("-|halloween_bats_scared|2026-10-30");
  expect(keys.filter((key) => key.endsWith("2026-10-28"))).toHaveLength(MAX_OUTBOX / 2 - 1);
});

test("ohne Speicher zählt das Signal für diese Seite und nichts stürzt ab", () => {
  const broken = vi.spyOn(Object.getPrototypeOf(window.localStorage), "setItem").mockImplementation(() => {
    throw new Error("voll");
  });
  expect(recordSignal("halloween_pumpkin", { now: NOW })).toBe(true);
  expect(pendingSignals("anna", NOW)).toEqual([]);
  broken.mockRestore();
});
