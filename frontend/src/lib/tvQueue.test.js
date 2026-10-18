import { describe, expect, it } from "vitest";
import { hasQueue, laneSignature, queueLanes, queueNextLine, queueWhat, queueWho } from "./tvQueue";

// Live-Warteschlange am TV (#1634): was der TV aus GET /live-queue zeigt - ohne Warteschlange nichts.

const running = { match_id: "m1", state: "running", names: ["Alpha", "Beta"], open_slots: 0, label: "Viertelfinale", started_at: "2026-10-31T14:00:00Z", duration_minutes: 12 };
const called = { match_id: "m2", state: "called", names: ["Gamma", "Delta"], open_slots: 0, label: "Viertelfinale", report_by: "2026-10-31T14:32:00Z" };
const queued = { match_id: "m3", state: "queued", names: ["Eins", "Zwei", "Drei", "Vier"], open_slots: 0, label: "Lauf C", forecast: true, forecast_at: "2026-10-31T14:40:00Z", delay_minutes: 11 };

const queue = (stations, applies = true) => ({ applies, stations, matches: {}, summary: null });

describe("Bahnen je Station", () => {
  it("je Station Jetzt und Als Nächstes, in der Reihenfolge des Servers", () => {
    const lanes = queueLanes(queue([
      { id: "s1", name: "PC 1", status: "busy", running, next: called, waiting: 2 },
      { id: "s2", name: "PC 2", status: "free", running: null, next: queued, waiting: 1 },
    ]));
    expect(lanes.map((lane) => [lane.name, lane.now?.match_id || null, lane.next?.match_id || null])).toEqual([["PC 1", "m1", "m2"], ["PC 2", null, "m3"]]);
    expect(lanes[0].waiting).toBe(2);
  });

  it("ohne Warteschlange (online, keine Stationen, alter Server, Fehlerseite) keine Bahnen", () => {
    expect(queueLanes(null)).toEqual([]);
    expect(queueLanes(queue([], false))).toEqual([]);
    expect(queueLanes({ applies: true })).toEqual([]);
    expect(queueLanes("<html>")).toEqual([]);
    expect(hasQueue(queue([{ id: "s1", name: "PC 1", status: "free", running: null, next: null }]))).toBe(false);
    expect(hasQueue(queue([{ id: "s1", name: "PC 1", status: "free", running: null, next: queued }]))).toBe(true);
  });
});

describe("Texte", () => {
  it("wer spielt: Duell, Lauf, offene Plätze", () => {
    expect(queueWho(running)).toBe("Alpha vs. Beta");
    expect(queueWho(queued)).toBe("4 Spieler");
    expect(queueWho({ names: ["Alpha"], open_slots: 1 })).toBe("Alpha · 1 Platz offen");
    expect(queueWho({ names: [], open_slots: 2 })).toBe("2 Plätze offen");
    expect(queueWho({ names: [] })).toBe("Teilnehmer offen");
  });

  it("als Nächstes: aufgerufen mit Frist, sonst Prognose mit Verzug in Worten", () => {
    const call = queueNextLine(called);
    expect(call.tone).toBe("call");
    expect(call.text).toMatch(/^Aufgerufen · antreten bis \d\d:\d\d$/);
    const next = queueNextLine(queued);
    expect(next.tone).toBe("next");
    expect(next.text).toMatch(/^voraussichtlich ca\. \d\d:\d\d$/);
    expect(next.delay).toBe("+11 Min.");
    expect(queueNextLine(null).tone).toBe("none");
  });

  it("das Spiel aus dem Baum wie überall am TV, sonst der Text des Servers", () => {
    expect(queueWhat(queued)).toBe("Lauf C");
    expect(queueWhat(running, { id: "m1", match_key: "B", round: 1, slots: [{}, {}] })).toContain("B");
  });

  it("ein Wechsel an der Station ändert die Kennung der Bahn - ein gleicher Stand nicht", () => {
    const lane = { now: running, next: queued };
    expect(laneSignature(lane)).toBe(laneSignature({ now: { ...running }, next: { ...queued } }));
    expect(laneSignature(lane)).not.toBe(laneSignature({ now: running, next: { ...queued, state: "called" } }));
  });
});
