import { memberPaths, profileGroups, profileHead, profileRows } from "./profileReferences";
import type { ClubReference, LineageItem } from "./references";
import type { PersonalReferenceItem } from "../types";

// Profil-Reiter „Referenzen“ in der App (#1945, wie das Mitgliederprofil im Web #1944): eine Chronik je Jahr aus den
// Vereinsplatzierungen (externe Turniere und Ligen, in denen die Person in der Aufstellung steht) und den eigenen
// Turnieren und Fast Laps der Plattform. Kopf ohne Nullen. Nur erfundene Namen.

const ME = "p-mira";
const club = (id: string, start: string, placement: number | null, lineup: string[], extra: Partial<ClubReference> = {}): ClubReference => ({
  id, title: id, start_date: start, best_placement: placement, game_name: "Black Ops 6",
  entries: [{ id: `${id}-e`, kind: "team", team_name: "Lions Probe", placement, team_count: 8, lineup_members: lineup.map((name) => ({ profile_id: name === "Mira Stahl" ? ME : `p-${name}`, display_name: name })), lineup: ["Gast Ohne Profil"] }],
  member_profile_ids: [ME],
  ...extra,
});
const personal = (id: string, kind: string, rank: number | null, date: string, extra: Partial<PersonalReferenceItem> = {}): PersonalReferenceItem => ({ id, kind, title: `Cup ${id}`, subtitle: "Mario Kart 8", rank, date, target_id: `t-${id}`, participant_count: 16, ...extra });

const lineages: LineageItem[] = [{
  lineage: { slug: "desbl", title: "DeSBL S&D 4vs4", kind: "team_league" },
  seasons: [
    { season: "Mai 2025", tier: "League A", status: "completed", season_slug: "a", reference_ids: ["league-a"] },
    { season: "Season 4", tier: "2. Liga", status: "completed", season_slug: "s4", reference_ids: ["liga2"], season_result: "promoted" },
    { season: "Season 5", tier: "1. Liga", status: "completed", season_slug: "s5", reference_ids: ["andere"] },
    { season: "Season 6", tier: "1. Liga", status: "active", season_slug: "s6", reference_ids: ["laeuft"] },
  ],
}];

test("Zeilen: Vereinsplatzierung mit eigenem Platz, Team, Feld und Aufstellung - die Person hervorgehoben", () => {
  const rows = profileRows({ club: [club("liga2", "2025-06-18T18:00:00Z", 5, ["Kai Funke", "Mira Stahl"], { display_title: "DeSBL · 2. Liga · S4" })], memberId: ME, lineages });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: "club:liga2", source: "club", placement: 5, title: "DeSBL · 2. Liga · S4", sub: "Black Ops 6 · 18.06.2025",
    detail: "Lions Probe · von 8 Teams", year: "2025", season: { lineage: "desbl", season: "s4" }, referenceId: "liga2",
  });
  expect(rows[0].lineup).toEqual([{ name: "Kai Funke", me: false }, { name: "Mira Stahl", me: true }, { name: "Gast Ohne Profil", me: false }]);
});

test("Zeilen: eigene Turniere und Fast Laps kommen dazu, die Chronik steht je Jahr, neueste zuerst", () => {
  const rows = profileRows({
    personal: [personal("cup", "tournament", 2, "2026-03-01T10:00:00Z"), personal("lap", "fastlap", 7, "2025-02-01T10:00:00Z", { subtitle: "Monza", time_str: "1:21.234" })],
    club: [club("league-a", "2025-05-19T18:00:00Z", 4, ["Mira Stahl"])],
    memberId: ME,
    lineages,
  });
  expect(rows.map((row) => row.id)).toEqual(["personal:cup", "club:league-a", "personal:lap"]);
  const lap = rows.find((row) => row.id === "personal:lap");
  expect(lap).toMatchObject({ source: "fastlap", placement: 7, sub: "Monza · 1:21,234 · 01.02.2025", detail: "von 16" });
  const groups = profileGroups(rows);
  expect(groups.map((group) => [group.label, group.count, group.rows.map((row) => row.id)])).toEqual([
    ["2026", "1 Teilnahme", ["personal:cup"]],
    ["2025", "2 Teilnahmen", ["club:league-a", "personal:lap"]],
  ]);
});

test("Einsätze der Person (#1931): „5 von 7 Spielen“, „3 von 5 Rennen“ - ohne Angabe (alter Server) leer", () => {
  const rows = profileRows({
    club: [
      club("liga2", "2025-06-18T18:00:00Z", 5, ["Mira Stahl"], { appearances: { played: 5, of: 7, unit: "matches", team: "Lions Probe" } }),
      club("rennen", "2025-07-18T18:00:00Z", 3, ["Mira Stahl"], { appearances: { played: 3, of: 5, unit: "races" } }),
      club("eins", "2025-08-18T18:00:00Z", 2, ["Mira Stahl"], { appearances: { played: 1, of: 1, unit: "rounds" } }),
      club("leer", "2025-09-18T18:00:00Z", 2, ["Mira Stahl"], { appearances: { played: 0, of: 0 } }),
      club("alt", "2025-10-18T18:00:00Z", 2, ["Mira Stahl"]),
    ],
    memberId: ME,
    lineages,
  });
  const played = Object.fromEntries(rows.map((row) => [row.id, row.played]));
  expect(played).toEqual({ "club:liga2": "5 von 7 Spielen", "club:rennen": "3 von 5 Rennen", "club:eins": "1 von 1 Runde", "club:leer": "", "club:alt": "" });
  expect(profileRows({ personal: [personal("cup", "tournament", 2, "2026-03-01T10:00:00Z")] })[0].played).toBe("");
});

test("eine Teilnahme ohne die Person zählt nicht - auch wenn sie am Verein hängt", () => {
  const other = club("andere", "2025-08-20T18:00:00Z", 5, ["Kai Funke"], { member_profile_ids: ["p-Kai"] });
  expect(profileRows({ club: [other], memberId: ME, lineages })).toEqual([]);
});

test("Kopf ohne Nullen: ohne Podest das beste Ergebnis, sonst nur die vorhandenen Medaillen", () => {
  const rows = profileRows({
    club: [club("league-a", "2025-05-19T18:00:00Z", 4, ["Mira Stahl"], { display_title: "DeSBL · League A" }), club("liga2", "2025-06-18T18:00:00Z", 5, ["Mira Stahl"])],
    memberId: ME,
    lineages,
  });
  const head = profileHead(rows);
  expect(head.medals).toEqual([]);
  expect(head.best).toEqual({ placement: 4, title: "DeSBL · League A", sub: "Mai 2025 · von 8 Teams" });
  expect(head.facts).toEqual([{ key: "total", value: "2", label: "Teilnahmen" }, { key: "games", value: "1", label: "Spiel" }, { key: "since", value: "2025", label: "dabei seit" }]);

  const podium = profileHead(profileRows({ personal: [personal("cup", "tournament", 1, "2026-03-01T10:00:00Z"), personal("cup2", "tournament", 3, "2024-03-01T10:00:00Z")] }));
  expect(podium.best).toBeNull();
  expect(podium.medals).toEqual([{ key: "gold", label: "Gold", count: 1 }, { key: "bronze", label: "Bronze", count: 1 }]);
  // Plattform-Turniere tragen kein Spiel - also keine „0 Spiele“.
  expect(podium.facts.map((fact) => fact.key)).toEqual(["total", "since"]);

  const empty = profileHead([]);
  expect(empty).toEqual({ medals: [], best: null, facts: [] });
});

test("Liga-Weg der Person: nur Saisons mit eigener Teilnahme, ab zwei Saisons, mit eigenem Platz und Vermerk der Spur", () => {
  const items = [
    club("league-a", "2025-05-19T18:00:00Z", 4, ["Mira Stahl"]),
    club("liga2", "2025-06-18T18:00:00Z", 5, ["Mira Stahl"]),
    club("andere", "2025-08-20T18:00:00Z", 5, ["Kai Funke"], { member_profile_ids: ["p-Kai"] }),
    club("laeuft", "2026-05-06T18:00:00Z", 6, ["Mira Stahl"]),
  ];
  const paths = memberPaths(lineages, items, ME);
  expect(paths).toHaveLength(1);
  expect(paths[0].title).toBe("DeSBL S&D 4vs4");
  expect(paths[0].lineage).toBe("desbl");
  expect(paths[0].tiles.map((tile) => [tile.season, tile.tier, tile.result, tile.tone])).toEqual([
    ["Mai 2025", "League A", "4. Platz", "plain"],
    ["Season 4", "2. Liga", "5. · Aufstieg", "up"],
    ["Season 6", "1. Liga", "6. · läuft", "current"],
  ]);
  // Nur eine Saison: kein Weg.
  expect(memberPaths(lineages, [items[0]], ME)).toEqual([]);
  expect(memberPaths(undefined, items, ME)).toEqual([]);
});
