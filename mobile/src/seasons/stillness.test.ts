import fs from "fs";
import path from "path";
import { screenClass, stillScreen } from "./intensity";
import { clearOwnMatches, clearStillHolds, decoPaused, holdsDeco, noteOwnMatches, ownMatchesPaused, setStillHold, stillHeld, subscribeOwnMatches } from "./matchPause";

// Turniertag (#1169): Turnierbaum, Matchseite (mit der Aufruf-Karte) und Turnierleitung bleiben ganz ohne Deko; ist
// das eigene Spiel aufgerufen oder läuft es, pausiert die Deko überall bis zum Ergebnis. Dieselben Fälle prüft die
// Website (frontend/src/seasons/stillness.test.js) - beide lesen frontend/src/seasons/stillness.cases.json.
type Match = Record<string, unknown>;
type Cases = {
  pages: { name: string; web: string; app: string | null; still: boolean }[];
  holds: { name: string; matches: Match[]; paused: boolean }[];
  flows: { name: string; steps: { source: "dashboard" | "queue" | "match"; matches: Match[]; paused: boolean }[] }[];
};
const CASES: Cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../frontend/src/seasons/stillness.cases.json"), "utf8"));

afterEach(() => {
  clearOwnMatches();
  clearStillHolds();
});

test.each(CASES.pages.filter((page) => page.app))("Screen: $name", ({ app, still }) => {
  expect(stillScreen(String(app))).toBe(still);
  if (still) expect(screenClass(String(app))).toBe("quiet");
});

test("Turnierseite und Liste bleiben ruhig, nicht still", () => {
  expect(screenClass("TournamentDetail")).toBe("calm");
  expect(screenClass("TournamentList")).toBe("calm");
  expect(screenClass("MatchDetail")).toBe("quiet");
});

test.each(CASES.holds)("Eigenes Spiel: $name", ({ matches, paused }) => {
  expect(decoPaused(matches)).toBe(paused);
  expect(matches.some(holdsDeco)).toBe(paused);
});

test.each(CASES.flows)("Ablauf: $name", ({ steps }) => {
  steps.forEach(({ source, matches, paused }) => {
    noteOwnMatches(matches, source);
    expect(ownMatchesPaused()).toBe(paused);
  });
});

test("Zuhörer erfahren nur Wechsel, Abmelden räumt auf", () => {
  const seen: boolean[] = [];
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

test("Der Baum-Reiter hält die Bühne still, solange er offen ist - nur stille Screens dürfen das", () => {
  setStillHold("bracket-1", "TournamentBracket", true);
  expect(stillHeld()).toBe(true);
  setStillHold("bracket-1", "TournamentBracket", false);
  expect(stillHeld()).toBe(false);
  setStillHold("detail-1", "TournamentDetail", true);
  expect(stillHeld()).toBe(false);
});
