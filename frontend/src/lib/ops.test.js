import { checksLabel, describeRun, formatVital, opsDetail, opsTone, ratingTone } from "./ops";

test("der Satz zu den Checks nennt rot und gelb, sonst alle grün", () => {
  expect(checksLabel(null)).toBe("");
  expect(checksLabel({ status: "ok", counts: { ok: 8 } })).toBe("Checks: alle grün");
  expect(checksLabel({ status: "crit", counts: { crit: 1, warn: 2 } })).toBe("Checks: 1 rot, 2 gelb");
  expect(checksLabel({ status: "warn", counts: { warn: 1 } })).toBe("Checks: 1 gelb");
});

test("die Kachel Betrieb wird rot bei roten Checks oder offenen Fehlern, gelb bei gelben Checks", () => {
  expect(opsTone(null)).toBe("#00FF88");
  expect(opsTone({ open_error_groups: 0, slow_requests_24h: 0 })).toBe("#00FF88");
  expect(opsTone({ open_error_groups: 1 })).toBe("#FF3B30");
  expect(opsTone({ checks: { status: "crit" } })).toBe("#FF3B30");
  expect(opsTone({ checks: { status: "warn" } })).toBe("#FFD700");
  expect(opsTone({ slow_requests_24h: 21 })).toBe("#FFD700");
  expect(opsDetail({ open_error_groups: 0, slow_requests_24h: 2, checks: { status: "warn", counts: { warn: 1 } } }))
    .toBe("0 Fehlergruppen offen, 2 langsame Anfragen in 24 h, Checks: 1 gelb");
});

test("Messwerte und Bewertungen sind lesbar", () => {
  expect(formatVital("LCP", 2412.6)).toBe("2413 ms");
  expect(formatVital("CLS", 0.1234)).toBe("0.123");
  expect(formatVital("INP", null)).toBe("–");
  expect(ratingTone("poor")).toBe("crit");
  expect(ratingTone(undefined)).toBe("plain");
});

test("der letzte Lauf wird zu einer Zeile", () => {
  expect(describeRun(null)).toBe("Noch kein Lauf.");
  expect(describeRun({ status: "ok", checks: [] })).toMatch(/^Alle Prüfungen grün/);
  expect(describeRun({ status: "crit", checks: [{ label: "Mail-Queue", status: "crit" }, { label: "Datenbank", status: "ok" }, { label: "Speicher", status: "warn" }] }))
    .toMatch(/^Mail-Queue: rot · Speicher: gelb/);
});
