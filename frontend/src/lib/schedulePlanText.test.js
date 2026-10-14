import { describe, expect, it } from "vitest";
import { countOf, describeSchedulePlan } from "./schedulePlanText";

// Spielplaner (#1552): der Text im Dialog „Spielplan übernehmen?“ - Zahlen mit richtiger Einzahl, Wiener Zeit,
// lange Listen gekürzt, Konflikte vor Hinweisen.

const assignment = (overrides = {}) => ({
  match_id: "m1", label: "A1", scheduled_at: "2026-10-31T10:00:00+00:00", station_name: "1", forecast: false, changed: true, ...overrides,
});

describe("countOf", () => {
  it("kennt die Einzahl", () => {
    expect(countOf(1, "Spiel", "Spiele")).toBe("1 Spiel");
    expect(countOf(0, "Konflikt", "Konflikte")).toBe("0 Konflikte");
    expect(countOf(undefined, "Hinweis", "Hinweise")).toBe("0 Hinweise");
  });
});

describe("describeSchedulePlan", () => {
  it("zählt Spiele, Konflikte und Hinweise und nennt jede Zeile in Wiener Zeit", () => {
    const plan = { mode: "stations" };
    const changed = [assignment(), assignment({ match_id: "m2", label: "F", scheduled_at: "2026-10-31T10:35:00+00:00", forecast: true })];
    const warnings = [
      { type: "too_early", severity: "error", message: "B1 ist fest um 10:00 UTC, aber A1 ist erst um 10:30 UTC vorbei." },
      { type: "no_stations", severity: "warning", message: "Keine freie Station." },
    ];
    const text = describeSchedulePlan(plan, changed, warnings);
    expect(text).toContain("2 Spiele bekommen Zeit und Station, 1 Konflikt, 1 Hinweis.");
    expect(text).toContain("A1: Sa., 31.10., 11:00 · Station 1");
    expect(text).toContain("F: Sa., 31.10., 11:35 · Station 1 (voraussichtlich)");
    expect(text).toContain("Konflikt: B1 ist fest um 10:00 UTC");
    expect(text).toContain("Hinweis: Keine freie Station.");
    expect(text.indexOf("Konflikt:")).toBeLessThan(text.indexOf("Hinweis:"));
  });

  it("kürzt lange Listen und lange Namen, statt den Dialog zu sprengen", () => {
    const many = Array.from({ length: 40 }, (_, index) => assignment({ match_id: `m${index}`, label: `Gruppe A Spieltag ${index + 1} Heimspiel Rückrunde Finalrunde Platzierung` }));
    const text = describeSchedulePlan({ mode: "stations" }, many, []);
    expect(text).toContain("40 Spiele bekommen Zeit und Station, 0 Konflikte, 0 Hinweise.");
    expect(text).toContain("… und 32 weitere Spiele");
    expect(text).not.toContain("Platzierung");
    expect(text.split("\n").length).toBeLessThan(16);
  });

  it("sagt „ohne Station“, wenn der Plan nur Zeiten schreibt (Spielwochen)", () => {
    const text = describeSchedulePlan({ mode: "matchdays" }, [assignment({ station_name: null, schedule_source: "default" })], []);
    expect(text).toContain("1 Spiel bekommt Zeit, 0 Konflikte, 0 Hinweise.");
    expect(text).toContain("A1: Sa., 31.10., 11:00 · ohne Station");
  });

  it("ein Spiel, das auf die Auslosung wartet (#1590), sagt das statt „voraussichtlich“", () => {
    const text = describeSchedulePlan({ mode: "stations" }, [assignment({ forecast: true, waiting_for_draw: true })], []);
    expect(text).toContain("A1: Sa., 31.10., 11:00 · Station 1 (wartet auf Auslosung)");
  });
});
