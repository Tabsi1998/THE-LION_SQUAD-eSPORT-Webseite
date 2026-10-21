import { countFieldErrors, emptyMap, emptyMatch, fieldErrors, formToPayload, sheetToForm } from "@/lib/referenceResults";
import { parseMatchdayPaste } from "@/lib/matchdayPaste";
import { parseLineupPaste } from "@/lib/lineupPaste";
import {
  applyLineupPaste, applyMatchday, appearancesText, isOwnMatch, ownTeamMatcher, pickMatchday, rosterFor, setMapLineup,
  toggleLineup, toggleMatchLineup,
} from "@/lib/teamLeagueEntry";

// Team-Liga einfacher eintragen (#1931): eigenes Spiel erkennen, Begegnungsliste ins Formular, Kader als Ankreuzliste,
// Maps im Veto mit Rolle, wer und Aufstellung je Map. Nur erfundene Namen.

const OWN = [{ name: "Probe Löwen", aliases: ["TLS Probe"] }, { name: "Probe Löwen B", aliases: [] }];
const PEOPLE = [
  { id: "p-anna", name: "Anna", default_team: "Probe Löwen", kind: "person" },
  { id: "p-bert", name: "Bert", default_team: "probe-löwen", kind: "person" },
  { id: "p-cleo", name: "Cleo", default_team: "Probe Löwen B", kind: "person" },
  { id: "p-dora", name: "Dora", default_team: "", kind: "person" },
  { id: "t-fremd", name: "Probe Falken", default_team: "Probe Löwen", kind: "team" },
];

test("eigene Teams: Name und Schreibweise wörtlich, eine andere Schreibweise nur eindeutig", () => {
  const own = ownTeamMatcher(OWN);
  expect(own("Probe Löwen")).toBe("Probe Löwen");
  expect(own("tls probe")).toBe("Probe Löwen");
  expect(own("PROBE-LÖWEN-B")).toBe("Probe Löwen B");
  expect(own("Probe Falken")).toBeNull();
  expect(isOwnMatch({ home: "Probe Adler", away: "TLS Probe" }, own)).toBe(true);
  expect(isOwnMatch({ home: "Probe Adler", away: "Probe Eulen" }, own)).toBe(false);
});

test("Kader: Personen mit einem eigenen Team, auch in anderer Schreibweise, nach Namen", () => {
  const own = ownTeamMatcher(OWN);
  expect(rosterFor(PEOPLE, "Probe Löwen", own).map((person) => person.id)).toEqual(["p-anna", "p-bert"]);
  expect(rosterFor(PEOPLE, "Probe Löwen B", own).map((person) => person.id)).toEqual(["p-cleo"]);
});

test("Aufstellung als Ankreuzliste: an und wieder ab", () => {
  const once = toggleLineup([], PEOPLE[0]);
  expect(once).toEqual([{ participant_id: "p-anna", name: "Anna" }]);
  expect(toggleLineup(once, PEOPLE[0])).toEqual([]);
});

test("Begegnungsliste: das eigene Spiel wird erkannt und ausgefüllt, die übrigen mit Ergebnis kommen dazu", () => {
  const form = sheetToForm(null, PEOPLE, { kind: "team_league", teamName: "Probe Löwen", opponent: "Probe Falken" });
  form.matches[0].maps = [{ ...emptyMap(), name: "Karte Nord" }];
  const pasted = parseMatchdayPaste([
    "13.05.2026 20:30;Probe Adler;Probe Eulen;0:2",
    "14.05.2026 21:15;Probe Falken;TLS Probe;1:2",
    "15.05.2026;Probe Wölfe;Probe Bären;-:-",
  ].join("\n")).rows;
  const result = applyMatchday(form, pasted, { ownTeams: OWN, keepOthers: true });
  expect(result.own).toMatchObject({ home: "Probe Falken", away: "TLS Probe" });
  expect(result.others).toBe(1);
  expect(result.open).toBe(1);
  const [own, other] = result.form.matches;
  expect(own).toMatchObject({ home: "Probe Falken", away: "TLS Probe", home_score: "1", away_score: "2", day: "2026-05-14", time: "21:15" });
  expect(own.maps.map((item) => item.name)).toEqual(["Karte Nord"]);
  expect(other).toMatchObject({ home: "Probe Adler", away: "Probe Eulen", home_score: "0", away_score: "2" });
  expect(result.form.matches).toHaveLength(2);

  const without = applyMatchday(result.form, pasted, { ownTeams: OWN, keepOthers: false });
  expect(without.form.matches).toHaveLength(1);
  const none = applyMatchday(form, parseMatchdayPaste("Probe Adler;Probe Eulen;0:2").rows, { ownTeams: OWN, keepOthers: true });
  expect(none.own).toBeNull();
  expect(none.owns).toEqual([]);
});

test("zwei eigene Teams am selben Spieltag (Prüfung #1931): beide eigenen Spiele erkannt, keines unter den übrigen", () => {
  const form = sheetToForm(null, PEOPLE, { kind: "team_league", teamName: "Probe Löwen", opponent: "Probe Adler" });
  const pasted = parseMatchdayPaste([
    "10.06.2026 20:30;Probe Löwen B;Probe Adler;2:1",
    "11.06.2026 20:30;Probe Eulen;Probe Löwen;0:2",
    "12.06.2026 20:30;Probe Wölfe;Probe Bären;1:1",
  ].join("\n")).rows;
  const result = applyMatchday(form, pasted, { ownTeams: OWN, keepOthers: true });
  expect(result.owns.map((row) => [row.home, row.away])).toEqual([["Probe Löwen B", "Probe Adler"], ["Probe Eulen", "Probe Löwen"]]);
  expect(result.others).toBe(1);
  const own = ownTeamMatcher(OWN);
  expect(result.form.matches.filter((match) => isOwnMatch(match, own)).map((match) => [match.home, match.away, match.home_score])).toEqual([
    ["Probe Löwen B", "Probe Adler", "2"], ["Probe Eulen", "Probe Löwen", "0"]]);
  expect(result.form.matches).toHaveLength(3);
});

test("Maps im Veto (Rolle, wer, Kennung, Aufstellung je Map) gehen in den Vertrag – ohne Angaben bleibt das Spiel wie bisher", () => {
  const match = { ...emptyMatch({ home: "Probe Löwen", away: "Probe Falken" }), home_score: "2", away_score: "1", day: "2026-05-14", time: "21:15" };
  match.maps = [
    emptyMap({ name: "Karte Ost", role: "banned", by: "opponent", home_score: "3", lineup: [{ participant_id: "p-anna", name: "Anna" }] }),
    emptyMap({ name: "Karte Nord", map_id: "map-nord", home_score: "6", away_score: "3", role: "picked", by: "own", lineup: [{ participant_id: "p-anna", name: "Anna" }] }),
    emptyMap({ name: "Karte Süd", home_score: "6", away_score: "4", role: "decider", by: "own" }),
    emptyMap({ name: "Karte West", home_score: "2", away_score: "6" }),
  ];
  match.lineup = [{ participant_id: "p-bert", name: "Bert" }];
  match.perMap = true;
  const { payload } = formToPayload({ rows: [], matches: [match], table: [], note: "" });
  expect(payload.matches[0]).toEqual({
    home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 1, day: "2026-05-14", time: "21:15",
    maps: [
      { name: "Karte Ost", role: "banned", by: "opponent" },
      { name: "Karte Nord", map_id: "map-nord", role: "picked", by: "own", home_score: 6, away_score: 3, lineup: [{ participant_id: "p-anna" }] },
      { name: "Karte Süd", role: "decider", home_score: 6, away_score: 4 },
      { name: "Karte West", home_score: 2, away_score: 6 },
    ],
    lineup: [{ participant_id: "p-bert" }],
  });
  // Eine gesperrte Map ohne Ergebnis ist kein Fehler.
  expect(countFieldErrors(fieldErrors({ rows: [], matches: [{ ...match, maps: [emptyMap({ name: "Karte Ost", role: "banned" })] }] }))).toBe(0);

  const back = sheetToForm({ matches: [{ ...payload.matches[0], club_day: "2026-05-14", lineup: ["p-bert", "p-anna"],
    maps: [{ name: "Karte Ost", role: "banned", by: "opponent" }, { name: "Karte Nord", map_id: "map-nord", role: "picked", by: "own", home_score: 6, away_score: 3, lineup: ["p-anna"] }] }] }, PEOPLE);
  expect(back.matches[0]).toMatchObject({ day: "2026-05-14", time: "21:15", perMap: true });
  expect(back.matches[0].maps[0]).toMatchObject({ name: "Karte Ost", role: "banned", by: "opponent" });
  expect(back.matches[0].maps[1]).toMatchObject({ map_id: "map-nord", role: "picked", by: "own", lineup: [{ participant_id: "p-anna", name: "Anna" }] });
});

test("Map ohne Ergebnis (Prüfung #1931): gespielt braucht beide Stände, Wahl und Decider bleiben leer statt 0:0", () => {
  const match = { ...emptyMatch({ home: "Probe Löwen", away: "Probe Falken" }), home_score: "2", away_score: "0" };
  const played = emptyMap({ name: "Karte West" });
  const half = emptyMap({ name: "Karte Süd", role: "picked", by: "own", home_score: "6" });
  const decider = emptyMap({ name: "Karte Nord", role: "decider" });
  const withLineup = emptyMap({ name: "Karte Ost", role: "picked", by: "opponent", lineup: [{ participant_id: "p-anna", name: "Anna" }] });
  const errors = fieldErrors({ rows: [], matches: [{ ...match, perMap: true, maps: [played, half, decider, withLineup] }] });
  expect(errors[played.key]).toEqual({ home_score: "Stand fehlt.", away_score: "Stand fehlt." });
  expect(errors[half.key]).toEqual({ away_score: "Beide Stände oder keiner." });
  expect(errors[decider.key]).toBeUndefined();
  expect(errors[withLineup.key]).toEqual({ lineup: "Aufstellung je Map nur mit dem Ergebnis der Map." });

  const { payload } = formToPayload({ rows: [], matches: [{ ...match, maps: [
    emptyMap({ name: "Karte Ost", role: "picked", by: "own", home_score: "6", away_score: "2" }),
    emptyMap({ name: "Karte Süd", role: "picked", by: "opponent", home_score: "6", away_score: "3" }), decider,
  ] }], table: [], note: "" });
  expect(payload.matches[0].maps.at(-1)).toEqual({ name: "Karte Nord", role: "decider" });
});

test("Aufstellung je Map: die Person kommt in die Map und bleibt im Spiel", () => {
  const match = { ...emptyMatch({ home: "Probe Löwen", away: "Probe Falken" }), maps: [{ ...emptyMap(), name: "Karte Nord" }] };
  const next = setMapLineup(match, match.maps[0].key, PEOPLE[0]);
  expect(next.maps[0].lineup).toEqual([{ participant_id: "p-anna", name: "Anna" }]);
  expect(next.lineup).toEqual([{ participant_id: "p-anna", name: "Anna" }]);
  const off = setMapLineup(next, match.maps[0].key, PEOPLE[0]);
  expect(off.maps[0].lineup).toEqual([]);
});

test("Aufstellung im Spiel abwählen (Prüfung #1931): die Person fällt auch aus allen Maps, auch beim Einfügen", () => {
  const anna = { participant_id: "p-anna", name: "Anna" };
  const bert = { participant_id: "p-bert", name: "Bert" };
  const match = { ...emptyMatch({ home: "Probe Löwen", away: "Probe Falken" }), lineup: [anna, bert], maps: [
    emptyMap({ name: "Karte Nord", lineup: [anna, bert] }), emptyMap({ name: "Karte Süd", lineup: [anna] })] };
  const off = toggleMatchLineup(match, PEOPLE[0]);
  expect(off.lineup).toEqual([bert]);
  expect(off.maps.map((item) => item.lineup)).toEqual([[bert], []]);
  // Ankreuzen im Spiel ändert die Maps nicht.
  const on = toggleMatchLineup(off, PEOPLE[0]);
  expect(on.lineup).toEqual([bert, anna]);
  expect(on.maps.map((item) => item.lineup)).toEqual([[bert], []]);

  const pasted = applyLineupPaste(match, parseLineupPaste("Seasonteam-Mitglieder\tWarorga\nAnna\t-\nBert\t✓"), PEOPLE, []);
  expect(pasted.match.lineup).toEqual([bert]);
  expect(pasted.match.maps.map((item) => item.lineup)).toEqual([[bert], []]);
});

test("mehrere Spieltage eingefügt: der zum Termin passende über Nummer, Zeitraum oder Tag", () => {
  const days = [
    { number: 1, from: "2026-06-10", to: "2026-06-14", rows: [{ day: "2026-06-10" }] },
    { number: 2, from: "2026-06-17", to: "2026-06-21", rows: [{ day: "2026-06-17" }] },
  ];
  expect(pickMatchday(days, { code: "ST2", position: 5 })).toBe(days[1]);
  expect(pickMatchday(days, { code: "", position: 1 })).toBe(days[0]);
  expect(pickMatchday(days, { code: "Finale", club_day: "2026-06-19" })).toBe(days[1]);
  const plain = [{ number: null, from: "", to: "", rows: [{ day: "2026-06-11" }] }, { number: null, from: "", to: "", rows: [{ day: "2026-06-18" }] }];
  expect(pickMatchday(plain, { code: "X", club_day: "2026-06-18" })).toBe(plain[1]);
  expect(pickMatchday(plain.slice(0, 1), { code: "ST9" })).toBe(plain[0]);
  expect(pickMatchday([], { code: "ST1" })).toBeNull();
});

test("Aufstellung eingefügt: Häkchen setzen und nehmen, Namen ohne Kader bleiben zur Auswahl", () => {
  const own = ownTeamMatcher(OWN);
  const roster = rosterFor(PEOPLE, "Probe Löwen", own);
  const match = { ...emptyMatch({ home: "Probe Löwen", away: "Probe Falken" }), lineup: [{ participant_id: "p-bert", name: "Bert" }] };
  const marked = applyLineupPaste(match, parseLineupPaste("Seasonteam-Mitglieder\tWarorga\nanna\t✓\nBert\t-\nNeu Nora\tx\nDora\t"), PEOPLE, roster);
  expect(marked.match.lineup).toEqual([{ participant_id: "p-anna", name: "Anna" }, { participant_id: "", name: "Neu Nora" }]);
  expect(marked.marked).toBe(true);
  // Wer nicht im Kader steht, kommt zur Ankreuzliste dazu.
  expect(marked.extra.map((person) => person.name)).toEqual(["Neu Nora", "Dora"]);

  const lost = applyLineupPaste(match, parseLineupPaste("Seasonteam-Mitglieder\tWarorga\nAnna\t\nNeu Nora\t"), PEOPLE, roster);
  expect(lost.marked).toBe(false);
  expect(lost.match.lineup).toEqual(match.lineup);
  expect(lost.extra.map((person) => person.name)).toEqual(["Neu Nora"]);
});

test("Einsätze in Worten", () => {
  expect(appearancesText({ played: 5, of: 7, unit: "matches" })).toBe("5 von 7 Spielen");
  expect(appearancesText({ played: 1, of: 1, unit: "matches" })).toBe("1 von 1 Spiel");
  expect(appearancesText({ played: 3, of: 5, unit: "races" })).toBe("3 von 5 Rennen");
  expect(appearancesText({ played: 2, of: 4, unit: "rounds" })).toBe("2 von 4 Runden");
  expect(appearancesText({ played: 0, of: 0, unit: "matches" })).toBe("");
  expect(appearancesText(null)).toBe("");
});
