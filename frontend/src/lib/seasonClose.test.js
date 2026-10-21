import { entryLine, entryName, referenceHref, referenceLine, seasonOf, seasonOptions, targetOptions } from "./seasonClose";

// Saison abschließen (#1750): Zeilen des Vorschlags, „Referenz: Platz 6 von 8“, die Auswahl „Gehört zur Saison“ und
// wohin die Karte einer Referenz führt. Nur erfundene Namen.

const LINEAGES = [
  {
    id: "spur-1", title: "Probe Liga", slug: "probe-liga", is_archived: false,
    series: [
      { id: "s-2026", season: "2026", tier: "Division 2", season_slug: "2026-division-2", status: "active", reference_id: "ref-ende" },
      { id: "s-2024", season: "2024", tier: "", season_slug: "2024", status: "archived" },
    ],
  },
  { id: "spur-alt", title: "Alte Spur", slug: "alte-spur", is_archived: true, series: [{ id: "s-alt", season: "2020", status: "completed" }] },
];

test("entryLine: Platz von N Teams bzw. von N, dazu die Bezeichnung; ohne Platz „Ohne Platz“", () => {
  expect(entryLine({ kind: "team", placement: 6, team_count: 8, placement_label: "Tabelle" })).toBe("Platz 6 von 8 Teams · Tabelle");
  expect(entryLine({ kind: "solo", placement: 3, participant_count: 12, placement_label: "Fahrerwertung" })).toBe("Platz 3 von 12 · Fahrerwertung");
  expect(entryLine({ kind: "solo", placement: 1 })).toBe("Platz 1");
  expect(entryLine({ kind: "team", placement: null, team_count: 8, placement_label: "Saison abgebrochen" })).toBe("Ohne Platz · Saison abgebrochen");
});

test("entryName: Team mit Namen, Einzelstarter mit der Person", () => {
  expect(entryName({ kind: "team", team_name: "Probe Löwen" })).toBe("Probe Löwen");
  expect(entryName({ kind: "solo", members: [{ profile_id: "p-a", name: "Alpha" }] })).toBe("Alpha");
  expect(entryName({ kind: "solo", members: [] })).toBe("Einzelstarter");
});

test("referenceLine: „Platz 6 von 8“, ohne Feldgröße nur der Platz, ohne Platz „Teilnahme“", () => {
  expect(referenceLine({ id: "r", placement: 6, of: 8 })).toBe("Platz 6 von 8");
  expect(referenceLine({ id: "r", placement: 2, of: null })).toBe("Platz 2");
  expect(referenceLine({ id: "r", placement: null })).toBe("Teilnahme");
  expect(referenceLine(null)).toBe("");
});

test("targetOptions: die Referenz der Saison allein, sonst die verknüpften und „neu anlegen“", () => {
  expect(targetOptions({ current: { id: "ref-ende", title: "Probe Liga" }, candidates: [{ id: "ref-ende", title: "Probe Liga" }, { id: "ref-cup", title: "Cup" }] }))
    .toEqual([["ref-ende", "Probe Liga"]]);
  expect(targetOptions({ current: null, candidates: [{ id: "ref-alt", title: "Alt", season: "Season 3" }] }))
    .toEqual([["ref-alt", "Aktualisieren: Alt · Season 3"], ["", "Neue Referenz anlegen"]]);
  expect(targetOptions({ current: null, candidates: [] })).toEqual([["", "Neue Referenz anlegen"]]);
});

test("seasonOptions: Saisons aller offenen Spuren, archivierte nur, wenn sie gerade gewählt sind", () => {
  expect(seasonOptions(LINEAGES)).toEqual([["", "Keine – einzelnes Turnier oder Cup"], ["s-2026", "Probe Liga · 2026 · Division 2"]]);
  expect(seasonOptions(LINEAGES, "s-alt").map(([value]) => value)).toEqual(["", "s-2026", "s-alt"]);
});

test("seasonOf: über series_id der Referenz oder reference_id der Saison; Abschluss-Referenz erkannt", () => {
  expect(seasonOf({ id: "ref-cup", series_id: "s-2026" }, LINEAGES)).toMatchObject({ seriesId: "s-2026", label: "Probe Liga · 2026 · Division 2", seasonEnd: false });
  expect(seasonOf({ id: "ref-ende" }, LINEAGES)).toMatchObject({ seriesId: "s-2026", seasonEnd: true });
  expect(seasonOf({ id: "ref-frei" }, LINEAGES)).toBeNull();
});

test("referenceHref: Referenz aus einer Saison führt zur Saison-Seite, sonst zur Referenz", () => {
  expect(referenceHref({ id: "r1", season_link: { lineage_slug: "probe-liga", season_slug: "2026" } })).toBe("/references/series/probe-liga/2026");
  expect(referenceHref({ id: "r2" }, { lineage: { slug: "probe-cup" }, season: { season_slug: "2025" } })).toBe("/references/series/probe-cup/2025");
  expect(referenceHref({ id: "r3", season_link: null })).toBe("/references/r3");
});
