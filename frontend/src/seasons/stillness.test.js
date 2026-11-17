import cases from "./stillness.cases.json";
import { isStillPage, pageClass } from "./intensity";
import { isQuietPath } from "./SeasonStage";
import { clearOwnMatches, decoPaused, holdsDeco, noteOwnMatches, ownMatchesPaused, subscribeOwnMatches } from "./matchPause";

// Turniertag (#1169): Turnierbaum, Matchseite (mit der Aufruf-Karte) und Turnierleitung bleiben ganz ohne Deko; läuft
// das eigene Spiel oder ist es aufgerufen, pausiert die Deko überall bis zum Ergebnis. Die App prüft dieselben Fälle
// (mobile/src/seasons/stillness.test.ts) - beide lesen stillness.cases.json.

afterEach(() => clearOwnMatches());

test.each(cases.pages)("Seite: $name", ({ web, still }) => {
  expect(isStillPage(web)).toBe(still);
  // Still heißt: die Bühne bleibt leer wie in der Verwaltung, nicht bloß „ruhig“.
  expect(isQuietPath(web)).toBe(still);
  if (still) expect(pageClass(web)).toBe("quiet");
});

test("Liste und Tabelle bleiben ruhig, nicht still - der Baum wird still", () => {
  expect(pageClass("/tournaments/cup/standings")).toBe("calm");
  expect(pageClass("/tournaments/cup/matches")).toBe("calm");
  expect(pageClass("/tournaments/cup/bracket")).toBe("quiet");
  expect(pageClass("/matches/m-1/")).toBe("quiet");
  expect(pageClass("/tournaments/cup")).toBe("medium");
});

test.each(cases.holds)("Eigenes Spiel: $name", ({ matches, paused }) => {
  expect(decoPaused(matches)).toBe(paused);
  expect(matches.some(holdsDeco)).toBe(paused);
});

test.each(cases.flows)("Ablauf: $name", ({ steps }) => {
  steps.forEach(({ source, matches, paused }) => {
    noteOwnMatches(matches, source);
    expect(ownMatchesPaused()).toBe(paused);
  });
});

test("Zuhörer erfahren nur Wechsel, Abmelden räumt auf", () => {
  const seen = [];
  const off = subscribeOwnMatches(() => seen.push(ownMatchesPaused()));
  noteOwnMatches([{ id: "m-1", status: "in_progress" }], "dashboard");
  noteOwnMatches([{ id: "m-1", status: "in_progress" }], "dashboard");
  clearOwnMatches();
  off();
  noteOwnMatches([{ id: "m-1", status: "in_progress" }], "dashboard");
  expect(seen).toEqual([true, false]);
});

test("Kaputte Antworten pausieren nichts", () => {
  noteOwnMatches(null, "dashboard");
  noteOwnMatches([null, { status: "in_progress" }], "queue");
  expect(ownMatchesPaused()).toBe(false);
});
