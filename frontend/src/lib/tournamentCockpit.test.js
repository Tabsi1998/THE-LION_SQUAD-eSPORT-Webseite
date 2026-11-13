import { DELAY_SHOWN_FROM } from "@/lib/liveQueue";
import { cockpitProblems, delayProblems, problemCountText, problemSearch, PROBLEM_KINDS } from "./tournamentCockpit";

// Turnier-Cockpit (#1653): die Liste „Probleme“ aus „Braucht Aufmerksamkeit“, den Auslosungen und dem Verzug der
// Warteschlange - Arten, Sortierung nach Dringlichkeit und wohin ein Tipp führt. Namen erfunden.

const ATTENTION = [
  { id: "rm-m1", kind: "result_missing", title: "Ergebnis fehlt", match_id: "m1", station_text: "PC 2 · PC", label: "Viertelfinale", names: "NeonFalke gegen Jo", detail: "4 Min. über der Zeit", overdue_minutes: 4 },
  { id: "st-pc6", kind: "station_broken", title: "Station defekt", station_id: "pc6", station_text: "PC 6 · PC", label: "Halbfinale", names: "TurboTina gegen Frostbiss", detail: "1 Spiel wartet darauf" },
  { id: "rm-m2", kind: "result_missing", title: "Ergebnis fehlt", match_id: "m2", station_text: "PC 10 · PC", label: "Viertelfinale", names: "Kometa gegen Zackenbarsch", detail: "17 Min. über der Zeit", overdue_minutes: 17 },
  { id: "ns-m3", kind: "no_show", title: "Nicht erschienen?", match_id: "m3", station_text: "PC 3 · PC", label: "Achtelfinale", names: "Aurora Blitz gegen PixelPanther", detail: "10 Min. ab Aufruf um" },
  { id: "rc-m4", kind: "report_conflict", title: "Meldungen weichen ab", match_id: "m4", station_text: "", label: "Viertelfinale", names: "A gegen B", detail: "Die Spieler melden verschiedene Ergebnisse." },
  { id: "ds-m5", kind: "dispute", title: "Streitfall gemeldet", match_id: "m5", station_text: "PC 1 · PC", label: "Halbfinale", names: "C gegen D", detail: "C: „Falsches Ergebnis“", since: "2026-11-13T15:10:00Z" },
  { id: "vf-m6", kind: "procedure", title: "Einspruch eingegangen", match_id: "m6", station_text: "", label: "Spieltag 2", names: "E gegen F", detail: "Liga-Leitung", since: "2026-11-13T15:00:00Z" },
];

const station = (id, next, extra = {}) => ({ id, name: id, station_text: `${id.toUpperCase()} · PC`, status: "free", next, running: null, ...extra });
const QUEUE = {
  stations: [
    station("pc4", { match_id: "m7", label: "Halbfinale", names: ["Frostbiss", "Jo"], state: "queued", delay_minutes: 12, planned_at: "2026-11-13T15:30:00Z" }),
    station("pc5", { match_id: "m8", label: "Finale", names: ["NeonFalke", "Kometa"], state: "called", delay_minutes: 25, planned_at: "2026-11-13T15:20:00Z" }),
    // Unter der Schwelle: Rauschen, kein Verzug.
    station("pc7", { match_id: "m9", label: "Spiel um Platz 3", names: ["G", "H"], state: "queued", delay_minutes: DELAY_SHOWN_FROM - 1 }),
    // Defekt hat seinen eigenen Fall - kein Verzug obendrauf.
    station("pc6", { match_id: "m10", label: "Halbfinale", names: ["I", "J"], state: "queued", delay_minutes: 40 }, { status: "broken" }),
    // Früher als geplant ist kein Problem.
    station("pc8", { match_id: "m11", label: "Halbfinale", names: ["K", "L"], state: "queued", delay_minutes: -9 }),
    station("pc9", null),
  ],
};

test("sortiert nach Dringlichkeit: Einspruch, nicht erschienen, defekt, Ergebnis fehlt (am längsten drüber zuerst), Verzug, Auslosung", () => {
  const draws = [{ id: "dr-s1-a", label: "Runde 1", stage_name: "Gruppen", pot_size: 6 }];
  const rows = cockpitProblems({ attention: ATTENTION, draws, queue: QUEUE });
  expect(rows.map((row) => row.id)).toEqual([
    "vf-m6", "ds-m5", // Einspruch: der ältere zuerst
    "ns-m3",
    "st-pc6",
    "rm-m2", "rm-m1", "rc-m4", // 17 Min. vor 4 Min., dann die abweichenden Meldungen
    "dl-pc5", "dl-pc4", // 25 Min. vor 12 Min.
    "dr-s1-a",
  ]);
});

test("Arten: jede Zeile trägt das Wort der Art, ihre Farbe und kurz die Station", () => {
  const rows = Object.fromEntries(cockpitProblems({ attention: ATTENTION, draws: [{ id: "dr-1", label: "Runde 2", pot_size: 1 }], queue: QUEUE }).map((row) => [row.id, row]));
  expect(rows["ds-m5"]).toMatchObject({ chip: "Einspruch", tone: "warn", where: "PC 1", title: "Streitfall gemeldet", what: "Halbfinale · C gegen D" });
  expect(rows["vf-m6"]).toMatchObject({ chip: "Einspruch", tone: "warn", where: "" });
  expect(rows["ns-m3"]).toMatchObject({ chip: "Nicht erschienen", tone: "warn" });
  expect(rows["st-pc6"]).toMatchObject({ chip: "Defekt", tone: "warn", where: "PC 6" });
  expect(rows["rm-m2"]).toMatchObject({ chip: "Ergebnis fehlt", tone: "honor", detail: "17 Min. über der Zeit" });
  expect(rows["rc-m4"]).toMatchObject({ chip: "Ergebnis fehlt", title: "Meldungen weichen ab" });
  expect(rows["dl-pc4"]).toMatchObject({ chip: "Verzug", tone: "honor", where: "PC4", title: "+12 Min. hinter dem Plan", what: "Halbfinale · Frostbiss gegen Jo" });
  expect(rows["dl-pc5"].detail).toContain("Aufgerufen");
  expect(rows["dr-1"]).toMatchObject({ chip: "Auslosung", tone: "brand", title: "Auslosung bereit · 1 Name" });
  expect(Object.keys(PROBLEM_KINDS)).toEqual(expect.arrayContaining(["dispute", "no_show", "result_missing", "delay"]));
});

test("unbekannte Art vom Server: steht trotzdem in der Liste, mit ihrem Titel, ganz unten", () => {
  const rows = cockpitProblems({ attention: [{ id: "xx-1", kind: "neu", title: "Etwas Neues" }, ATTENTION[0]] });
  expect(rows.map((row) => row.id)).toEqual(["rm-m1", "xx-1"]);
  expect(rows[1]).toMatchObject({ chip: "Etwas Neues", target: "case", search: "?fall=xx-1" });
});

test("Links: ein Fall führt zu seiner Karte (?fall=), Verzug zur Station im Cockpit (?station=)", () => {
  const rows = Object.fromEntries(cockpitProblems({ attention: ATTENTION, queue: QUEUE }).map((row) => [row.id, row]));
  expect(rows["ds-m5"]).toMatchObject({ target: "case", search: "?fall=ds-m5" });
  expect(rows["st-pc6"]).toMatchObject({ target: "case", search: "?fall=st-pc6" });
  expect(rows["dl-pc4"]).toMatchObject({ target: "station", stationId: "pc4", search: "?station=pc4" });
  // Was in der Adresse steht, wird kodiert.
  expect(problemSearch({ id: "a&b=c", kind: "dispute" })).toBe("?fall=a%26b%3Dc");
});

test("Verzug: erst ab der Schwelle wie am TV, nicht an defekten Stationen, nicht ohne Spiel", () => {
  expect(delayProblems(QUEUE).map((row) => row.id)).toEqual(["dl-pc4", "dl-pc5"]);
  expect(delayProblems(null)).toEqual([]);
  expect(delayProblems({ stations: [station("x", { delay_minutes: null })] })).toEqual([]);
});

test("ohne Daten: leere Liste; die Zahl in Worten", () => {
  expect(cockpitProblems()).toEqual([]);
  expect(cockpitProblems({ attention: null, draws: null, queue: null })).toEqual([]);
  expect(problemCountText(0)).toBe("Keine Probleme");
  expect(problemCountText(1)).toBe("1 Problem");
  expect(problemCountText(4)).toBe("4 Probleme");
});
