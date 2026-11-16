import {
  brokenOtherQuestion,
  calledLine,
  canOperateStation,
  delayText,
  nextAction,
  queueSummaryLine,
  queueWhat,
  queueWhen,
  releaseQuestion,
  stationDoneText,
  stationHolds,
  stationTone,
  stationWho,
  type QueueEntry,
  type QueueStation,
} from "./liveQueue";

// Stationen der Turnierleitung in der App (#1162, #2393): dieselben Wörter und Knöpfe wie die Kachel im Web
// (frontend/src/components/tls/live/StationTile.jsx). Namen erfunden.

const entry = (extra: Partial<QueueEntry> = {}): QueueEntry => ({ match_id: "m1", label: "Halbfinale", names: ["NeonFalke", "Jo"], state: "queued", ready: true, ...extra });
const tile = (extra: Partial<QueueStation> = {}): QueueStation => ({ id: "pc1", name: "PC 1", station_text: "PC 1 · PC", status: "free", running: null, next: null, ...extra });

test("Verzug erst ab 5 Minuten, früher als geplant in Worten", () => {
  expect(delayText(4)).toBe("");
  expect(delayText(5)).toBe("+5 Min.");
  expect(delayText(-12)).toBe("12 Min. früher");
  expect(delayText(null)).toBe("");
  expect(queueSummaryLine({ delay_minutes: 11, last: { label: "Finale", forecast_at: "2026-11-16T19:51:00Z" } })).toBe("+11 Min. · Finale jetzt ca. 20:51");
  expect(queueSummaryLine({ delay_minutes: 2, last: { label: "Finale", forecast_at: "2026-11-16T19:51:00Z" } })).toBe("Im Plan · Finale ca. 20:51");
  expect(queueSummaryLine(null)).toBe("");
});

test("wer spielt und was: Duell „gegen“, Lauf mit Durchgang, offene Plätze", () => {
  expect(stationWho(entry())).toBe("NeonFalke gegen Jo");
  expect(stationWho(entry({ names: ["A", "B", "C", "D", "E", "F"], heat: true }))).toBe("A · B · C · D +2");
  expect(stationWho(entry({ names: ["A"], open_slots: 1 }))).toBe("A · 1 Platz offen");
  expect(stationWho(entry({ names: [] }))).toBe("Teilnehmer offen");
  expect(queueWhat(entry({ label: "Loser Runde 1", match_key: "LA", heat: true }))).toBe("Loser Runde 1 · Durchgang LA");
  expect(queueWhat(entry({ match_key: "HF1" }))).toBe("Halbfinale");
  expect(queueWhen(entry({ forecast: true, forecast_at: "2026-11-16T13:40:00Z", delay_minutes: 11 }))).toBe("voraussichtlich ca. 14:40 · +11 Min.");
  expect(calledLine(entry({ state: "called", called_at: "2026-11-16T13:20:00Z", report_by: "2026-11-16T13:30:00Z" }))).toBe("Aufgerufen 14:20 · antreten bis 14:30");
});

test("Zustand der Kachel: defekt vor anderem Turnier vor läuft vor aufgerufen vor hängt", () => {
  expect(stationTone(tile({ status: "broken", running: entry() }))).toBe("broken");
  expect(stationTone(tile({ hold_issue: { kind: "other", tournament_title: "Mario Kart Cup" } }))).toBe("other");
  expect(stationTone(tile({ running: entry({ state: "running" }) }))).toBe("running");
  expect(stationTone(tile({ next: entry({ state: "called" }) }))).toBe("called");
  expect(stationTone(tile({ hold_issue: { kind: "stuck" } }))).toBe("stuck");
  expect(stationTone(tile())).toBe("free");
  expect(stationHolds(tile({ next: entry({ state: "called" }) }))?.match_id).toBe("m1");
  expect(stationHolds(tile({ next: entry() }))).toBeNull();
});

test("Knöpfe nur mit Recht: Aufrufen an freier Station, Starten nach dem Aufruf, nie an einer defekten", () => {
  const queue = { operate: { station_ids: ["pc1"] } };
  expect(canOperateStation(queue, tile())).toBe(true);
  expect(canOperateStation(queue, tile({ id: "pc2" }))).toBe(false);
  expect(canOperateStation({ operate: { all: true } }, tile({ id: "pc2" }))).toBe(true);
  expect(canOperateStation({}, tile())).toBe(false);

  expect(nextAction(tile({ next: entry() }), true)).toEqual({ kind: "call" });
  expect(nextAction(tile({ next: entry() }), false)).toBeNull();
  expect(nextAction(tile({ next: entry({ state: "called" }) }), true)).toEqual({ kind: "start" });
  expect(nextAction(tile({ status: "broken", next: entry({ state: "called" }) }), true)).toBeNull();
  expect(nextAction(tile({ running: entry({ state: "running" }), next: entry({ match_id: "m2" }) }), true)).toEqual({ kind: "hint", text: "Aufrufen nach dem laufenden Spiel." });
  expect(nextAction(tile({ next: entry({ ready: false, waiting_for: "draw" }) }), true)).toEqual({ kind: "waiting", text: "wartet auf die Auslosung" });
  expect(nextAction(tile({ next: entry({ ready: false }) }), true)).toEqual({ kind: "waiting", text: "wartet auf die Vorspiele" });
  expect(nextAction(tile(), true)).toBeNull();
});

test("Rückfragen und Rückmeldungen wie im Web", () => {
  expect(releaseQuestion(tile({ running: entry({ state: "running" }) })).yes).toBe("Freigeben");
  expect(releaseQuestion(tile({ next: entry({ state: "called" }) })).yes).toBe("Zurücknehmen");
  expect(brokenOtherQuestion(tile({ hold_issue: { kind: "other", tournament_title: "Mario Kart Cup" } }))).toContain("„Mario Kart Cup“");
  expect(stationDoneText("call", {}, "PC 1")).toBe("Aufgerufen an PC 1 – die Spieler bekommen Bescheid.");
  expect(stationDoneText("call", { idempotent_replay: true }, "PC 1")).toBe("War schon an PC 1 aufgerufen.");
  expect(stationDoneText("start", {}, "PC 1")).toBe("Gestartet an PC 1 – die Uhr läuft.");
  expect(stationDoneText("release", { state: "running" }, "PC 1")).toBe("PC 1 ist frei – das Ergebnis trägst du unter „Ergebnisse“ ein.");
  expect(stationDoneText("release", { state: "called" }, "PC 1")).toContain("Aufruf ist zurückgenommen");
  expect(stationDoneText("broken", { holds: { other_tournament: "Mario Kart Cup" } }, "PC 1")).toBe("PC 1 ist als defekt gemeldet. Dort spielt gerade „Mario Kart Cup“ – dessen Leitung hat Bescheid bekommen.");
  expect(stationDoneText("ready", { idempotent_replay: true }, "PC 1")).toBe("PC 1 war schon bereit.");
});
