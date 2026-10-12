import { leadFilter, leadLine, leadNames } from "./tournamentLead";
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
