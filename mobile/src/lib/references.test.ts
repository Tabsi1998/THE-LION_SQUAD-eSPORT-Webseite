import {
  chronicleCount,
  clubChronicle,
  filterChronicle,
  gameOptions,
  honorStats,
  leaguePath,
  linkedSeasons,
  medalCounts,
  memberEntryOf,
  nextTitle,
  nextValue,
  pathSteps,
  pickShowcase,
  placeTitle,
  podiumItems,
  progressText,
  runningView,
  seasonNote,
  showcaseView,
  startersOf,
  tierRank,
  timelineGroups,
  yearOf,
  type ClubReference,
  type ReferenceEntry,
} from "./references";

// Referenzen in der App (#1945) - dieselbe Logik wie im Web (frontend/src/lib/referencesOverview.js, seriesTiers.js und
// components/tls/references/referenceParts.jsx): Ehrentafel, Vitrine, Liga-Weg, Chronik. Gerechnet wird nur Anzeige;
// Platzierungen, Medaillen und Stände kommen vom Server. Nur erfundene Namen.

const solo = (id: string, name: string, placement: number | null, extra: Partial<ReferenceEntry> = {}): ReferenceEntry => ({ id, kind: "solo", placement, lineup_members: [{ profile_id: `p-${name}`, display_name: name }], lineup: [], member_profile_ids: [`p-${name}`], ...extra });
const team = (id: string, teamName: string, names: string[], placement: number | null, extra: Partial<ReferenceEntry> = {}): ReferenceEntry => ({ id, kind: "team", team_name: teamName, placement, lineup_members: names.map((name) => ({ profile_id: `p-${name}`, display_name: name })), lineup: [], member_profile_ids: names.map((name) => `p-${name}`), ...extra });
const ref = (id: string, start: string | null, placement: number | null, extra: Partial<ClubReference> = {}): ClubReference => ({ id, title: id, start_date: start, best_placement: placement, medal: placement === 1 ? "gold" : placement === 2 ? "silver" : placement === 3 ? "bronze" : null, entries: [], ...extra });

// ---------------------------------------------------------------- Stufe

test("tierRank: die Zahl direkt nach dem Stufenwort zählt, kleiner ist höher; ohne Zahl ganz unten", () => {
  expect(tierRank("Division 1")).toBe(1);
  expect(tierRank("1. Liga")).toBe(1);
  expect(tierRank("4v4 Division 2")).toBe(2);
  expect(tierRank("Saison 2026 – Liga 1")).toBe(1);
  expect(tierRank("DIV. 4")).toBe(4);
  expect(tierRank("Liga A")).toBe(Infinity);
  expect(tierRank("Winterliga 2026")).toBe(Infinity);
  expect(tierRank("Liga 2026")).toBe(Infinity);
  expect(tierRank(null)).toBe(Infinity);
  // Eine eigene Reihenfolge der Spur gilt vor der Zahl im Namen.
  expect(tierRank(" silber ", ["Gold", "Silber"])).toBe(2);
  expect(tierRank("Bronze", ["Gold", "Silber"])).toBe(Infinity);
});

test("Vermerk einer Saison: zuerst das Ergebnis der Saison, dann die Reihenfolge, dann die Zahl im Namen", () => {
  expect(seasonNote({ tier: "Gold", season_result: "promoted" }, { tier: "Platin" })).toBe("Aufstieg");
  expect(seasonNote({ tier: "Liga 1", season_result: "champion" }, null)).toBe("Meister");
  expect(seasonNote({ tier: "Silber" }, { tier: "Gold" }, ["Gold", "Silber"])).toBe("Aufstieg");
  expect(seasonNote({ tier: "Liga 1" }, { tier: "Liga 2" })).toBe("Abstieg");
  expect(seasonNote({ tier: "Gold" }, { tier: "Silber" })).toBe("");
});

// ---------------------------------------------------------------- Liga-Weg

test("Liga-Weg: Auf- und Abstieg aus der nächsten Saison, die laufende ist hervorgehoben", () => {
  const path = leaguePath([
    { season: "2024", tier: "Liga 2", status: "completed", season_slug: "2024" },
    { season: "2025", tier: "Liga 2", status: "completed", season_slug: "2025" },
    { season: "2026", tier: "Liga 1", status: "active", season_slug: "2026" },
  ]);
  expect(path.steps.map((step) => [step.season, step.note, step.current])).toEqual([["2024", "", false], ["2025", "Aufstieg", false], ["2026", "läuft", true]]);
  expect(path.promotions).toBe(1);
  expect(path.target?.season_slug).toBe("2026");
  expect(path.summary).toBe("3 Saisons · 1 Aufstieg");
  // Zwei Stufen in einer Saison: kein abgeleiteter Vermerk.
  const parallel = leaguePath([
    { season: "2025", tier: "Division 2", status: "completed" },
    { season: "2026", tier: "Division 1", status: "completed" },
    { season: "2026", tier: "Division 3", status: "completed" },
  ]);
  expect(parallel.steps.map((step) => step.note)).toEqual(["", "", ""]);
  expect(leaguePath([{ season: "1", status: "completed" }]).summary).toBe("1 Saison");
  expect(leaguePath(undefined).steps).toEqual([]);
});

test("Kacheln des Liga-Wegs: Platz, Vermerk und Ton - ohne Platz kein „0.“", () => {
  const steps = pathSteps([
    { season: "Season 4", tier: "2. Liga", status: "completed", season_slug: "s4", club: { rank: 5, of: 9 } },
    { season: "Season 5", tier: "1. Liga", status: "completed", season_slug: "s5", club: { rank: 1, of: 10 }, season_result: "champion" },
    { season: "Season 6", tier: "1. Liga", status: "completed", season_slug: "s6", club: null },
    { season: "Season 7", tier: "1. Liga", status: "active", season_slug: "s7", club: { rank: 6, of: 8 } },
  ]);
  expect(steps.map((step) => [step.season, step.tier, step.result, step.tone])).toEqual([
    ["Season 4", "2. Liga", "5. · Aufstieg", "up"],
    ["Season 5", "1. Liga", "1. · Meister", "honor"],
    ["Season 6", "1. Liga", "–", "plain"],
    ["Season 7", "1. Liga", "6. · läuft", "current"],
  ]);
  // Mit eigenem Platz je Saison (Profil): der Platz der Person statt des Vereins.
  const own = pathSteps([{ season: "S1", tier: "Liga A", status: "completed", season_slug: "s1", club: { rank: 2, of: 8 } }], null, () => 4);
  expect(own[0].result).toBe("4. Platz");
  // Ohne Stufe heißt die Kachel nach der Art.
  expect(pathSteps([{ season: "2026", status: "completed", club: { rank: 3 } }], null, undefined, "team_league")[0].tier).toBe("Liga");
});

// ---------------------------------------------------------------- Vitrine

test("Hauptkarte automatisch: höchste Stufe vor höchstem Platz, bei Gleichstand die neueste; fest gewählt gilt die Wahl", () => {
  const items = [ref("cup-sieg", "2026-03-01", 1), ref("liga1-dritter", "2025-06-01", 3, { league: "Liga 1" }), ref("liga2-sieg", "2026-01-01", 1, { league: "Liga 2" })];
  expect(pickShowcase(items, { mode: "auto" })?.id).toBe("liga1-dritter");
  const tie = [ref("alt", "2024-05-01", 1), ref("neu", "2025-05-01", 1)];
  expect(pickShowcase(tie, null)?.id).toBe("neu");
  expect(pickShowcase(items, { mode: "pinned", reference_id: "liga2-sieg" })?.id).toBe("liga2-sieg");
  expect(pickShowcase(items, { mode: "pinned", reference_id: "weg" })?.id).toBe("liga1-dritter");
  expect(pickShowcase([], { mode: "auto" })).toBeNull();
  // Die Stufe der verknüpften Saison gilt vor dem Liga-Feld der Referenz.
  const linked = linkedSeasons([{ lineage: { slug: "probe", title: "Probe", tier_order: ["Gold", "Silber"] }, seasons: [{ season: "2024", tier: "Gold", season_slug: "2024", reference_ids: ["gold-dritter"] }] }]);
  expect(pickShowcase([ref("gold-dritter", "2024-01-01", 3), ref("liga2-sieg", "2026-01-01", 1, { league: "Liga 2" })], null, linked)?.id).toBe("gold-dritter");
});

test("Vitrine: nur Podestplätze, die neuesten zuerst", () => {
  const items = [ref("a", "2024-01-01", 2), ref("b", "2026-01-01", 5), ref("c", "2025-01-01", 1), ref("d", "2023-01-01", null)];
  expect(podiumItems(items).map((item) => item.id)).toEqual(["c", "a"]);
});

test("Hauptkarte als Karte: Platz und Zusatz, wer am Start war, Feldgröße und Monat - und wohin sie führt", () => {
  const item = ref("winter", "2026-02-14T18:00:00Z", 1, { display_title: "Rocket League Winterliga", entries: [team("e1", "Team Lions A", ["Kralle"], 1, { team_count: 12, placement_label: "Meister" })] });
  const view = showcaseView(item, null);
  expect(view.eyebrow).toBe("1. Platz · Meister");
  expect(view.title).toBe("Rocket League Winterliga");
  expect(view.detail).toBe("Team Lions A · von 12 Teams · Februar 2026");
  expect(view.season).toBeNull();
  const linked = linkedSeasons([{ lineage: { slug: "winterliga", title: "Winterliga", kind: "team_league" }, seasons: [{ season: "2026", season_slug: "2026", reference_ids: ["winter"] }] }]);
  expect(showcaseView(item, linked.get("winter")).season).toEqual({ lineage: "winterliga", season: "2026" });
  // Ohne Einträge (alter Server): nur Platz und Monat.
  expect(showcaseView(ref("alt", "2025-05-01", 2, { placement: 2 }), null).detail).toBe("Mai 2025");
});

// ---------------------------------------------------------------- Starter und Medaillen

test("Starter: jeder Name nur einmal, Teams mit Teamnamen, mit Personen-Filter nur der eigene Eintrag", () => {
  const item = ref("r", "2026-01-01", 1, { entries: [solo("e1", "Kralle", 1), solo("e2", "Sandsturm", 4), team("e3", "Lions Kart", ["Kralle", "Sandsturm"], 5), solo("e4", "Kralle", 9)] });
  expect(startersOf(item)).toEqual(["Kralle", "Sandsturm", "Lions Kart"]);
  expect(startersOf(item, "p-Sandsturm")).toEqual(["Sandsturm"]);
});

test("Medaillen: je Eintrag gezählt, mit Personen-Filter nur der beste eigene; der eigene Eintrag ist der beste", () => {
  const items = [
    ref("a", "2026-01-01", 1, { entries: [solo("e1", "Kralle", 1), solo("e2", "Sandsturm", 3)] }),
    ref("b", "2026-02-01", 2, { entries: [team("e3", "Lions", ["Kralle"], 2)] }),
    ref("alt", "2026-04-01", 3, { entries: [] }),
  ];
  expect(medalCounts(items)).toEqual({ gold: 1, silver: 1, bronze: 2 });
  expect(medalCounts(items, "p-Sandsturm")).toEqual({ gold: 0, silver: 0, bronze: 1 });
  const mixed = ref("m", "2026-01-01", 1, { entries: [solo("e5", "Kralle", 6), team("e6", "Lions", ["Kralle"], 2)] });
  expect(memberEntryOf(mixed, "p-Kralle")?.id).toBe("e6");
  expect(memberEntryOf(mixed, "p-Niemand")).toBeNull();
});

// ---------------------------------------------------------------- Chronik

test("Chronik je Jahr in Wiener Zeit: neuestes Jahr zuerst, ohne Datum am Ende", () => {
  expect(yearOf({ start_date: "2025-12-31T23:30:00Z" })).toBe("2026");
  expect(yearOf({ start_date: null })).toBe("");
  const groups = timelineGroups([ref("a", "2025-03-01", 1), ref("b", null, 2), ref("c", "2026-01-01", 3), ref("d", "2025-09-01", 4)]);
  expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([["2026", ["c"]], ["2025", ["d", "a"]], ["Ohne Datum", ["b"]]]);
});

test("Chronik-Filter und Spiel-Chips: je Spiel einmal, das häufigste zuerst", () => {
  const items = [
    ref("mk-sieg", "2026-01-01", 1, { game_name: "Mario Kart 8", entries: [solo("e1", "Kralle", 1)] }),
    ref("mk-vierter", "2025-01-01", 4, { game_name: "Mario Kart 8", entries: [solo("e2", "Kralle", 4)] }),
    ref("rl-zweiter", "2025-02-01", 2, { game_name: "Rocket League", entries: [team("e3", "Lions", ["Kralle"], 2)] }),
  ];
  expect(filterChronicle(items, { game: "Mario Kart 8" }).map((item) => item.id)).toEqual(["mk-sieg", "mk-vierter"]);
  expect(filterChronicle(items, { podiumOnly: true }).map((item) => item.id)).toEqual(["mk-sieg", "rl-zweiter"]);
  expect(filterChronicle(items, { memberId: "p-Niemand" })).toEqual([]);
  expect(gameOptions(items)).toEqual([{ key: "Mario Kart 8", title: "Mario Kart 8", count: 2 }, { key: "Rocket League", title: "Rocket League", count: 1 }]);
  expect(chronicleCount(3, 12)).toBe("3 von 12 Teilnahmen");
  expect(chronicleCount(1, 1)).toBe("1 Teilnahme");
});

test("Chronik des Vereins als Zeilen: Platz, Titel, Spiel und Monat, neueste zuerst, mit Ziel", () => {
  const items = [
    ref("alt", "2025-08-20T18:00:00Z", 5, { display_title: "DeSBL · 1. Liga · S5", game: { name: "Black Ops 6" } }),
    ref("neu", "2026-02-10T18:00:00Z", 1, { title: "Winterliga · Liga 2", game_name: "Rocket League" }),
  ];
  const linked = linkedSeasons([{ lineage: { slug: "desbl", title: "DeSBL" }, seasons: [{ season: "S5", season_slug: "s5", reference_ids: ["alt"] }] }]);
  const rows = clubChronicle(items, linked);
  expect(rows.map((row) => [row.id, row.placement, row.title, row.sub])).toEqual([
    ["neu", 1, "Winterliga · Liga 2", "Rocket League · Feb. 2026"],
    ["alt", 5, "DeSBL · 1. Liga · S5", "Black Ops 6 · Aug. 2025"],
  ]);
  expect(rows[1].season).toEqual({ lineage: "desbl", season: "s5" });
  expect(rows[0].season).toBeNull();
});

// ---------------------------------------------------------------- Ehrentafel

test("Ehrentafel: Medaillen aus der Bilanz, laufende Saisons und Aufstiege aus den Spuren, seit dem ersten Jahr", () => {
  const stats = honorStats({
    summary: { gold: 3, silver: 2, bronze: 1, total: 12, games: 6 },
    items: [ref("a", "2024-05-01", 1), ref("b", "2023-12-02", 2), ref("c", null, 3)],
    lineages: [
      { lineage: { slug: "x", title: "X" }, seasons: [{ season: "2024", tier: "Liga 2", status: "completed" }, { season: "2025", tier: "Liga 1", status: "active" }] },
      { lineage: { slug: "y", title: "Y" }, seasons: [{ season: "2026", tier: "Division 2", status: "active" }] },
    ],
  });
  expect(stats).toEqual({ gold: 3, silver: 2, bronze: 1, total: 12, games: 6, running: 2, promotions: 1, since: "2023" });
  // Alter Server ohne Bilanz: nur Nullen - die Ansicht blendet sie aus.
  expect(honorStats({ summary: null, items: [], lineages: [] })).toEqual({ gold: 0, silver: 0, bronze: 0, total: 0, games: 0, running: 0, promotions: 0, since: "" });
});

// ---------------------------------------------------------------- Läuft gerade

test("Läuft gerade: Fortschritt, Termin und Platz in der Sprache der Art", () => {
  expect(progressText("racing", 6, 10)).toBe("6 von 10 Rennen gewertet");
  expect(progressText("team_league", 0, 1)).toBe("0 von 1 Spieltag gespielt");
  expect(nextTitle("racing", { state: "today" })).toBe("Heute");
  expect(nextTitle("team_league", { state: "planned" })).toBe("Nächster Spieltag");
  expect(nextValue({ state: "today", code: "R7", time: "20:30", club_day: "2026-11-09" })).toBe("R7 · 20:30");
  expect(nextValue({ state: "planned", code: "ST4", time: "20:00", club_day: "2026-10-22" })).toBe("Do 22.10. · 20:00 · ST4");
  expect(nextValue(null)).toBe("Kein Termin offen");
  expect(placeTitle("racing")).toBe("Bester Fahrer");
});

test("Karte „Läuft gerade“: Art und Spiel, Saison, Termin, Fortschritt und unser Platz - ohne Platz „noch offen“", () => {
  const racing = runningView({
    lineage: { title: "Probe Racing League", slug: "prl", kind: "racing", game_name: "F1 26" },
    series: { season: "2026", tier: "Liga 1", title: null, season_slug: "2026-liga-1" },
    progress: { total: 24, scored: 11 },
    next: { code: "R12", state: "today", time: "20:00", club_day: "2026-10-21", country_code: "nl" },
    today: true,
    club: { rank: 4, of: 20 },
  });
  // Land des nächsten Termins für die Flagge (#1925).
  expect(racing.country).toBe("NL");
  expect(racing).toMatchObject({
    key: "prl/2026-liga-1", kind: "Rennliga · F1 26", title: "Probe Racing League · 2026 · Liga 1", today: true,
    next: "Heute · R12 · 20:00", progress: { scored: 11, total: 24 }, place: "Bester Vereinsfahrer: P4 von 20",
    season: { lineage: "prl", season: "2026-liga-1" },
  });
  expect(racing.progress?.share).toBeCloseTo(11 / 24);
  const league = runningView({
    lineage: { title: "Probe Liga", slug: "pl", kind: "team_league" },
    series: { season: "S3", title: "Probe Liga · Newcomer I · S3", season_slug: "s3" },
    progress: { total: 0, scored: 0 },
    next: null,
    today: false,
    club: null,
  });
  expect(league).toMatchObject({ kind: "Team-Liga", title: "Probe Liga · Newcomer I · S3", next: "", progress: null, place: "Platz noch offen", country: "" });
  expect(runningView({ lineage: { slug: "pl", title: "Probe Liga", kind: "team_league" }, series: { season_slug: "s3" }, club: { rank: 3, of: 8 } }).place).toBe("Platz 3 von 8");
});
