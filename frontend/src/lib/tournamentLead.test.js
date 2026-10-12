// Turnierleitung am Handy (#1156): Filter und Zeilen der Liste offener Spiele.
import { leadFilter, leadLine, leadNames } from "./tournamentLead";

const duel = { kind: "duel", status: "in_progress", participants: [{ name: "NeonFalke" }, { name: "PixelPanther" }], timing: { running_minutes: 12 } };
const late = { kind: "duel", status: "scheduled", participants: [{ name: "TurboTina" }, { name: "Frostbiss" }], timing: { missing: true, overdue_minutes: 9 } };
const heat = { kind: "heat", status: "scheduled", scheduled_at: "2026-05-23T13:00:00+00:00", participants: [{}, {}, {}, {}, {}, {}], timing: {} };

test("Filter: alle, läuft, Ergebnis fehlt", () => {
  expect([duel, late, heat].filter((item) => leadFilter(item, "all"))).toHaveLength(3);
  expect([duel, late, heat].filter((item) => leadFilter(item, "running"))).toEqual([duel]);
  expect([duel, late, heat].filter((item) => leadFilter(item, "missing"))).toEqual([late]);
});

test("Namen und Zeitzeile im Klartext", () => {
  expect(leadNames(duel)).toBe("NeonFalke gegen PixelPanther");
  expect(leadNames(heat)).toBe("6 Teilnehmer");
  expect(leadLine(duel)).toBe("läuft 12 Min.");
  expect(leadLine(late)).toBe("Ergebnis fehlt · 9 Min. über der Zeit");
  expect(leadLine(heat, () => "Sa 15:00")).toBe("geplant Sa 15:00");
  expect(leadLine({ status: "disputed", timing: {} })).toBe("In Klärung – Dispute offen");
  expect(leadLine({ status: "ready", timing: {} })).toBe("ohne feste Zeit");
});
