import { formToRules, parsePointsList, rulesToForm, seriesAddress, seriesPayload, seriesToForm, visibleLineages } from "@/lib/referenceSeries";

// Serien (#1741): die Regeln einer Serie kommen vollständig vom Server (Vorlage oder Standard) und gehen vollständig
// zurück - das Formular rechnet nichts selbst, es wandelt nur zwischen Feldern und Werten.

const RULES = {
  points_mode: "scheme",
  points_by_place: [25, 18, 15],
  bonuses: { fastest_lap: { points: 1, max_place: 10 }, pole: { points: 0, max_place: null } },
  dnf_points: null,
  dns_points: 0,
  dsq_points: 0,
  count_mode: "drop_n",
  count_n: 2,
  activity_points: { points: 1, from_round: 3 },
  final_top_n: 8,
  tiebreakers: ["countback", "latest_result"],
  team_scoring: { enabled: true, counting_drivers: 2, guests_count: true, mode: "current_lineup", no_team_names: ["Ersatzfahrer", "Reserve"], adjustments_count_for_team: true },
  min_participants: 8,
  match_points: { win: 3, draw: 1, loss: 0 },
  table_tiebreakers: ["score_diff"],
  // Turniertage (#1961) - der Server liefert sie immer mit.
  day_rounds: { count: 5, points_by_place: [8, 7, 6, 5, 4, 3, 2, 1] },
  custom_bonuses: [{ key: "bingo", label: "Bingo", points: 3 }],
  tiebreak_top_n: 4,
};

test("Punkte je Platz lassen sich in jeder üblichen Schreibweise eingeben", () => {
  expect(parsePointsList("25, 18, 15")).toEqual([25, 18, 15]);
  expect(parsePointsList("35-30-26 23")).toEqual([35, 30, 26, 23]);
  expect(parsePointsList("10; 7.5\n5")).toEqual([10, 7.5, 5]);
  expect(parsePointsList("")).toEqual([]);
});

test("Regeln gehen unverändert durch das Formular", () => {
  expect(formToRules(rulesToForm(RULES))).toEqual(RULES);
});

test("leere Felder: Ausfall nach Platz, keine Grenze, keine Finalgrenze, Vorrang ohne Lücken", () => {
  const form = { ...rulesToForm(RULES), dnf_points: "", fastest_lap_max_place: "", final_top_n: "", tiebreakers: ["", "wins", ""] };
  const rules = formToRules(form);
  expect(rules.dnf_points).toBeNull();
  expect(rules.bonuses.fastest_lap.max_place).toBeNull();
  expect(rules.final_top_n).toBeNull();
  expect(rules.tiebreakers).toEqual(["wins"]);
  expect(rulesToForm({ ...RULES, dnf_points: 2 }).dnf_points).toBe("2");
});

test("Turniertage (#1961): Runden aus, neuer Bonus ohne Kennung, leere Boni fallen weg, Namen ohne Tag", () => {
  const form = rulesToForm({ ...RULES, day_rounds: { count: 0, points_by_place: [8, 7, 6, 5, 4, 3, 2, 1] } });
  expect(form.day_rounds_count).toBe("");
  form.custom_bonuses = [...form.custom_bonuses, { label: "Joker", points: "2", key: "" }, { label: "  ", points: "5", key: "" }];
  const rules = formToRules({ ...form, day_rounds_points: "10-8-6", tiebreak_top_n: "3" });
  expect(rules.day_rounds).toEqual({ count: 0, points_by_place: [10, 8, 6] });
  expect(rules.custom_bonuses).toEqual([{ key: "bingo", label: "Bingo", points: 3 }, { label: "Joker", points: 2 }]);
  expect(rules.tiebreak_top_n).toBe(3);
  const series = seriesToForm({ hide_name_tags: true, rules: RULES });
  expect(series.hide_name_tags).toBe(true);
  expect(seriesPayload(series).hide_name_tags).toBe(true);
});

test("eine neue Serie nennt Spur und Vorlage, eine bestehende nicht", () => {
  const form = { ...seriesToForm({ season: "2026", tier: "", default_weekday: 2, default_time: "20:30", rules: RULES }), lineage_id: "spur-1", points_scheme_id: "formula_1" };
  const created = seriesPayload(form, { isNew: true });
  expect(created).toMatchObject({ lineage_id: "spur-1", points_scheme_id: "formula_1", season: "2026", tier: null, default_weekday: 2, default_time: "20:30" });
  expect(created.rules.points_by_place).toEqual([25, 18, 15]);
  const edited = seriesPayload({ ...form, default_weekday: "", default_time: "" }, { isNew: false });
  expect(edited).not.toHaveProperty("lineage_id");
  expect(edited).not.toHaveProperty("points_scheme_id");
  expect(edited).toMatchObject({ default_weekday: null, default_time: null });
});

test("Eigene Teams (#1926): die Liste kommt ins Formular, das alte Feld wird das erste Team", () => {
  const listed = seriesToForm({ own_teams: [{ name: "Probe Löwen", aliases: [] }, { name: "Probe-DarkFriday", aliases: ["PDF Racing", "PDF"] }], team_name: "Probe Löwen", rules: RULES });
  expect(listed.own_teams.map(({ name, aliases }) => ({ name, aliases }))).toEqual([
    { name: "Probe Löwen", aliases: "" }, { name: "Probe-DarkFriday", aliases: "PDF Racing, PDF" }]);
  expect(new Set(listed.own_teams.map((team) => team.key)).size).toBe(2);
  expect(seriesToForm({ team_name: "Probe Alt", rules: RULES }).own_teams.map((team) => team.name)).toEqual(["Probe Alt"]);
  expect(seriesToForm({ rules: RULES }).own_teams.map((team) => team.name)).toEqual([""]);

  const payload = seriesPayload({ ...listed, own_teams: [...listed.own_teams, { key: "x", name: "  ", aliases: "egal" }, { key: "y", name: " Probe Löwen C ", aliases: " TLS C ;; tls-c\nC-Team " }] });
  expect(payload.own_teams).toEqual([
    { name: "Probe Löwen", aliases: [] },
    { name: "Probe-DarkFriday", aliases: ["PDF Racing", "PDF"] },
    { name: "Probe Löwen C", aliases: ["TLS C", "tls-c", "C-Team"] },
  ]);
  expect(payload).not.toHaveProperty("team_name");
});

test("Adresse der Serie: /references/series/<spur>/<saison>", () => {
  expect(seriesAddress({ slug: "probe-racing-f1" }, { season_slug: "2026-division-1" })).toBe("/references/series/probe-racing-f1/2026-division-1");
});

test("Archiviertes erscheint nur auf Wunsch", () => {
  const lineages = [
    { id: "a", is_archived: false, series: [{ id: "s1", status: "active" }, { id: "s2", status: "archived" }] },
    { id: "b", is_archived: true, series: [{ id: "s3", status: "completed" }] },
  ];
  expect(visibleLineages(lineages, false).map((item) => [item.id, item.series.map((series) => series.id)])).toEqual([["a", ["s1"]]]);
  expect(visibleLineages(lineages, true).map((item) => [item.id, item.series.map((series) => series.id)])).toEqual([["a", ["s1", "s2"]], ["b", ["s3"]]]);
});
