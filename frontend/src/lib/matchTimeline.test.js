import { describe, expect, it } from "vitest";
import fixture from "../../e2e/fixtures/matchplanGenerated.json";
import {
  buildTimeline,
  dropConflicts,
  laneSchedule,
  scheduleDelay,
  snapMinutes,
  timeScale,
  timeTicks,
} from "./matchTimeline";

// Matchplan-Seite (#1557): die Zeitleiste zeigt, was der Planer gerechnet hat - Position = Zeit, Breite = Dauer.
// Alle Daten kommen aus echten Planer-Antworten (scripts/make_matchplan_fixture.py), nichts ist von Hand geplant.

const MINUTE = 60_000;

function timelineOf(state, extra = {}) {
  return buildTimeline({
    matches: state.matches,
    stations: state.stations,
    stages: state.stages,
    tournament: state.tournament,
    game: state.duration_game,
    registrations: state.registrations,
    plan: extra.plan === undefined ? null : extra.plan,
    now: extra.now || new Date(fixture.generated_at),
  });
}

const byKey = (timeline) => Object.fromEntries(timeline.items.map((item) => [item.key, item]));

describe("Zeitleiste: Position und Breite", () => {
  const state = fixture.local.applied;
  const timeline = timelineOf(state);
  const items = byKey(timeline);
  const match = (key) => state.matches.find((row) => row.match_key === key);

  it("jedes gespeicherte Spiel steht mit seiner Zeit und der Dauer aus Spiel und Puffer (12 + 8 Min.)", () => {
    expect(timeline.items).toHaveLength(14);
    expect(items.A.start).toBe(Date.parse(match("A").scheduled_at));
    expect(items.A.minutes).toBe(20);
    expect(items.A.end - items.A.start).toBe(20 * MINUTE);
    expect(items.FINAL.laneId).toBe(match("FINAL").station_id);
  });

  it("x ist der Abstand zum Anfang der Achse, die Breite die Dauer - beides in Minuten mal Maßstab", () => {
    const scale = timeScale(timeline.range, 4);
    expect(scale.x(items.A.start)).toBe(((items.A.start - timeline.range.start) / MINUTE) * 4);
    expect(scale.width(items.A)).toBe(80);
    expect(scale.total).toBe(((timeline.range.end - timeline.range.start) / MINUTE) * 4);
  });

  it("die Achse beginnt an der Viertelstunde vor dem ersten Spiel und endet nach dem letzten", () => {
    const first = Math.min(...timeline.items.map((item) => item.start));
    const last = Math.max(...timeline.items.map((item) => item.end));
    expect(timeline.range.start).toBeLessThanOrEqual(first);
    expect(first - timeline.range.start).toBeLessThan(15 * MINUTE);
    expect(timeline.range.end).toBeGreaterThanOrEqual(last);
    expect(new Date(timeline.range.start).getUTCMinutes() % 15).toBe(0);
    const ticks = timeTicks(timeline.range, 15);
    expect(ticks[0]).toBe(timeline.range.start);
    expect(ticks[1] - ticks[0]).toBe(15 * MINUTE);
  });

  it("je Station eine Bahn, Spiele nach Zeit geordnet; Abschnitt und Status kommen mit", () => {
    expect(timeline.lanes.map((lane) => lane.name)).toEqual(["Switch 1", "Switch 2"]);
    const lane = laneSchedule(timeline, timeline.lanes[0].id);
    expect(lane.map((item) => item.start)).toEqual([...lane.map((item) => item.start)].sort((a, b) => a - b));
    expect(items.A.tone).toBe("wb");
    expect(items.LA.tone).toBe("lb");
    expect(items.FINAL.tone).toBe("final");
    expect(items.A.names).toHaveLength(4);
    expect(items.E.names[0]).toMatch(/aus A/);
  });

  it("ohne Konflikt ist kein Spiel markiert", () => {
    expect(timeline.items.filter((item) => item.conflicts.length)).toEqual([]);
  });
});

describe("Vorschau des Planers", () => {
  it("vor dem ersten Übernehmen kommen Zeit und Station aus der Vorschau, alle Spiele sind „geändert“", () => {
    const state = fixture.local.preview;
    expect(timelineOf(state).items).toHaveLength(0);
    const timeline = timelineOf(state, { plan: state.plan });
    expect(timeline.items).toHaveLength(14);
    const items = byKey(timeline);
    const assignment = state.plan.assignments.find((row) => row.label === "E");
    expect(items.E.start).toBe(Date.parse(assignment.scheduled_at));
    expect(items.E.laneId).toBe(assignment.station_id);
    expect(items.E.changed).toBe(true);
    expect(items.E.forecast).toBe(true);
    expect(items.A.forecast).toBe(false);
  });

  it("nach dem Übernehmen ändert die Vorschau nichts mehr", () => {
    const state = fixture.local.applied;
    const timeline = timelineOf(state, { plan: state.plan });
    expect(timeline.items.filter((item) => item.changed)).toEqual([]);
  });
});

describe("feste Termine und Konflikte", () => {
  const state = fixture.local.conflict;
  const timeline = timelineOf(state, { plan: state.plan });
  const items = byKey(timeline);

  it("von Hand gesetzt heißt fest - und zu früh steht als Konflikt in Worten am Spiel", () => {
    expect(items.E.fixed).toBe(true);
    expect(items.A.fixed).toBe(false);
    expect(items.E.conflicts).toHaveLength(1);
    expect(items.E.conflicts[0]).toMatchObject({ type: "too_early", otherKey: "A" });
    expect(items.E.conflicts[0].text).toMatch(/^E ist fest um \d\d:\d\d, aber A ist erst um \d\d:\d\d vorbei\.$/);
  });

  it("ein Spiel ohne Station landet auf der Bahn „Ohne Station“", () => {
    expect(items.E.laneId).toBe("none");
    expect(timeline.lanes.at(-1)).toMatchObject({ id: "none", name: "Ohne Station" });
  });

  it("zwei Spiele zur selben Zeit an derselben Station sind beide rot", () => {
    const applied = fixture.local.applied;
    const first = applied.matches.find((row) => row.match_key === "A");
    const moved = applied.matches.map((row) => (row.match_key === "B" ? { ...row, scheduled_at: first.scheduled_at, station_id: first.station_id } : row));
    const clash = byKey(timelineOf({ ...applied, matches: moved }));
    expect(clash.A.conflicts.map((item) => item.otherKey)).toEqual(["B"]);
    expect(clash.B.conflicts[0]).toMatchObject({ type: "station_overlap", text: "Überschneidet sich an Switch 1 mit A." });
  });
});

describe("Ziehen: sofortige Konfliktanzeige", () => {
  const timeline = timelineOf(fixture.local.applied);
  const items = byKey(timeline);

  it("auf ein belegtes Feld gezogen nennt die Spiele, die im Weg sind", () => {
    expect(dropConflicts(timeline, items.B.id, items.A.laneId, items.A.start).map((item) => item.key)).toEqual(["A"]);
  });

  it("hinter das letzte Spiel einer Station gezogen ist frei", () => {
    const lane = laneSchedule(timeline, items.A.laneId);
    const after = lane.at(-1).end + 10 * MINUTE;
    expect(dropConflicts(timeline, items.B.id, items.A.laneId, after)).toEqual([]);
  });

  it("rastet auf fünf Minuten ein", () => {
    const base = Date.parse("2026-10-31T14:00:00Z");
    expect(snapMinutes(base + 7 * MINUTE)).toBe(base + 5 * MINUTE);
    expect(snapMinutes(base + 8 * MINUTE)).toBe(base + 10 * MINUTE);
    expect(snapMinutes(base + 2 * MINUTE, 15)).toBe(base);
  });
});

describe("live", () => {
  const state = fixture.live;
  const now = new Date(state.now);
  const timeline = timelineOf(state, { plan: state.plan, now });
  const items = byKey(timeline);

  it("erledigt ist grau, laufend zählt die Spielzeit, der Rest ist geplant", () => {
    expect(items.A.state).toBe("done");
    expect(items.B.state).toBe("done");
    expect(items.C.state).toBe("running");
    expect(items.C.elapsedMinutes).toBe(Math.floor((now - Date.parse(state.matches.find((row) => row.match_key === "C").started_at)) / MINUTE));
    expect(items.C.end).toBeGreaterThanOrEqual(now.getTime());
    expect(items.D.state).toBe("planned");
  });

  it("erledigt ohne Startzeit: geplante Zeit und Dauer - nicht bis zur Eingabe des Ergebnisses; Vergangenes ist kein Konflikt", () => {
    const a = state.matches.find((row) => row.match_key === "A");
    expect(a.started_at).toBeFalsy();
    expect(items.A.start).toBe(Date.parse(a.scheduled_at));
    expect(items.A.end).toBe(items.A.start + items.A.minutes * MINUTE);
    const late = state.matches.map((row) => (row.match_key === "B" ? { ...row, completed_at: state.now, started_at: row.scheduled_at } : row));
    const stretched = byKey(timelineOf({ ...state, matches: late }, { plan: state.plan, now }));
    expect(stretched.B.end).toBe(Date.parse(state.now));
    expect(Object.values(stretched).filter((item) => item.state === "done" && item.conflicts.length)).toEqual([]);
  });

  it("der Verzug kommt aus der Prognose des Planers: das letzte Spiel jetzt später als gespeichert", () => {
    const delay = scheduleDelay(state.plan);
    const final = state.plan.assignments.find((row) => row.label === "FINAL");
    expect(delay.label).toBe("FINAL");
    expect(delay.at).toBe(Date.parse(final.scheduled_at));
    expect(delay.minutes).toBe(Math.round((Date.parse(final.scheduled_at) - Date.parse(final.previous.scheduled_at)) / MINUTE));
    expect(delay.minutes).toBeGreaterThan(30);
  });

  it("ohne gespeicherten Plan gibt es keinen Verzug", () => {
    expect(scheduleDelay(fixture.local.preview.plan)).toBeNull();
    expect(scheduleDelay(fixture.local.applied.plan)).toBeNull();
    expect(scheduleDelay(null)).toBeNull();
  });
});

describe("Worst Case: 47 Spiele, 8 Stationen, eine defekt", () => {
  const state = fixture.big;
  const timeline = timelineOf(state, { plan: state.plan });

  it("jede Station bekommt eine Bahn - auch die leere defekte - mit vollem Namen", () => {
    expect(timeline.lanes).toHaveLength(8);
    const broken = timeline.lanes.find((lane) => lane.name === "Station 7");
    expect(broken).toMatchObject({ status: "broken", count: 0 });
    expect(timeline.lanes.some((lane) => lane.name.startsWith("Übertragungsplatz"))).toBe(true);
  });

  it("alle geplanten Spiele stehen, keines doppelt, keine Überschneidung", () => {
    expect(timeline.items).toHaveLength(state.plan.assignments.length);
    expect(new Set(timeline.items.map((item) => item.id)).size).toBe(timeline.items.length);
    expect(timeline.items.filter((item) => item.conflicts.length)).toEqual([]);
  });
});


// Weiterkommen in vier Modi (#1590): was auf ein Los wartet, sagt das im Matchplan - aus der Planer-Antwort oder, ohne
// Plan, aus dem Spiel selbst (Gruppe, Modus, Topf).
describe("Zeitleiste: wartet auf Auslosung", () => {
  const state = fixture.local.applied;
  const withMode = (mode, extra = {}) => ({
    ...state,
    matches: state.matches.map((row) => (row.match_key === "E"
      ? { ...row, settings: { ...row.settings, draw_group: "WB:2", advancement_mode: mode }, slots: row.slots.map((slot) => ({ ...slot, registration_id: null, status: "pending", source: { ...slot.source, draw: { group: "WB:2", label: "Runde 1" } } })), ...extra }
      : row)),
  });

  it("ohne Plan: Auslosung nach der Runde wartet, Show mit Topf ist bereit, sofort zufällig ist nur Prognose", () => {
    expect(byKey(timelineOf(withMode("draw_round"))).E.draw).toBe("waiting");
    expect(byKey(timelineOf(withMode("draw_show"))).E.draw).toBe("waiting");
    expect(byKey(timelineOf(withMode("draw_show", { draw_ready: { group: "WB:2", since: "2026-10-14T17:00:00+00:00" } }))).E.draw).toBe("ready");
    expect(byKey(timelineOf(withMode("instant"))).E.draw).toBe("instant");
    expect(byKey(timelineOf(withMode("draw_round", { draw: { id: "d1", group: "WB:2" } }))).E.draw).toBe(null);
    expect(byKey(timelineOf(state)).E.draw).toBe(null);
  });

  it("mit Plan zählt die Antwort des Planers", () => {
    const plan = { ...state.plan, assignments: state.plan.assignments.map((row) => (row.match_key === "E" ? { ...row, waiting_for_draw: true, draw_ready: true } : row)) };
    expect(byKey(timelineOf(withMode("draw_show"), { plan })).E.draw).toBe("ready");
  });
});
