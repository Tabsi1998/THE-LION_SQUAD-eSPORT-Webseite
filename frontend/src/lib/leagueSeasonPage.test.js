import {
  formatFacts, listWords, mapOrder, nextSteps, playModes, pointsLines, scheduleLines, sectionPath, staffelList, teamInitials, weekState,
} from "./leagueSeasonPage";

// Season-Seite (#2268): was gespielt wird, Ablauf und Spieltage als reine Helfer. Erfundene Werte.

const GAME = { modes: [{ mode: "hp", label: "Hardpoint", icon_url: "/hp.png" }, { mode: "snd", label: "Suchen & Zerstören" }, { mode: "ctl", label: "Kontrolle" }] };
const POOL = { modes: [{ mode: "snd", label: "S&Z (Pool)", icon_url: "/snd-pool.png", maps: [{}, {}] }, { mode: "ctl", label: "Kontrolle", maps: [{}] }] };

test("Modi: zuerst die Reihenfolge je Map, dann die übrigen des Pools - Name und Symbol aus dem Pool, sonst vom Spiel, Regel in Klartext", () => {
  const season = { game_mode_order: ["hp", "snd", "hp"], result_rules: { hp: { kind: "score", target: 250, time_limit_seconds: 300 } } };
  const modes = playModes(season, GAME, POOL);
  expect(modes.map((row) => row.mode)).toEqual(["hp", "snd", "ctl"]);
  expect(modes[0]).toMatchObject({ label: "Hardpoint", icon_url: "/hp.png", rule: "bis 250 Punkte · 5 Min.", maps: 0 });
  expect(modes[1]).toMatchObject({ label: "S&Z (Pool)", icon_url: "/snd-pool.png", rule: "", maps: 2 });
  expect(playModes({}, null, null)).toEqual([]);
});

test("Map-Reihenfolge: höchstens Best of, unbekannter Modus mit seiner Kennung", () => {
  expect(mapOrder({ best_of: 3, game_mode_order: ["hp", "snd", "hp", "ctl", "x"] }, GAME, null).map((row) => `${row.position}:${row.label}`))
    .toEqual(["1:Hardpoint", "2:Suchen & Zerstören", "3:Hardpoint"]);
  expect(mapOrder({ best_of: 5, game_mode_order: ["x"] }, GAME, null)[0]).toMatchObject({ position: 1, label: "x", icon_url: null });
  expect(mapOrder({ best_of: 3 }, GAME, null)).toEqual([]);
});

test("Format: Teamgröße, Best of, Runden, Map-Wiederholung", () => {
  expect(formatFacts({ team_size: 4, best_of: 5, round_robin_legs: 2, map_repeat: "never" }).map((row) => row.value))
    .toEqual(["4 gegen 4", "Best of 5", "Jeder gegen jeden, Hin- und Rückrunde", "Jede Map nur einmal je Serie"]);
  expect(formatFacts({}).map((row) => row.key)).toEqual(["legs"]);
});

test("Termine: ohne Terminregeln nur Standardtermin und Ergebnis; 0 Verschiebungen heißt nur die Leitung", () => {
  expect(scheduleLines({ default_match_weekday: 2, default_match_time: "19:30", result_confirm_hours: 1 }).map((row) => row.text))
    .toEqual(["Mittwoch, 19:30 Uhr – gilt, wenn sich die Teams nicht einigen.", "Die Gegenseite bestätigt binnen 1 Stunde – danach gilt die Meldung."]);
  const lines = scheduleLines({ schedule_rules: { home_rule: false, reschedule_max: 0, reschedule_notice_hours: 24 } });
  expect(lines.map((row) => row.key)).toEqual(["default", "reschedule"]);
  expect(lines[1].text).toBe("Verschieben legt nur die Liga-Leitung fest.");
});

test("Punkte und Gleichstand", () => {
  expect(pointsLines({ match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["head_to_head"] }))
    .toEqual(["Sieg / Remis / Niederlage: 3 / 1 / 0", "Bei Punktgleichheit: Punkte → Direkter Vergleich"]);
  expect(pointsLines({ match_points_mode: "maps" })).toEqual(["Punkte je gewonnene Map"]);
});

test("Platzhalter: offene Anmeldung zuerst, sonst Einteilung als Nächstes", () => {
  const open = nextSteps({ start_date: "2026-11-09T23:00:00+00:00" }, { state: "open", closes_at: "2026-11-06T22:00:00+00:00" });
  expect(open.map((row) => `${row.key}:${row.state}`)).toEqual(["apply:now", "split:next", "start:next"]);
  const closed = nextSteps({ registration_deadline: "2026-11-06" }, null);
  expect(closed.map((row) => `${row.key}:${row.state}`)).toEqual(["apply:done", "split:now", "start:next"]);
  expect(closed[2].text).toBe("Der Spielplan folgt.");
});

test("Staffeln flach mit Liga N, Wochenstand, Initialen, Wörter, Adressen", () => {
  const list = staffelList([{ label: "Liga 1", level: 1, staffeln: [{ tournament_id: "t1", slug: "a", staffel: "A" }, { tournament_id: "t2", staffel: "B" }] }]);
  expect(list.map((row) => `${row.key}|${row.label}`)).toEqual(["a|Liga 1 · Staffel A", "t2|Liga 1 · Staffel B"]);
  expect(weekState({ kind: "pause" })).toBe("pause");
  expect(weekState({ kind: "reserve", matches: [] })).toBe("reserve");
  expect(weekState({ matches: [{ done: true }, { done: false }] })).toBe("live");
  expect(weekState({ matches: [{ done: true }] })).toBe("done");
  expect(weekState({ matches: [{ done: false }] })).toBe("open");
  expect(teamInitials("Löwen · Löwen Nachwuchs B")).toBe("LB");
  expect(teamInitials("Nebelwölfe")).toBe("NE");
  expect(teamInitials("")).toBe("?");
  expect(listWords(["A", "B", "C"])).toBe("A, B und C");
  expect(sectionPath("liga", "s1", "teams")).toBe("/liga/liga/s1/teams");
  expect(sectionPath("liga", "s1")).toBe("/liga/liga/s1");
});
