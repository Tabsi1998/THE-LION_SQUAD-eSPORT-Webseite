import { describe, expect, it } from "vitest";
import { hasQueue, laneSignature, queueLanes, queueNextLine, queueWhat, queueWho, stationWho } from "./tvQueue";

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
    // Nur eine defekte Station: die Tafel zeigt „Bitte nicht benutzen“ statt der alten Aufruf-Tafel.
    expect(hasQueue(queue([{ id: "s1", name: "PC 1", status: "broken", running: null, next: null }]))).toBe(true);
  });
});

describe("Texte", () => {
  it("wer spielt: Duell, Lauf, offene Plätze", () => {
    expect(queueWho(running)).toBe("Alpha vs. Beta");
    expect(queueWho({ names: ["Alpha", "Beta", "Gamma", "Delta"] })).toBe("Alpha · Beta\nGamma · Delta");
    expect(queueWho({ names: ["Alpha", "Beta", "Gamma"] })).toBe("Alpha · Beta\nGamma");
    expect(queueWho({ names: ["A", "B", "C", "D", "E"] })).toBe("5 Spieler");
    expect(queueWho({ names: ["Alpha", "Beta", "Gamma", "Delta"] }, { compact: true })).toBe("4 Spieler");
    expect(queueWho({ names: ["Alpha", "Beta"] }, { compact: true })).toBe("Alpha vs. Beta");
    expect(queueWho({ names: ["Alpha", "Beta", "Gamma"], open_slots: 1 })).toBe("Alpha · Beta · Gamma · 1 Platz offen");
    expect(queueWho({ names: ["Alpha", "Beta", "Gamma"], open_slots: 1 }, { compact: true })).toBe("3 Spieler · 1 Platz offen");
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

  it("Stationen der Turnierleitung (#1824): Duell „A gegen B“, Lauf mit Namen, ab fünf „+N“, ohne Namen in Worten", () => {
    expect(stationWho({ names: ["Alpha", "Beta"] })).toBe("Alpha gegen Beta");
    expect(stationWho({ names: ["Alpha", "Beta", "Gamma", "Delta"] })).toBe("Alpha · Beta · Gamma · Delta");
    expect(stationWho({ names: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"] })).toBe("A1 · A2 · A3 · A4 +4");
    expect(stationWho({ names: ["Alpha", "Beta", "Gamma"], open_slots: 1 })).toBe("Alpha · Beta · Gamma · 1 Platz offen");
    expect(stationWho({ names: [], open_slots: 4 })).toBe("4 Plätze offen");
    expect(stationWho({ names: [] })).toBe("Teilnehmer offen");
  });

  it("ohne Baum: der Rundenname, im Lauf mit dem Durchgang - Duelle nur die Runde", () => {
    expect(queueWhat({ label: "Runde 1", match_key: "A", heat: true, names: ["a", "b", "c", "d"] })).toBe("Runde 1 · Durchgang A");
    expect(queueWhat({ label: "Loser Runde 1", match_key: "LA", heat: true, names: ["a", "b", "c"] })).toBe("Loser Runde 1 · Durchgang LA");
    // Ältere Antwort ohne `heat`: die Plätze zählen.
    expect(queueWhat({ label: "Runde 1", match_key: "B", names: ["a", "b"], open_slots: 2 })).toBe("Runde 1 · Durchgang B");
    expect(queueWhat({ label: "Viertelfinale", match_key: "QF1", heat: false, names: ["a", "b"] })).toBe("Viertelfinale");
    expect(queueWhat({ label: "FINAL", match_key: "FINAL", heat: true, names: [] })).toBe("FINAL");
  });

  it("ein Wechsel an der Station ändert die Kennung der Bahn - ein gleicher Stand nicht", () => {
    const lane = { now: running, next: queued };
    expect(laneSignature(lane)).toBe(laneSignature({ now: { ...running }, next: { ...queued } }));
    expect(laneSignature(lane)).not.toBe(laneSignature({ now: running, next: { ...queued, state: "called" } }));
  });
});
