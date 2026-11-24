import {
  championLine, divisionBody, formOf, formProblem, fullDay, kindLabel, lotLine, missingLine, pairingLine, partState, placeText, playoffLine,
  reachedText, relegationLine, relegationRowText, roundLine, seasonBody, seedOrigin, shortDay, tieText, weekRange,
} from "./leaguePostseason";

// Playoffs und Relegation (#2404): Texte und kleine Rechnungen für Cockpit und Ligaseite. Erfundene Namen.

test("der Stand heißt wartet, bereit, angelegt oder abgeschlossen", () => {
  expect(partState({ state: "waiting" })).toEqual({ key: "blocked", label: "Wartet" });
  expect(partState({ state: "ready" }).label).toBe("Bereit zum Anlegen");
  expect(partState({ state: "created" }).label).toBe("Angelegt");
  expect(partState({ state: "closed" }).label).toBe("Abgeschlossen");
  expect(partState(null).key).toBe("blocked");
});

test("Kalendertage ohne Zeitzone: Tag, Woche, leer bei fehlendem Wert", () => {
  expect(shortDay("2031-03-31")).toBe("31.03.");
  expect(fullDay("2031-03-31")).toBe("31.03.2031");
  expect(weekRange("2031-03-31", "2031-04-06")).toBe("31.03.–06.04.2031");
  expect(weekRange("2031-03-31", null)).toBe("31.03.2031");
  expect(fullDay("")).toBe("");
  expect(shortDay(null)).toBe("");
});

test("Setzliste: Herkunft, Grund der Reihung, Paarung mit Freilos, Runde", () => {
  expect(seedOrigin({ staffel: "A", rank: 2 })).toBe("Staffel A · Platz 2");
  expect(seedOrigin({ rank: 1 })).toBe("Platz 1");
  expect(tieText({ tie: "ppg" })).toBe("mehr Punkte je Spiel");
  expect(tieText({ tie: "map_diff" })).toBe("bessere Map-Differenz je Spiel");
  expect(tieText({ tie: "lot" })).toBe("Los");
  expect(tieText({ tie: null })).toBe("");
  expect(pairingLine({ a: { seed: 1, display_name: "Probe A" }, b: { seed: 4, display_name: "Probe D" } })).toBe("1 Probe A – 4 Probe D");
  expect(pairingLine({ a: { seed: 1, display_name: "Probe A" }, b: null })).toBe("1 Probe A – Freilos");
  expect(roundLine({ label: "Finale", best_of: 5, start_day: "2031-04-14", end_day: "2031-04-20" })).toBe("Finale · Best of 5 · 14.04.–20.04.2031");
});

test("Sätze zu den Einstellungen einer Liga", () => {
  const settings = { playoffs: { enabled: true, per_staffel: 4, best_of: 3, best_of_rounds: [{ round: 2, best_of: 5 }], third_place: false, home: "better_seed" } };
  expect(playoffLine(settings)).toBe("4 je Staffel · Best of 3 · Runde 2: Best of 5 · Platz 3 geteilt · Heimrecht: besser Gesetzter");
  expect(playoffLine({ playoffs: { enabled: true, per_staffel: 2, best_of: 1, third_place: true, home: "draw" } }))
    .toBe("2 je Staffel · Best of 1 · Spiel um Platz 3 · Team A per Los");
  expect(playoffLine({ playoffs: { enabled: false } })).toBe("Keine Playoffs");
  expect(relegationLine({ settings: { relegation: { enabled: true, best_of: 3 } }, has_lower: true, lower_label: "Liga 2" }))
    .toBe("gegen Liga 2 · Best of 3 · ein Spiel je Paarung · Heimrecht: Team der oberen Liga");
  expect(relegationLine({ settings: { relegation: { enabled: true, best_of: 3 } }, has_lower: false })).toBe("Unterste Liga: keine Relegation nach unten");
  expect(relegationLine({ settings: { relegation: { enabled: false } } })).toBe("Keine Relegation");
  expect(championLine({ champion_source: "playoffs" })).toBe("Meister aus den Playoffs");
  expect(championLine({})).toBe("Meister aus der Tabelle");
});

test("das Formular: leere Felder heißen „wie die Vorgabe“, der Körper trägt Zahlen", () => {
  const form = formOf({ playoffs: { enabled: true, per_staffel: 4, best_of: null, third_place: true, home: "draw", start_date: "2031-03-31",
    best_of_rounds: [{ round: 2, best_of: 5 }] }, relegation: { enabled: true, best_of: 3 }, champion_source: "playoffs", reopen_guard: "block" });
  expect(form.playoffs).toMatchObject({ enabled: true, per_staffel: "4", best_of: "", third_place: true, home: "draw", best_of_rounds: [{ round: "2", best_of: "5" }] });
  expect(seasonBody(form)).toEqual({
    playoffs: { enabled: true, per_staffel: 4, best_of: null, third_place: true, home: "draw", start_date: "2031-03-31", best_of_rounds: [{ round: 2, best_of: 5 }] },
    relegation: { enabled: true, best_of: 3, start_date: null }, champion_source: "playoffs", reopen_guard: "block" });
  expect(formOf(null)).toMatchObject({ playoffs: { enabled: false, per_staffel: "", home: "better_seed" }, champion_source: "table", reopen_guard: "hint" });
});

test("die Abweichung einer Liga trägt nur ihre eigenen Teile", () => {
  const form = formOf({ playoffs: { enabled: true, per_staffel: 2 }, relegation: { enabled: true } });
  expect(divisionBody(form, { playoffs: false, relegation: false })).toEqual({});
  expect(Object.keys(divisionBody(form, { playoffs: true, relegation: false }))).toEqual(["playoffs"]);
  expect(divisionBody(form, { playoffs: false, relegation: true })).toEqual({ relegation: { enabled: true, best_of: null, start_date: null } });
});

test("das Formular sagt, was fehlt", () => {
  const form = formOf({ playoffs: { enabled: true } });
  expect(formProblem(form)).toMatch(/wie viele Teams je Staffel/);
  form.playoffs.per_staffel = "4";
  expect(formProblem(form)).toBe("");
  form.playoffs.best_of_rounds = [{ round: "2", best_of: "" }];
  expect(formProblem(form)).toMatch(/Runde und Best of wählen/);
  form.playoffs.best_of_rounds = [{ round: "2", best_of: "5" }, { round: "2", best_of: "7" }];
  expect(formProblem(form)).toMatch(/höchstens einmal/);
  expect(formProblem(formOf(null))).toBe("");
});

test("Los, fehlende Staffeln, Plätze und Zeilen der Relegation", () => {
  expect(lotLine([["Probe A", "Probe B"]])).toBe("Steht gleich und wird beim Anlegen gelost: Probe A, Probe B");
  expect(lotLine([])).toBe("");
  expect(missingLine([{ text: "Die Playoffs von Liga 1 sind noch nicht angelegt." }])).toBe("Die Playoffs von Liga 1 sind noch nicht angelegt.");
  expect(placeText({ rank: 3 })).toBe("3");
  expect(placeText({ rank: 0 })).toBe("–");
  expect(reachedText({ reached: "Halbfinale" })).toBe("Halbfinale");
  expect(reachedText({ reached: "Finale", exit: { kind: "withdrawn" } })).toBe("Finale · zurückgezogen");
  expect(relegationRowText({ side: "upper", result: "lost", outcome_label: "steigt ab" })).toBe("obere Liga · verloren · steigt ab");
  expect(relegationRowText({ side: "lower", result: "none", outcome_label: "bleibt" })).toBe("untere Liga · nicht gespielt · bleibt");
  expect(kindLabel({ kind: "playoff", label: "Playoffs" })).toBe("Playoffs");
  expect(kindLabel({ kind: "relegation" })).toBe("Relegation");
  expect(kindLabel({ staffel: "A" })).toBe("");
});
