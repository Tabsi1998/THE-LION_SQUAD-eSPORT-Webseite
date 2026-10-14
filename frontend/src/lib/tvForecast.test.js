import { describe, expect, it } from "vitest";
// TV-Bäume aus dem echten Generator und dem echten Planer (scripts/make_tv_bracket_fixture.py) - keine Handarbeit.
import TVG from "../../e2e/fixtures/tvGenerated.json";
import { viennaTime } from "@/lib/vienna";
import { DELAY_SHOWN_FROM, forecastOf, forecastText, nextUp } from "./tvForecast";

// „Als Nächstes“ mit Prognose (#1564): wann ein Spiel ungefähr losgeht und an welcher Station - aus dem Planer
// (`scheduled_at`, `schedule_forecast`), verschoben um den Verzug: läuft das Spiel davor an derselben Station länger als
// geplant, oder ist die geplante Zeit schon vorbei, kommt es später.

const GENERATED = Date.parse(TVG._generated_at);
const minutes = (value) => GENERATED + value * 60000;
const state = (name) => structuredClone(TVG[name]);
const byKey = (bracket, key) => bracket.matches_v2.find((match) => match.match_key === key);
const hhmm = (ms) => viennaTime(ms, { hour: "2-digit", minute: "2-digit" });

describe("Prognose je Spiel", () => {
  it("läuft das Spiel davor noch in der Zeit, bleibt die geplante Zeit - ohne Verzug", () => {
    const bracket = state("se8_live");
    const next = byKey(bracket, "C");
    const entry = forecastOf(next, { matches: bracket.matches_v2, now: minutes(10) });
    expect(entry.station).toBe("Switch 1");
    expect(entry.delayMinutes).toBe(0);
    expect(entry.eta).toBe(Date.parse(next.scheduled_at));
    expect(forecastText(entry)).toBe(`ca. ${hhmm(Date.parse(next.scheduled_at))} · Switch 1`);
    expect(entry.delayText).toBe("");
  });

  it("überzieht das laufende Spiel an derselben Station, kommt das nächste später - mit Verzug in Minuten", () => {
    const bracket = state("se8_live");
    const live = byKey(bracket, "A");
    const next = byKey(bracket, "C");
    expect(live.status).toBe("in_progress");
    expect(next.station_id).toBe(live.station_id);
    // 40 Minuten nach dem Start, geplant waren 30: Switch 1 ist frühestens jetzt frei.
    const now = Date.parse(live.started_at || live.scheduled_at) + 40 * 60000;
    const entry = forecastOf(next, { matches: bracket.matches_v2, now });
    expect(entry.eta).toBe(now);
    expect(entry.delayMinutes).toBe(Math.round((now - Date.parse(next.scheduled_at)) / 60000));
    expect(entry.delayMinutes).toBeGreaterThanOrEqual(9);
    expect(entry.delayText).toBe(`${entry.delayMinutes} Min. Verzug`);
  });

  it("eine Zeit des Planers für ein Spiel, dessen Plätze noch offen sind, ist eine Prognose", () => {
    const bracket = state("se8_planned");
    const semi = bracket.matches_v2.find((match) => match.round === 2);
    expect(semi.schedule_forecast).toBe(true);
    const entry = forecastOf(semi, { matches: bracket.matches_v2, now: GENERATED });
    expect(entry.forecast).toBe(true);
    expect(forecastText(entry)).toMatch(/^ca\. \d{2}:\d{2} · Switch \d$/);
  });

  it("die Station kommt aus der Liste der Stationen, wenn das Spiel nur ihre Kennung hat", () => {
    const bracket = state("se8_planned");
    const match = { ...byKey(bracket, "B"), station_name: undefined, station: undefined, station_label: undefined };
    const entry = forecastOf(match, { matches: bracket.matches_v2, stations: [{ id: match.station_id, name: "Switch 2" }], now: GENERATED });
    expect(entry.station).toBe("Switch 2");
  });
});

describe("Als Nächstes", () => {
  it("die nächsten offenen Spiele nach ihrer Prognose - Laufendes, Entschiedenes und Entfallenes zählen nicht", () => {
    const bracket = state("se8_live");
    const list = nextUp(bracket.matches_v2, { now: minutes(5), limit: 3 });
    expect(list.map((entry) => entry.match.match_key)).toEqual(["B", "C", "D"]);
    expect(list.every((entry) => entry.match.status !== "in_progress")).toBe(true);
    const merged = state("ffa8_after_merge");
    expect(nextUp(merged.matches_v2, { now: GENERATED, limit: 10 }).map((entry) => entry.match.match_key)).not.toContain("C");
  });

  it("ist die geplante Zeit vorbei und das Spiel noch nicht gestartet, heißt es „jetzt“ plus Verzug", () => {
    const bracket = state("se8_live");
    const [first] = nextUp(bracket.matches_v2, { now: minutes(25), limit: 1 });
    expect(first.match.match_key).toBe("B");
    expect(first.delayMinutes).toBeGreaterThanOrEqual(24);
    expect(first.eta).toBe(minutes(25));
  });
});

it("ein Plan von gestern ist kein Verzug: dann nur die Station, keine Uhrzeit und keine Riesenzahl", () => {
  const bracket = state("se8_planned");
  const match = byKey(bracket, "B");
  const entry = forecastOf(match, { matches: bracket.matches_v2, now: Date.parse(match.scheduled_at) + 26 * 3600000 });
  expect(entry.stale).toBe(true);
  expect(entry.delayText).toBe("");
  expect(forecastText(entry)).toBe("Switch 2");
});

// ---------------------------------------------------------------- Eine Zeit für alles (#1564, Nachtrag)
// Am Beamer steht überall dieselbe, aktuelle Zeit: Karte und Fuß rechnen mit derselben Funktion. Verzug rückt die
// Folgespiele nach - über die Station (das Spiel davor an derselben Station) und über die Vorspiele (Linien).
import { forecastBoard } from "./tvForecast";

describe("forecastBoard: eine Prognose für Karte und Fuß", () => {
  const live = () => {
    const bracket = state("se8_live");
    const a = byKey(bracket, "A");
    return { bracket, now: Date.parse(a.started_at) + 40 * 60000 };
  };

  it("B ist 40 Minuten zu spät - die Karte und „Als Nächstes“ haben dieselbe Zeit", () => {
    const { bracket, now } = live();
    const board = forecastBoard(bracket.matches_v2, { now });
    const b = board.get(byKey(bracket, "B").id);
    expect(b.delayMinutes).toBeGreaterThanOrEqual(39);
    const [next] = nextUp(bracket.matches_v2, { now, limit: 1 });
    expect(next.match.match_key).toBe("B");
    expect(next.eta).toBe(b.eta);
    expect(forecastText(next)).toBe(forecastText(b));
  });

  it("die Folgespiele rücken nach: D nach B an Switch 2, E nach A, B und C, G nach E und F", () => {
    const { bracket, now } = live();
    const board = forecastBoard(bracket.matches_v2, { now });
    const at = (key) => board.get(byKey(bracket, key).id);
    const end = (key) => at(key).eta + 30 * 60000;
    // D wartet, bis B an Switch 2 fertig ist.
    expect(at("D").eta).toBeGreaterThanOrEqual(end("B"));
    // E (Halbfinale) braucht die Sieger aus A und B - und Switch 1 nach C.
    expect(at("E").eta).toBeGreaterThanOrEqual(end("B"));
    expect(at("E").eta).toBeGreaterThanOrEqual(end("C"));
    expect(at("E").delayMinutes).toBeGreaterThan(0);
    // Das Finale nach beiden Halbfinals.
    expect(at("G").eta).toBeGreaterThanOrEqual(Math.max(end("E"), end("F")));
    expect(at("G").eta).toBeGreaterThan(Date.parse(byKey(bracket, "G").scheduled_at));
  });

  it("läuft alles nach Plan, rückt nichts", () => {
    const bracket = state("se8_planned");
    const board = forecastBoard(bracket.matches_v2, { now: GENERATED });
    for (const match of bracket.matches_v2) expect(board.get(match.id).delayMinutes, match.match_key).toBeLessThan(DELAY_SHOWN_FROM);
  });
});

// ---------------------------------------------------------------- Codex-Prüfung (#1564)
describe("forecastBoard: Reihenfolge aus den Linien, nicht aus der Zeit", () => {
  it("steht ein Folgespiel im Plan zu früh, kommt es trotzdem erst nach seinen Vorspielen", () => {
    const bracket = state("se8_live");
    const a = byKey(bracket, "A");
    const e = byKey(bracket, "E");
    // Falsch sortierte Daten: das Halbfinale E steht im Plan vor seinen Vorspielen.
    e.scheduled_at = new Date(Date.parse(a.scheduled_at) - 60 * 60000).toISOString();
    const now = Date.parse(a.started_at) + 40 * 60000;
    const board = forecastBoard(bracket.matches_v2, { now });
    const end = (key) => board.get(byKey(bracket, key).id).eta + 30 * 60000;
    expect(board.get(e.id).eta).toBeGreaterThanOrEqual(end("B"));
  });

  it("ein Kreis in den Linien (kaputte Daten): für die betroffenen Spiele keine Prognose", () => {
    const bracket = state("se8_planned");
    const a = byKey(bracket, "A");
    const e = byKey(bracket, "E");
    // A hängt von E ab, E von A: so etwas darf nie eine Uhrzeit bekommen.
    a.slots[0].source = { type: "rank", flow: "W", match_key: "E", rank: 1, raw: "W:E:1" };
    const board = forecastBoard(bracket.matches_v2, { now: GENERATED });
    expect(board.get(a.id).eta).toBeNull();
    expect(board.get(e.id).eta).toBeNull();
    expect(board.get(byKey(bracket, "G").id).eta).toBeNull();
    expect(board.get(byKey(bracket, "B").id).eta).not.toBeNull();
  });

  it("ein alter Plan (nur ausgeblendet) blockiert trotzdem seine Station - das Spiel danach kommt nicht zu früh", () => {
    const bracket = state("se8_planned");
    const b = byKey(bracket, "B");
    const d = byKey(bracket, "D");
    expect(d.station_id).toBe(b.station_id);
    const now = Date.parse(b.scheduled_at) + 200 * 60000;
    const board = forecastBoard(bracket.matches_v2, { now });
    expect(board.get(b.id).stale).toBe(true);
    const next = board.get(d.id);
    // D wartet auf B an derselben Station: entweder ebenfalls alter Plan (ausgeblendet) oder nach Bs Ende.
    expect(next.stale || next.eta >= now + 30 * 60000).toBe(true);
  });
});
