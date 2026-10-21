import {
  chronicleCount,
  filterChronicle,
  gameOptions,
  honorStats,
  leaguePath,
  linkedSeasons,
  medalCounts,
  nextTitle,
  nextValue,
  pickShowcase,
  placeTitle,
  progressText,
  startersOf,
  tierRank,
  yearOf,
} from "./referencesOverview";

// Referenzen-Übersicht (#1878): Gruppierung, Filter und die Auswahl der Hauptkarte. Nur erfundene Namen.

const solo = (id, name, placement, extra = {}) => ({ id, kind: "solo", placement, lineup_members: [{ profile_id: `p-${name}`, display_name: name }], lineup: [], member_profile_ids: [`p-${name}`], ...extra });
const team = (id, teamName, names, placement, extra = {}) => ({ id, kind: "team", team_name: teamName, placement, lineup_members: names.map((name) => ({ profile_id: `p-${name}`, display_name: name })), lineup: [], member_profile_ids: names.map((name) => `p-${name}`), ...extra });
const ref = (id, start, placement, extra = {}) => ({ id, title: id, start_date: start, best_placement: placement, medal: placement === 1 ? "gold" : placement === 2 ? "silver" : placement === 3 ? "bronze" : null, entries: [], ...extra });

// ---------------------------------------------------------------- Stufe

test("tierRank: die Zahl der Stufe zählt, kleiner ist höher; ohne Zahl ganz unten", () => {
  expect(tierRank("Division 1")).toBe(1);
  expect(tierRank("Liga 2")).toBe(2);
  expect(tierRank("1. Liga")).toBe(1);
  expect(tierRank("Liga A")).toBe(Infinity);
  // Eine Jahreszahl ist keine Stufe.
  expect(tierRank("Winterliga 2026")).toBe(Infinity);
  expect(tierRank("")).toBe(Infinity);
  expect(tierRank(null)).toBe(Infinity);
});

test("tierRank: die Zahl direkt nach dem Stufenwort zählt - nicht die erste Zahl im Namen", () => {
  // Spielformat vorne: 4v4 ist keine Stufe.
  expect(tierRank("4v4 Division 2")).toBe(2);
  expect(tierRank("2x2 Liga 3")).toBe(3);
  // Jahreszahl vorne: die Stufe dahinter zählt.
  expect(tierRank("Saison 2026 – Liga 1")).toBe(1);
  // Alle Stufenwörter, Groß- und Kleinschreibung egal, Satzzeichen dazwischen.
  expect(tierRank("liga 3")).toBe(3);
  expect(tierRank("DIV. 4")).toBe(4);
  expect(tierRank("Div-2")).toBe(2);
  expect(tierRank("Stufe 5")).toBe(5);
  expect(tierRank("Tier 2")).toBe(2);
  expect(tierRank("Pro League 1")).toBe(1);
  // Ohne Stufenwort, nur Format, nur Jahr oder Jahr nach dem Stufenwort: nicht vergleichbar.
  expect(tierRank("Season 3")).toBe(Infinity);
  expect(tierRank("4v4")).toBe(Infinity);
  expect(tierRank("4vs4 Cup 2")).toBe(Infinity);
  expect(tierRank("Liga 2026")).toBe(Infinity);
  expect(tierRank("Division A")).toBe(Infinity);
});

test("Liga-Weg: Division 3 → Division 2 ist ein Aufstieg, auch mit Format oder Jahr im Namen", () => {
  const plain = leaguePath([
    { season: "2025", tier: "Division 3", status: "completed" },
    { season: "2026", tier: "Division 2", status: "completed" },
  ]);
  expect(plain.steps.map((step) => step.note)).toEqual(["Aufstieg", ""]);
  const format = leaguePath([
    { season: "2025", tier: "4v4 Division 3", status: "completed" },
    { season: "2026", tier: "4v4 Division 2", status: "completed" },
  ]);
  expect(format.steps.map((step) => step.note)).toEqual(["Aufstieg", ""]);
  const year = leaguePath([
    { season: "2025", tier: "Saison 2025 – Liga 2", status: "completed" },
    { season: "2026", tier: "Saison 2026 – Liga 1", status: "completed" },
  ]);
  expect(year.steps.map((step) => step.note)).toEqual(["Aufstieg", ""]);
  // Nicht vergleichbar: weder Auf- noch Abstieg - auch wenn die erste Zahl im Namen sich ändert.
  const unknown = leaguePath([
    { season: "2025", tier: "2v2 Cup", status: "completed" },
    { season: "2026", tier: "4v4 Cup", status: "completed" },
  ]);
  expect(unknown.steps.map((step) => step.note)).toEqual(["", ""]);
});

test("Liga-Weg (#1898): Vermerk „Aufstieg“ zeigt Aufstieg, auch wenn die Namen keine Zahl tragen", () => {
  const path = leaguePath([
    { season: "2024", tier: "Silber", status: "completed", season_result: "promoted" },
    { season: "2025", tier: "Gold", status: "completed", season_result: "champion" },
    { season: "2026", tier: "Gold", status: "completed", season_result: "stayed" },
    { season: "2027", tier: "Gold", status: "active", season_result: "relegated" },
  ]);
  // Die laufende Saison bleibt „läuft“, auch mit Vermerk.
  expect(path.steps.map((step) => step.note)).toEqual(["Aufstieg", "Meister", "Klassenerhalt", "läuft"]);
  expect(path.promotions).toBe(1);
  expect(path.summary).toBe("4 Saisons · 1 Aufstieg");
  // Der Vermerk gilt vor der Ableitung: Liga 2 → Liga 1 wäre ein Aufstieg, eingetragen ist „Abstieg“.
  const marked = leaguePath([
    { season: "2025", tier: "Liga 2", status: "completed", season_result: "relegated" },
    { season: "2026", tier: "Liga 1", status: "completed" },
  ]);
  expect(marked.steps.map((step) => step.note)).toEqual(["Abstieg", ""]);
});

test("Liga-Weg (#1898): ohne Vermerk zählt die Reihenfolge der Spur, sonst die Zahl im Namen als Rückfall", () => {
  const seasons = [
    { season: "2025", tier: "Silber", status: "completed" },
    { season: "2026", tier: "Gold", status: "completed" },
  ];
  expect(leaguePath(seasons).steps.map((step) => step.note)).toEqual(["", ""]);
  expect(leaguePath(seasons, ["Gold", "Silber"]).steps.map((step) => step.note)).toEqual(["Aufstieg", ""]);
  // Eine eigene Reihenfolge dreht die Zahl im Namen um.
  const numbered = [
    { season: "2025", tier: "Liga 1", status: "completed" },
    { season: "2026", tier: "Liga 3", status: "completed" },
  ];
  expect(leaguePath(numbered).steps[0].note).toBe("Abstieg");
  expect(leaguePath(numbered, ["Liga 3", "Liga 2", "Liga 1"]).steps[0].note).toBe("Aufstieg");
  // Ehrentafel: die Aufstiege zählen mit der Reihenfolge der Spur.
  expect(honorStats({ lineages: [{ lineage: { tier_order: ["Gold", "Silber"] }, seasons }] }).promotions).toBe(1);
});

// ---------------------------------------------------------------- Hauptkarte

test("Hauptkarte automatisch: höchste Stufe vor höchstem Platz, bei Gleichstand die neueste", () => {
  const items = [
    ref("cup-sieg", "2026-03-01", 1),
    ref("liga1-dritter", "2025-06-01", 3, { league: "Liga 1" }),
    ref("liga2-sieg", "2026-01-01", 1, { league: "Liga 2" }),
  ];
  expect(pickShowcase(items, { mode: "auto" })?.id).toBe("liga1-dritter");
  // Gleiche Stufe: der bessere Platz.
  const same = [ref("a", "2026-01-01", 2, { league: "Division 1" }), ref("b", "2025-01-01", 1, { league: "Division 1" })];
  expect(pickShowcase(same, { mode: "auto" })?.id).toBe("b");
  // Gleiche Stufe und gleicher Platz: die neueste.
  const tie = [ref("alt", "2024-05-01", 1), ref("neu", "2025-05-01", 1), ref("mittel", "2024-12-01", 1)];
  expect(pickShowcase(tie, { mode: "auto" })?.id).toBe("neu");
});

test("Hauptkarte: die Stufe der verknüpften Saison gilt vor dem Liga-Feld der Referenz", () => {
  const items = [ref("saison", "2024-01-01", 2, { league: "Probe Liga" }), ref("cup", "2026-01-01", 1, { league: "Liga 2" })];
  const linked = new Map([["saison", { season: { tier: "Liga 1" } }]]);
  expect(pickShowcase(items, { mode: "auto" }, linked)?.id).toBe("saison");
});

test("Hauptkarte (#1898): die Reihenfolge der Stufen der Spur gilt vor der Zahl im Namen", () => {
  const items = [ref("gold-dritter", "2024-01-01", 3), ref("liga2-sieg", "2026-01-01", 1, { league: "Liga 2" })];
  const linked = new Map([["gold-dritter", { lineage: { tier_order: ["Gold", "Silber"] }, season: { tier: "Gold" } }]]);
  expect(pickShowcase(items, { mode: "auto" }, linked)?.id).toBe("gold-dritter");
  // Ohne eigene Reihenfolge ist „Gold“ nicht vergleichbar - dann gewinnt die Liga 2.
  const plain = new Map([["gold-dritter", { lineage: {}, season: { tier: "Gold" } }]]);
  expect(pickShowcase(items, { mode: "auto" }, plain)?.id).toBe("liga2-sieg");
});

test("Hauptkarte fest gewählt: die gewählte, solange sie in der Vitrine steht - sonst automatisch", () => {
  const items = [ref("sieg", "2026-03-01", 1), ref("zweiter", "2024-03-01", 2)];
  expect(pickShowcase(items, { mode: "pinned", reference_id: "zweiter" })?.id).toBe("zweiter");
  expect(pickShowcase(items, { mode: "pinned", reference_id: "weg" })?.id).toBe("sieg");
  expect(pickShowcase(items, null)?.id).toBe("sieg");
  expect(pickShowcase([], { mode: "auto" })).toBeNull();
});

test("linkedSeasons: je Referenz die Saison und Spur, zu der sie gehört", () => {
  const lineage = { title: "Probe Racing", slug: "probe-racing", kind: "racing" };
  const map = linkedSeasons([{ lineage, seasons: [{ season: "2025", tier: "Liga 2", season_slug: "2025-liga-2", reference_ids: ["r1"] }, { season: "2026", reference_ids: [] }] }]);
  expect(map.get("r1")).toEqual({ lineage, season: { season: "2025", tier: "Liga 2", season_slug: "2025-liga-2", reference_ids: ["r1"] } });
  expect(map.size).toBe(1);
});

// ---------------------------------------------------------------- Starter

test("Starter: jeder Name nur einmal, Teams mit Teamnamen, Einzelstarter mit ihrem Namen", () => {
  const item = ref("r", "2026-01-01", 1, { entries: [solo("e1", "Kralle", 1), solo("e2", "Sandsturm", 4), team("e3", "Lions Kart", ["Kralle", "Sandsturm"], 5), solo("e4", "Kralle", 9)] });
  expect(startersOf(item)).toEqual(["Kralle", "Sandsturm", "Lions Kart"]);
  // Ein Team ohne Namen zeigt seine Leute.
  const nameless = ref("t", "2026-01-01", 2, { entries: [team("e1", "", ["Pfote", "Mähne"], 2, { lineup: ["Pfote"] })] });
  expect(startersOf(nameless)).toEqual(["Pfote", "Mähne"]);
  // Mit Personen-Filter nur der eigene Eintrag dieser Person.
  expect(startersOf(item, "p-Sandsturm")).toEqual(["Sandsturm"]);
});

// ---------------------------------------------------------------- Chronik

test("Chronik-Filter: Spiel und „Nur Podest“ wirken zusammen, Podest je Eintrag", () => {
  const items = [
    ref("mk-sieg", "2026-01-01", 1, { game_name: "Mario Kart 8", entries: [solo("e1", "Kralle", 1)] }),
    ref("mk-vierter", "2025-01-01", 4, { game_name: "Mario Kart 8", entries: [solo("e2", "Kralle", 4)] }),
    ref("rl-zweiter", "2025-02-01", 2, { game_name: "Rocket League", entries: [team("e3", "Lions", ["Kralle"], 2)] }),
  ];
  expect(filterChronicle(items, { game: "all", podiumOnly: false }).map((item) => item.id)).toEqual(["mk-sieg", "mk-vierter", "rl-zweiter"]);
  expect(filterChronicle(items, { game: "Mario Kart 8", podiumOnly: false }).map((item) => item.id)).toEqual(["mk-sieg", "mk-vierter"]);
  expect(filterChronicle(items, { game: "all", podiumOnly: true }).map((item) => item.id)).toEqual(["mk-sieg", "rl-zweiter"]);
  expect(filterChronicle(items, { game: "Mario Kart 8", podiumOnly: true }).map((item) => item.id)).toEqual(["mk-sieg"]);
  // Personen-Filter: nur Teilnahmen dieser Person, Podest nach ihrem eigenen Eintrag.
  const mixed = ref("mix", "2026-02-01", 1, { entries: [solo("e4", "Sandsturm", 1), solo("e5", "Kralle", 6)] });
  expect(filterChronicle([...items, mixed], { game: "all", podiumOnly: true, memberId: "p-Kralle" }).map((item) => item.id)).toEqual(["mk-sieg", "rl-zweiter"]);
});

test("Spiel-Chips: je Spiel einmal, häufigstes zuerst, gleich oft nach Namen", () => {
  const items = [
    ref("a", "2026-01-01", 1, { game_name: "Rocket League" }),
    ref("b", "2026-01-01", 1, { game_name: "Mario Kart 8" }),
    ref("c", "2026-01-01", 1, { game_name: "Mario Kart 8" }),
    ref("d", "2026-01-01", 1, { game_name: "F1 25" }),
  ];
  expect(gameOptions(items)).toEqual([
    { key: "Mario Kart 8", title: "Mario Kart 8", count: 2 },
    { key: "F1 25", title: "F1 25", count: 1 },
    { key: "Rocket League", title: "Rocket League", count: 1 },
  ]);
});

test("Anzahl: „x von y Teilnahmen“ nur mit Filter, Einzahl richtig", () => {
  expect(chronicleCount(12, 12)).toBe("12 Teilnahmen");
  expect(chronicleCount(1, 1)).toBe("1 Teilnahme");
  expect(chronicleCount(3, 12)).toBe("3 von 12 Teilnahmen");
  expect(chronicleCount(1, 12)).toBe("1 von 12 Teilnahmen");
});

test("Medaillen je Jahr: je Eintrag gezählt wie die Ehrentafel, mit Personen-Filter nur der eigene", () => {
  const items = [
    ref("a", "2026-01-01", 1, { entries: [solo("e1", "Kralle", 1), solo("e2", "Sandsturm", 3)] }),
    ref("b", "2026-02-01", 2, { entries: [team("e3", "Lions", ["Kralle"], 2)] }),
    ref("c", "2026-03-01", 7, { entries: [solo("e4", "Kralle", 7)] }),
    ref("alt", "2026-04-01", 3, { entries: [] }),
  ];
  expect(medalCounts(items)).toEqual({ gold: 1, silver: 1, bronze: 2 });
  expect(medalCounts(items, "p-Sandsturm")).toEqual({ gold: 0, silver: 0, bronze: 1 });
});

test("yearOf: das Jahr in Wiener Zeit, ohne Datum leer", () => {
  expect(yearOf({ start_date: "2025-12-31T23:30:00Z" })).toBe("2026");
  expect(yearOf({ start_date: null })).toBe("");
});

// ---------------------------------------------------------------- Liga-Weg

test("Liga-Weg: Aufstieg und Abstieg aus der Stufe der nächsten Saison, die laufende ist hervorgehoben", () => {
  const path = leaguePath([
    { season: "2024", tier: "Liga 2", status: "completed", season_slug: "2024" },
    { season: "2025", tier: "Liga 2", status: "completed", season_slug: "2025" },
    { season: "2026", tier: "Liga 1", status: "active", season_slug: "2026" },
  ]);
  expect(path.steps.map((step) => [step.season, step.note, step.current])).toEqual([
    ["2024", "", false], ["2025", "Aufstieg", false], ["2026", "läuft", true],
  ]);
  expect(path.promotions).toBe(1);
  expect(path.target.season_slug).toBe("2026");
  expect(path.summary).toBe("3 Saisons · 1 Aufstieg");

  const down = leaguePath([
    { season: "2024", tier: "Division 1", status: "completed", season_slug: "a" },
    { season: "2025", tier: "Division 2", status: "completed", season_slug: "b" },
  ]);
  expect(down.steps.map((step) => step.note)).toEqual(["Abstieg", ""]);
  // Ohne laufende Saison führt der Link zur neuesten.
  expect(down.target.season_slug).toBe("b");
  expect(down.summary).toBe("2 Saisons");
});

test("Liga-Weg: ohne vergleichbare Stufe und bei zwei Stufen in einer Saison kein Vermerk", () => {
  const named = leaguePath([
    { season: "Saison 1", tier: null, status: "completed" },
    { season: "Saison 2", tier: "Gold", status: "completed" },
  ]);
  expect(named.steps.map((step) => step.note)).toEqual(["", ""]);
  const parallel = leaguePath([
    { season: "2025", tier: "Division 2", status: "completed" },
    { season: "2026", tier: "Division 1", status: "completed" },
    { season: "2026", tier: "Division 3", status: "completed" },
  ]);
  expect(parallel.steps.map((step) => step.note)).toEqual(["", "", ""]);
  expect(leaguePath([{ season: "1", status: "completed" }]).summary).toBe("1 Saison");
});

// ---------------------------------------------------------------- Ehrentafel

test("Ehrentafel: Medaillen aus der Bilanz, laufende Saisons und Aufstiege aus den Spuren, seit dem ersten Jahr", () => {
  const stats = honorStats({
    summary: { gold: 3, silver: 2, bronze: 1, total: 12, games: 6 },
    items: [ref("a", "2024-05-01", 1), ref("b", "2023-12-02", 2), ref("c", null, 3)],
    lineages: [
      { seasons: [{ season: "2024", tier: "Liga 2", status: "completed" }, { season: "2025", tier: "Liga 1", status: "active" }] },
      { seasons: [{ season: "2026", tier: "Division 2", status: "active" }] },
    ],
  });
  expect(stats).toEqual({ gold: 3, silver: 2, bronze: 1, total: 12, games: 6, running: 2, promotions: 1, since: "2023" });
  expect(honorStats({ summary: {}, items: [], lineages: [] })).toEqual({ gold: 0, silver: 0, bronze: 0, total: 0, games: 0, running: 0, promotions: 0, since: "" });
});

// ---------------------------------------------------------------- Läuft gerade

test("Läuft gerade: Fortschritt, Termin und Platz in der Sprache der Art", () => {
  expect(progressText("racing", 6, 10)).toBe("6 von 10 Rennen gewertet");
  expect(progressText("team_league", 3, 7)).toBe("3 von 7 Spieltagen gespielt");
  expect(progressText("team_league", 0, 1)).toBe("0 von 1 Spieltag gespielt");
  expect(progressText("series", 2, 5)).toBe("2 von 5 Turnieren gewertet");
  expect(progressText("series", 1, 1)).toBe("1 von 1 Turnier gewertet");
  expect(nextTitle("racing", { state: "today" })).toBe("Heute");
  expect(nextTitle("racing", { state: "planned" })).toBe("Nächstes Rennen");
  expect(nextTitle("team_league", { state: "planned" })).toBe("Nächster Spieltag");
  expect(nextTitle("series", { state: "postponed" })).toBe("Nächstes Turnier");
  expect(nextTitle("series", null)).toBe("Nächster Termin");
  expect(nextValue({ state: "today", code: "R7", time: "20:30", club_day: "2026-11-09" })).toBe("R7 · 20:30");
  expect(nextValue({ state: "planned", code: "ST4", time: "20:00", club_day: "2026-10-22" })).toBe("Do 22.10. · 20:00 · ST4");
  expect(nextValue({ state: "planned", title: "Finale", time: null, club_day: "2026-10-24" })).toBe("Sa 24.10. · Finale");
  expect(nextValue(null)).toBe("Kein Termin offen");
  // Rennwochenende (#1930): der nächste Lauf.
  expect(nextValue({ state: "today", code: "R3", session: "Qualifying", time: "20:00", club_day: "2026-11-09" })).toBe("R3 · Qualifying · 20:00");
  expect(placeTitle("racing")).toBe("Bester Fahrer");
  expect(placeTitle("team_league")).toBe("Tabelle");
  expect(placeTitle("series")).toBe("Gesamtwertung");
});
