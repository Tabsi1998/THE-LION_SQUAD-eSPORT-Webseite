import { shortTitle } from "@/components/tls/references/referenceParts";
import {
  bestResult,
  detailsOf,
  fieldSize,
  formatTags,
  lineupOf,
  memberPaths,
  monthOf,
  organizerUrl,
  ownEntry,
  profileFacts,
  profileMedals,
} from "./memberReferences";

// Vereinsplatzierungen im Mitgliederprofil (#1944): Kopf nur mit Werten über null, kurzer Titel, Liga-Weg der Person
// und die Angaben der aufklappbaren Zeile. Nur erfundene Namen.

const member = (id, name, slug) => ({ profile_id: id, display_name: name, profile_url: slug ? `/members/${slug}` : null });
const NOVA = member("p-nova", "NovaKessel", "nova-kessel");
const KAI = member("p-kai", "KaiFunke", "kai-funke");
const LEA = member("p-lea", "LeaBrandt", null);

const entry = (id, placement, extra = {}) => ({ id, kind: "team", team_name: "Lions", placement, member_profile_ids: ["p-nova"], lineup_members: [NOVA, KAI], lineup: [], ...extra });
const ref = (id, start, placement, extra = {}) => {
  const own = entry(`${id}-e`, placement, extra.entry);
  return { id, title: `${id} TITEL`, display_title: `${id} TITEL`, start_date: start, entries: [own], member_entry: own, ...extra };
};

// ---------------------------------------------------------------- kurzer Titel

test("shortTitle: „Veranstalter · Liga · Saison“ aus den Feldern, ohne Liga bleibt der Titel", () => {
  const league = { display_title: "SEASON #3 POWERED BY NORDLICHT® NEWCOMER LEAGUE I", organizer: "NSDL", league: "Newcomer League I", season: "Season 3" };
  expect(shortTitle(league)).toBe("NSDL · Newcomer League I · Season 3");
  expect(shortTitle({ ...league, organizer: "" })).toBe("Newcomer League I · Season 3");
  expect(shortTitle({ display_title: "Ranked Night #4", organizer: "Ranked Nights" })).toBe("Ranked Night #4");
  // Gleiche Teile nur einmal (Groß/klein egal).
  expect(shortTitle({ organizer: "Liga X", league: "liga x", season: "2026" })).toBe("Liga X · 2026");
  // Ohne Liga oder mit nur einer Angabe bleibt der Titel: „Probe Cups · Season 2“ statt „Herbst Cup“ wäre schlechter.
  expect(shortTitle({ display_title: "Herbst Cup", season: "Season 2" })).toBe("Herbst Cup");
  expect(shortTitle({ display_title: "Herbst Cup", organizer: "Probe Cups", season: "Season 2" })).toBe("Herbst Cup");
  expect(shortTitle({ display_title: "Herbst Cup", league: "Liga X" })).toBe("Herbst Cup");
  expect(shortTitle({ display_title: "Herbst Cup", organizer: "ESL", league: "esl", season: "" })).toBe("Herbst Cup");
});

test("shortTitle: mit Saison (#1750) gelten Stufe und Saison der Serie, der Veranstalter notfalls aus der Spur", () => {
  const link = { lineage: { organizer: "NSDL" }, season: { season: "BO7 Season 3", tier: "Newcomer League I" } };
  expect(shortTitle({ display_title: "Langer Titel", league: "NEWCOMER I", season: "S3" }, link)).toBe("NSDL · Newcomer League I · BO7 Season 3");
});

test("shortTitle ohne Saison: „Serie bzw. Liga“ für das beste Ergebnis", () => {
  expect(shortTitle({ organizer: "NSDL", league: "League A", season: "Season 3" }, null, { withSeason: false })).toBe("NSDL · League A");
  expect(shortTitle({ organizer: "Lion Racing Cup", league: "Division 1", season: "2026" }, null, { withSeason: false })).toBe("Lion Racing Cup · Division 1");
  // Ohne Veranstalter reicht die Liga allein nicht - dann mit Saison.
  expect(shortTitle({ league: "Division 1", season: "2026" }, null, { withSeason: false })).toBe("Division 1 · 2026");
  expect(shortTitle({ display_title: "Autumn Cup", organizer: "Kartwerk" }, null, { withSeason: false })).toBe("Autumn Cup");
  expect(shortTitle({ display_title: "Autumn Cup", organizer: "Kartwerk", season: "2026" }, null, { withSeason: false })).toBe("Autumn Cup");
});

// ---------------------------------------------------------------- Kopf

test("profileMedals: nur Medaillen über null, in der Reihenfolge Gold, Silber, Bronze", () => {
  expect(profileMedals({ gold: 0, silver: 0, bronze: 0 })).toEqual([]);
  expect(profileMedals({ gold: 0, silver: 1, bronze: 2 }).map((medal) => [medal.placement, medal.label, medal.count])).toEqual([[2, "Silber", 1], [3, "Bronze", 2]]);
  expect(profileMedals(undefined)).toEqual([]);
});

test("bestResult: der kleinste eigene Platz, bei Gleichstand der neueste; ohne Platz nichts", () => {
  const items = [ref("a", "2024-09-14", 4), ref("b", "2025-05-19", 4), ref("c", "2025-08-20", 5), ref("d", "2025-01-01", null)];
  const best = bestResult(items);
  expect(best.item.id).toBe("b");
  expect(best.placement).toBe(4);
  expect(best.entry.id).toBe("b-e");
  expect(bestResult([ref("x", "2025-01-01", null)])).toBeNull();
  expect(bestResult([])).toBeNull();
});

test("profileFacts: Teilnahmen, Spiele und „seit“ - nur Werte über null", () => {
  const items = [
    ref("a", "2025-05-19", 4, { game_id: "g1" }),
    ref("b", "2024-09-14", 6, { game: { id: "g2" } }),
    ref("c", "2026-01-01", 2, { game_id: "g1" }),
  ];
  expect(profileFacts(items).map((fact) => `${fact.value} ${fact.label}`)).toEqual(["3 Teilnahmen", "2 Spiele", "seit 2024 für den Verein"]);
  // Ohne Spiel und ohne Datum fehlen die Zahlen, statt „0 Spiele“ zu zeigen.
  expect(profileFacts([ref("x", null, 1)]).map((fact) => `${fact.value} ${fact.label}`)).toEqual(["1 Teilnahme"]);
});

test("monthOf und fieldSize: „Mai 2025“ und „von N Teams“ bzw. „von N Teilnehmern“", () => {
  expect(monthOf({ start_date: "2025-05-19" })).toBe("Mai 2025");
  expect(monthOf({ start_date: null })).toBe("");
  expect(fieldSize({ team_count: 7 })).toBe("von 7 Teams");
  expect(fieldSize({ kind: "solo", participant_count: 20 })).toBe("von 20 Teilnehmern");
  expect(fieldSize({})).toBe("");
  expect(fieldSize(null)).toBe("");
});

// ---------------------------------------------------------------- Zeile und Details

test("ownEntry: der eigene Eintrag vom Server, sonst der erste", () => {
  const item = ref("a", "2025-01-01", 3);
  expect(ownEntry(item).id).toBe("a-e");
  expect(ownEntry({ entries: [{ id: "x" }] }).id).toBe("x");
  expect(ownEntry({})).toBeNull();
});

test("formatTags: Format, Plattformen und der Modus vor Ort - Liga und Saison stehen schon im Titel", () => {
  const item = { format: "S&D 4vs4 HC", platforms: ["ALL"], reference_meta: { platforms: [{ key: "ALL", label: "Alle Plattformen" }] }, league: "League A", season: "Season 3", mode: "online" };
  expect(formatTags(item)).toEqual(["S&D 4vs4 HC", "Alle Plattformen"]);
  expect(formatTags({ ...item, mode: "offline" })).toEqual(["S&D 4vs4 HC", "Alle Plattformen", "Vor Ort"]);
  expect(formatTags({ mode: "hybrid" })).toEqual(["Hybrid"]);
  expect(formatTags({})).toEqual([]);
});

test("lineupOf: jede Person einmal, die Person selbst markiert, Profil-Links bleiben", () => {
  const own = entry("e", 5, { lineup_members: [KAI, NOVA, LEA], lineup: ["Gast Eins", "KaiFunke"] });
  expect(lineupOf(own, "p-nova")).toEqual([
    { key: "p-kai", name: "KaiFunke", url: "/members/kai-funke", self: false },
    { key: "p-nova", name: "NovaKessel", url: "/members/nova-kessel", self: true },
    { key: "p-lea", name: "LeaBrandt", url: null, self: false },
    { key: "Gast Eins", name: "Gast Eins", url: null, self: false },
  ]);
  expect(lineupOf(null, "p-nova")).toEqual([]);
});

test("organizerUrl: Turnierseite, sonst Ergebnis, sonst Bracket", () => {
  expect(organizerUrl({ external_url: "https://a.example", result_url: "https://b.example" })).toBe("https://a.example/");
  expect(organizerUrl({ result_url: "https://b.example", bracket_url: "https://c.example" })).toBe("https://b.example/");
  expect(organizerUrl({ bracket_url: "https://c.example" })).toBe("https://c.example/");
  expect(organizerUrl({})).toBe("");
});

test("detailsOf: langer Titel nur, wenn er vom kurzen abweicht; Aufstellung nur im Team; Saison-Link nur mit Saison; Details immer", () => {
  const item = { ...ref("a", "2025-01-01", 6), display_title: "SEASON #3 POWERED BY NORDLICHT®", organizer: "NSDL", league: "Newcomer League I", season: "Season 3", format: "HC", external_url: "https://a.example" };
  const link = { lineage: { slug: "nsdl-sd" }, season: { season: "Season 3", tier: "Newcomer League I", season_slug: "s3-newcomer" } };
  const details = detailsOf(item, "p-nova", link);
  expect(details.fullTitle).toBe("SEASON #3 POWERED BY NORDLICHT®");
  expect(details.tags).toEqual(["HC"]);
  expect(details.lineup.map((person) => person.name)).toEqual(["NovaKessel", "KaiFunke"]);
  expect(details.seasonUrl).toBe("/references/series/nsdl-sd/s3-newcomer");
  expect(details.detailUrl).toBe("/references/a");
  expect(details.organizerUrl).toBe("https://a.example/");

  // Bericht, Partner und Ort stehen auf der Detailseite - der Link dorthin fehlt nie.
  const plain = detailsOf({ ...ref("b", "2025-01-01", 1, { entry: { kind: "solo", lineup_members: [NOVA] } }), display_title: "Autumn Cup" }, "p-nova", null);
  expect(plain.fullTitle).toBe("");
  expect(plain.lineup).toEqual([]);
  expect(plain.seasonUrl).toBe("");
  expect(plain.detailUrl).toBe("/references/b");
});

// ---------------------------------------------------------------- Liga-Weg der Person

const LINEAGE = {
  lineage: { title: "NSDL S&D 4vs4", slug: "nsdl-sd", kind: "team_league", tier_order: null },
  seasons: [
    { season: "Season 2", tier: "League B", season_slug: "s2", status: "completed", club: { rank: 1, of: 6 }, reference_ids: ["fremd"] },
    { season: "Season 3", tier: "League A", season_slug: "s3", status: "completed", club: { rank: 4, of: 7 }, reference_ids: ["a"] },
    { season: "Season 4", tier: "2. Liga", season_slug: "s4", status: "completed", season_result: "promoted", club: { rank: 3, of: 9 }, reference_ids: ["b"] },
    { season: "Season 5", tier: "1. Liga", season_slug: "s5", status: "active", club: null, reference_ids: ["c"] },
  ],
};

test("memberPaths: je Spur nur die Saisons der Person, mit ihrem eigenen Platz und dem Vermerk der Saison", () => {
  const items = [ref("a", "2025-05-19", 4), ref("b", "2025-06-18", 5), ref("c", "2025-08-20", null)];
  const [path, ...rest] = memberPaths([LINEAGE, { lineage: { slug: "andere" }, seasons: [{ season: "1", reference_ids: ["zzz"] }] }], items);
  expect(rest).toEqual([]);
  expect(path.lineage.slug).toBe("nsdl-sd");
  expect(path.steps.map((step) => [step.season, step.tier, step.place, step.note])).toEqual([
    ["Season 3", "League A", 4, ""],
    // Der eigene Platz (5.) gilt vor dem Platz des Vereins (3.).
    ["Season 4", "2. Liga", 5, "Aufstieg"],
    ["Season 5", "1. Liga", null, "läuft"],
  ]);
  expect(path.target.season_slug).toBe("s5");
  expect(path.address).toBe("/references/series/nsdl-sd/s5");
});

test("memberPaths: ohne verknüpfte Saison kein Liga-Weg", () => {
  expect(memberPaths([LINEAGE], [ref("x", "2025-01-01", 2)])).toEqual([]);
  expect(memberPaths([], [ref("a", "2025-01-01", 2)])).toEqual([]);
  expect(memberPaths(undefined, undefined)).toEqual([]);
});

test("organizerUrl: nur http(s) - javascript: und ftp: fallen weg, der nächste sichere Link zählt", () => {
  expect(organizerUrl({ external_url: "javascript:alert(1)", result_url: "ftp://x.example/a", bracket_url: "https://c.example/b" })).toBe("https://c.example/b");
  expect(organizerUrl({ external_url: "javascript:alert(1)" })).toBe("");
});
