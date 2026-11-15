import { defaultLeadTab, drawCountdown, drawTargetText, leadClocked, leadFilter, leadLine, leadNames } from "./tournamentLead";
import type { ResultEntry } from "./resultEntry";

// Turnierleitung am Handy (#1156): dieselben Filter und Zeilen wie auf der Website.
const duel = { id: "m1", kind: "duel", status: "in_progress", participants: [{ registration_id: "a", name: "NeonFalke" }, { registration_id: "b", name: "PixelPanther" }], timing: { running_minutes: 12 } } as ResultEntry;
const late = { id: "m2", kind: "duel", status: "scheduled", participants: [{ registration_id: "c", name: "TurboTina" }, { registration_id: "d", name: "Frostbiss" }], timing: { missing: true, overdue_minutes: 9 } } as ResultEntry;

test("Filter und Zeilen", () => {
  expect([duel, late].filter((item) => leadFilter(item, "running"))).toEqual([duel]);
  expect([duel, late].filter((item) => leadFilter(item, "missing"))).toEqual([late]);
  expect(leadNames(duel)).toBe("NeonFalke gegen PixelPanther");
  expect(leadLine(duel)).toBe("läuft 12 Min.");
  expect(leadLine(late)).toBe("Ergebnis fehlt · 9 Min. über der Zeit");
});

// Cockpit (#1653, #2393): vor Ort mit Warteschlange der Einstieg; ein Fall aus einem Link öffnet „Braucht Aufmerksamkeit“.
test("Einstieg: Fall aus dem Link, sonst Cockpit vor Ort, sonst Fälle oder Ergebnisse - erst nach dem Laden", () => {
  expect(defaultLeadTab({ fall: "ds-m1", queue: true, ready: false })).toBe("attention");
  expect(defaultLeadTab({ queue: true, ready: false })).toBe("");
  expect(defaultLeadTab({ queue: true, cases: 0, ready: true })).toBe("cockpit");
  expect(defaultLeadTab({ queue: true, cases: 3, ready: true })).toBe("cockpit");
  expect(defaultLeadTab({ queue: false, cases: 2, ready: true })).toBe("attention");
  expect(defaultLeadTab({ queue: false, cases: 0, ready: true })).toBe("results");
});

test("die Uhr in der Zeile: nur laufend mit Startzeit, nie im Streitfall", () => {
  expect(leadClocked({ ...duel, started_at: "2026-11-16T13:00:00Z" })).toBe(true);
  expect(leadClocked(duel)).toBe(false);
  expect(leadClocked({ ...duel, started_at: "2026-11-16T13:00:00Z", status: "disputed" })).toBe(false);
  expect(leadClocked({ ...late, started_at: "2026-11-16T13:00:00Z" })).toBe(false);
});

test("Auslosung: Restzeit nach der Server-Uhr, Ziel in Worten", () => {
  const card = { due_at: "2026-11-16T13:10:00Z" };
  // Der Server sagt 13:00, seitdem sind 5 Minuten vergangen - es zählt die Server-Uhr plus die vergangene Zeit.
  expect(drawCountdown(card, "2026-11-16T13:00:00Z", Date.parse("2026-11-16T13:05:00Z"))).toBe("automatisch in 5 Min.");
  expect(drawCountdown(card, "2026-11-16T13:11:00Z", Date.parse("2026-11-16T13:11:00Z"))).toBe("der Server lost jeden Moment selbst");
  expect(drawCountdown({}, null)).toBe("");
  expect(drawTargetText({ label: "Runde 1", round_label: "Loser Runde 1", match_keys: ["LA", "LB"] })).toBe("nach Runde 1 → Loser Runde 1 (LA, LB)");
});
