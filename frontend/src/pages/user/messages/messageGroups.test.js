import { buildTimeline, dayLabel, mergeMessages } from "./messageGroups";

// Die Unterhaltung als Chat (#254): Tages-Trenner, zusammengefasste Koepfe,
// Nachladen ohne Doppelte und der Zaehler fuer neue Nachrichten.

const NOW = new Date("2026-09-16T10:00:00+02:00");

function msg(id, sender, at, text = "") {
  return { id, sender_id: sender, created_at: at, message: text || `Nachricht ${id}` };
}

test("Tages-Trenner heissen Heute, Gestern oder tragen das Datum", () => {
  expect(dayLabel("2026-09-16T08:00:00+02:00", NOW)).toBe("Heute");
  expect(dayLabel("2026-09-15T23:59:00+02:00", NOW)).toBe("Gestern");
  expect(dayLabel("2026-09-12T12:00:00+02:00", NOW)).toBe("12.09.2026");
  expect(dayLabel("kaputt", NOW)).toBe("");
});

test("die Tage zählen in Wien, nicht am Gerät", () => {
  // Halb eins in Wien ist in UTC noch der Vortag - der Trenner richtet sich nach Wien.
  expect(dayLabel("2026-09-16T00:30:00+02:00", NOW)).toBe("Heute");
  expect(dayLabel("2026-09-15T00:30:00+02:00", NOW)).toBe("Gestern");
  const items = buildTimeline([msg("a", "bob", "2026-09-15T23:50:00+02:00"), msg("b", "bob", "2026-09-16T00:10:00+02:00")], "alice", NOW);
  expect(items.map((item) => item.label || item.type)).toEqual(["Gestern", "message", "Heute", "message"]);
  expect(items[0].key).toBe("day-2026-09-15");
});

test("die Zeitleiste setzt je Tag einen Trenner und fasst Koepfe desselben Absenders zusammen", () => {
  const rows = [
    msg("a", "bob", "2026-09-15T20:00:00+02:00"),
    msg("b", "bob", "2026-09-15T20:02:00+02:00"),
    msg("c", "alice", "2026-09-15T20:03:00+02:00"),
    msg("d", "alice", "2026-09-16T09:00:00+02:00"),
    msg("e", "alice", "2026-09-16T09:30:00+02:00"),
  ];
  const items = buildTimeline(rows, "alice", NOW);
  expect(items.map((item) => item.type)).toEqual(["day", "message", "message", "message", "day", "message", "message"]);
  expect(items[0].label).toBe("Gestern");
  expect(items[4].label).toBe("Heute");
  expect(items[1].showHeader).toBe(true);
  expect(items[2].showHeader).toBe(false);
  expect(items[3].showHeader).toBe(true);
  expect(items[3].mine).toBe(true);
  // Nach dem Tageswechsel und nach 30 Minuten Pause gibt es wieder einen Kopf.
  expect(items[5].showHeader).toBe(true);
  expect(items[6].showHeader).toBe(true);
});

test("nachgeladene aeltere Seiten fuegen sich vorne ein, ohne Doppelte und ohne als neu zu gelten", () => {
  const latest = [msg("m3", "bob", "2026-09-16T09:03:00+02:00"), msg("m4", "alice", "2026-09-16T09:04:00+02:00")];
  const older = [msg("m1", "bob", "2026-09-16T09:01:00+02:00"), msg("m2", "bob", "2026-09-16T09:02:00+02:00"), msg("m3", "bob", "2026-09-16T09:03:00+02:00")];
  const { messages, appended } = mergeMessages(latest, older);
  expect(messages.map((row) => row.id)).toEqual(["m1", "m2", "m3", "m4"]);
  expect(appended).toBe(0);
});

test("neue Nachrichten aus dem Aenderungsstrom kommen hinten dazu und werden gezaehlt", () => {
  const shown = [msg("m1", "bob", "2026-09-16T09:01:00+02:00"), msg("m2", "alice", "2026-09-16T09:02:00+02:00")];
  const fresh = [msg("m2", "alice", "2026-09-16T09:02:00+02:00"), msg("m3", "bob", "2026-09-16T09:05:00+02:00"), msg("m4", "bob", "2026-09-16T09:06:00+02:00")];
  const { messages, appended } = mergeMessages(shown, fresh);
  expect(messages.map((row) => row.id)).toEqual(["m1", "m2", "m3", "m4"]);
  expect(appended).toBe(2);
});

test("der Kopf zählt zonenlose Werte als Wiener Uhr, auch wenn das Gerät in einer anderen Zeitzone steht (#1049)", () => {
  const before = process.env.TZ;
  try {
    for (const zone of ["Asia/Tokyo", "America/Los_Angeles", "UTC"]) {
      process.env.TZ = zone;
      // Vorgänger ohne Zone (= 10:00 Wien), Nachricht mit Zone 4 Minuten später: gleicher Kopf.
      const close = buildTimeline([msg("a", "bob", "2026-07-01T10:00:00"), msg("b", "bob", "2026-07-01T10:04:00+02:00")], "alice", NOW);
      expect(close.filter((item) => item.type === "message").map((item) => item.showHeader)).toEqual([true, false]);
      // Sechs Minuten: eigener Kopf.
      const apart = buildTimeline([msg("a", "bob", "2026-07-01T10:00:00"), msg("b", "bob", "2026-07-01T10:06:00+02:00")], "alice", NOW);
      expect(apart.filter((item) => item.type === "message").map((item) => item.showHeader)).toEqual([true, true]);
      // Beide ohne Zone: gleicher Abstand, egal wo das Gerät steht.
      const zoneless = buildTimeline([msg("a", "bob", "2026-07-01T10:00:00"), msg("b", "bob", "2026-07-01T10:04:00")], "alice", NOW);
      expect(zoneless.filter((item) => item.type === "message").map((item) => item.showHeader)).toEqual([true, false]);
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
