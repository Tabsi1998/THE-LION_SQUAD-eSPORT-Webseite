// Live-Spotlight (#1116): Spielzeit aus der Startzeit (fehlende Zeit, über Mitternacht, nach dem Neuladen), was neu
// gestartet oder entschieden ist, und die Zoom-Entscheidung bei mehreren Starts.
import { bracketChanges, bracketSnapshot, clockText, elapsedSeconds, liveZoomPlan, matchName, spotlightParts, stationName } from "./tvLive";
import { decide, find, singleElimination, start } from "../../e2e/fixtures/tvBrackets.mjs";

test("Spielzeit aus der Startzeit - sekundengenau, über Mitternacht, nach dem Neuladen gleich", () => {
  const started = "2026-10-10T23:58:30+02:00";
  const now = Date.parse("2026-10-11T00:03:04+02:00");
  expect(elapsedSeconds(started, now)).toBe(274);
  expect(clockText(elapsedSeconds(started, now))).toBe("4:34");
  // Nach dem Neuladen zählt dieselbe Startzeit - keine Uhr, die bei 0 anfängt.
  expect(clockText(elapsedSeconds(started, now + 60_000))).toBe("5:34");
  expect(clockText(754)).toBe("12:34");
  expect(clockText(3723)).toBe("1:02:03");
  expect(clockText(0)).toBe("0:00");
  // Fehlende oder kaputte Startzeit: keine Zeit. Geht die Uhr am TV nach, steht 0:00 statt einer negativen Zeit.
  expect(elapsedSeconds(null, now)).toBeNull();
  expect(elapsedSeconds("kein Datum", now)).toBeNull();
  expect(elapsedSeconds("2026-10-11T00:05:00+02:00", now)).toBe(0);
  expect(clockText(null)).toBe("");
});

test("Spotlight: „PC 3 · 12:34“ - ohne Startzeit nur „Live“", () => {
  const now = Date.parse("2026-10-10T14:32:34+02:00");
  const bracket = singleElimination(8);
  start(bracket, "A", { station: "PC 3", startedAt: "2026-10-10T14:20:00+02:00" });
  expect(spotlightParts(find(bracket, "A"), now)).toEqual({ station: "PC 3", clock: "12:34", text: "PC 3 · 12:34" });
  start(bracket, "B", { station: null, startedAt: null });
  expect(spotlightParts(find(bracket, "B"), now).text).toBe("Live");
  expect(stationName({ station_name: "3" })).toBe("Station 3");
  expect(stationName({ station_label: "Switch 2" })).toBe("Switch 2");
  expect(stationName({})).toBe("");
});

test("beim ersten Laden ist nichts neu; danach: gestartet und entschieden", () => {
  const bracket = singleElimination(8);
  const first = bracketChanges(null, bracket.matches_v2);
  expect(first).toEqual(expect.objectContaining({ started: [], decided: [] }));
  start(bracket, "A");
  start(bracket, "B");
  const second = bracketChanges(first.snapshot, bracket.matches_v2);
  expect(second.started).toEqual([find(bracket, "A").id, find(bracket, "B").id]);
  expect(second.decided).toEqual([]);
  decide(bracket, "A");
  const third = bracketChanges(second.snapshot, bracket.matches_v2);
  expect(third.decided).toEqual([find(bracket, "A").id]);
  expect(third.started).toEqual([]);
  // Derselbe Stand noch einmal (Neuladen über den Änderungsstrom): nichts Neues.
  expect(bracketChanges(third.snapshot, bracket.matches_v2)).toEqual(expect.objectContaining({ started: [], decided: [] }));
  expect(bracketSnapshot(bracket.matches_v2).get(find(bracket, "A").id)).toEqual(expect.objectContaining({ live: false, done: true }));
});

test("Zoom-Entscheidung: ein Start - Zoom auf das Spiel; mehrere zugleich - ein Zoom auf die Runde", () => {
  const bracket = singleElimination(8);
  start(bracket, "B", { station: "PC 5" });
  const one = liveZoomPlan([find(bracket, "B").id], bracket.matches_v2);
  expect(one).toEqual({ matchIds: [find(bracket, "B").id], text: "Spiel B an PC 5" });
  start(bracket, "C", { station: "PC 1" });
  start(bracket, "D", { station: "PC 2" });
  const many = liveZoomPlan(["B", "C", "D"].map((key) => find(bracket, key).id), bracket.matches_v2);
  expect(many).toEqual({ matchIds: ["B", "C", "D"].map((key) => find(bracket, key).id), text: "Runde 1 · 3 Spiele" });
  // Über mehrere Runden: ein Zoom auf alle, ohne Rundennamen.
  decide(bracket, "A");
  decide(bracket, "B");
  start(bracket, "E", { station: "PC 4" });
  expect(liveZoomPlan(["C", "E"].map((key) => find(bracket, key).id), bracket.matches_v2).text).toBe("2 Spiele");
  expect(liveZoomPlan([], bracket.matches_v2)).toBeNull();
  expect(matchName({ match_key: "C", match_type: "ffa", slots: [{}, {}, {}, {}] })).toBe("Durchgang C");
});
