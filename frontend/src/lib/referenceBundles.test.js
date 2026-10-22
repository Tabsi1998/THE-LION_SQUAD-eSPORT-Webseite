import { bundleSummary, initialSelection, previewPath, selectedHints, selectedSeasons, undoText } from "./referenceBundles";

// Referenzen bündeln (#1751): Auswahl filtert Saisons, Hinweise und Liga-Weg der Vorschau. Nur erfundene Namen.

const GROUP = {
  key: "probeverband|name:probespiel|4vs4|probeliga",
  lineage: { id: null, title: "Probe Liga", kind: "team_league", tier_order: null },
  references: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
  seasons: [
    { key: "season1|division3", id: null, season: "Season 1", tier: "Division 3", status: "completed", reference_ids: ["r1"], club: { rank: 2 } },
    { key: "season2|division2", id: "s2", season: "Season 2", tier: "Division 2", status: "completed", reference_ids: ["r2", "r3"], club: { rank: 1 } },
  ],
  hints: [
    { code: "missing_date", reference_ids: ["r1"], text: "a" },
    { code: "duplicate", reference_ids: ["r2", "r3"], text: "b" },
  ],
};

test("alle Referenzen sind vorgewählt; die Vorschau zählt neue und vorhandene Saisons", () => {
  const selected = initialSelection(GROUP);
  expect([...selected]).toEqual(["r1", "r2", "r3"]);
  expect(bundleSummary(GROUP, selected)).toBe("3 Referenzen · 1 neue Saison · 1 vorhandene");
});

test("abgewählte Referenzen fallen aus Saisons, Hinweisen und Liga-Weg", () => {
  const selected = new Set(["r2"]);
  expect(selectedSeasons(GROUP, selected).map((season) => [season.season, season.reference_ids])).toEqual([["Season 2", ["r2"]]]);
  expect(selectedHints(GROUP, selected).map((hint) => hint.code)).toEqual(["duplicate"]);
  expect(bundleSummary(GROUP, selected)).toBe("1 Referenz · 1 vorhandene");
});

test("der Liga-Weg der Vorschau leitet den Aufstieg aus den Stufen ab", () => {
  const path = previewPath(GROUP, initialSelection(GROUP));
  expect(path.steps.map((step) => [step.season, step.note])).toEqual([["Season 1", "Aufstieg"], ["Season 2", ""]]);
  expect(path.summary).toBe("2 Saisons · 1 Aufstieg");
});

test("Rücknahme in einem Satz", () => {
  expect(undoText({ unlinked: 2, series_removed: 1, series_kept: ["s"], lineage_removed: false }))
    .toBe("2 Referenzen gelöst · 1 Saison entfernt · 1 geänderte Saison bleibt");
  expect(undoText({ unlinked: 1, series_removed: 0, series_kept: [], lineage_removed: true })).toBe("1 Referenz gelöst · Spur entfernt");
});
