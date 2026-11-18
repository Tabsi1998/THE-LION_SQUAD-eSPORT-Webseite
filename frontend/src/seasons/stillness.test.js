import cases from "./stillness.cases.json";
import { pageClass } from "./intensity";
import { isQuietPath } from "./SeasonStage";
import { clearDecoPause } from "./decoPause";
import { PAUSE_MAX_MS, clearOwnMatches, decoPaused, holdsDeco, noteOwnMatches, ownMatchesPaused, subscribeOwnMatches } from "./matchPause";

// Turniertag (#1169): Turnierbaum, Matchseite (mit der Aufruf-Karte) und Turnierleitung bleiben ganz ohne Deko; läuft
// das eigene Spiel oder ist es aufgerufen, pausiert die Deko überall bis zum Ergebnis. Die App prüft dieselben Fälle
// (mobile/src/seasons/stillness.test.ts) - beide lesen stillness.cases.json.

afterEach(() => clearOwnMatches());

test.each(cases.pages)("Seite: $name", ({ web, still }) => {
  expect(pageClass(web) === "quiet").toBe(still);
  // Still heißt: die Bühne bleibt leer wie in der Verwaltung, nicht bloß „ruhig“.
  expect(isQuietPath(web)).toBe(still);
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

test("Warteschlange eines Turniers: fällt das eigene Spiel heraus (Ergebnis da), kommt die Deko zurück", () => {
  noteOwnMatches([{ match_id: "m-1", state: "running" }], "queue", { scope: "t1" });
  noteOwnMatches([{ match_id: "m-7", state: "called" }], "queue", { scope: "t2" });
  expect(ownMatchesPaused()).toBe(true);
  noteOwnMatches([], "queue", { scope: "t2" });
  expect(ownMatchesPaused()).toBe(true);
  noteOwnMatches([{ match_id: "m-2", state: "queued" }], "queue", { scope: "t1" });
  expect(ownMatchesPaused()).toBe(false);
});

test("Sicherheitsablauf: die Pause endet spätestens nach max_minutes ohne neue Meldung", () => {
  vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00Z") });
  try {
    const { max_minutes: max, steps } = cases.expiry;
    expect(PAUSE_MAX_MS).toBe(max * 60 * 1000);
    let clock = 0;
    steps.forEach(({ at, source, matches, paused }) => {
      vi.advanceTimersByTime((at - clock) * 60 * 1000);
      clock = at;
      if (source) noteOwnMatches(matches, source);
      expect(ownMatchesPaused()).toBe(paused);
    });
  } finally {
    vi.useRealTimers();
  }
});

test("der einzelne Zeitgeber meldet das Ende der Pause, auch ohne dass jemand fragt", () => {
  vi.useFakeTimers();
  try {
    const seen = [];
    const off = subscribeOwnMatches(() => seen.push(ownMatchesPaused()));
    noteOwnMatches([{ id: "m-1", status: "in_progress" }], "dashboard");
    vi.advanceTimersByTime(PAUSE_MAX_MS - 1000);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual([true, false]);
    off();
  } finally {
    vi.useRealTimers();
  }
});

test("Abmelden (clearDecoPause aus dem Start-Teil) vergisst auch die bekannten Spiele", () => {
  noteOwnMatches([{ id: "m-1", status: "in_progress" }], "dashboard");
  clearDecoPause();
  expect(ownMatchesPaused()).toBe(false);
  // Die Matchseite kennt das Spiel danach nicht mehr als eigenes - sie pausiert nichts.
  noteOwnMatches([{ id: "m-1", status: "in_progress" }], "match");
  expect(ownMatchesPaused()).toBe(false);
});

test("Abmelden räumt auch den Wecker des Sicherheitsablaufs ab", () => {
  vi.useFakeTimers();
  try {
    noteOwnMatches([{ id: "m-1", status: "in_progress" }], "dashboard");
    expect(vi.getTimerCount()).toBe(1);
    clearDecoPause();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
