import {
  PARTNER_STATES, applyBody, applySummary, changeLines, countsText, defaultSelection, isSelectable, sourceHost, targetText,
} from "./partnerSource";

// Partner-Plattform (#1964): was die Vorschau je Turnier zeigt - Zustand, Ziel, Zahlen, Abweichungen - und was
// Übernehmen schickt. Nur erfundene Namen.

const item = (extra = {}) => ({
  ref: "901", name: "Turnier 1", club_day: "2026-09-25", state: "new", action: "new", round: null, sheet: null,
  target: "sheet", expected_version: 0, fingerprint: "abc", counts: null, changes: [], ...extra,
});

test("jeder Zustand hat einen Namen; wählbar sind nur Zustände, die etwas tun", () => {
  for (const state of ["new", "changed", "same", "new_round", "link", "waiting", "error"]) expect(PARTNER_STATES[state].label).toBeTruthy();
  expect(["new", "changed", "new_round", "link"].map((state) => isSelectable(item({ state })))).toEqual([true, true, true, true]);
  expect(["same", "waiting", "error"].map((state) => isSelectable(item({ state })))).toEqual([false, false, false]);
});

test("vorgewählt ist nur, was nichts Vorhandenes ersetzt – Abweichungen hakt der Vorstand selbst an", () => {
  const items = [item({ ref: "1" }), item({ ref: "2", state: "changed" }), item({ ref: "3", state: "new_round" }), item({ ref: "4", state: "link" }), item({ ref: "5", state: "same" })];
  expect(defaultSelection(items)).toEqual(["1", "3", "4"]);
});

test("das Ziel sagt, welcher Termin und was mit dem Blatt passiert", () => {
  expect(targetText(item())).toBe("Neuer Termin · Ergebnis als Entwurf");
  expect(targetText(item({ action: "assign", round: { id: "r1", code: "T1", position: 1 }, target: "draft", state: "changed" })))
    .toBe("T1 · Entwurf wird ersetzt");
  expect(targetText(item({ action: "linked", round: { id: "r2", code: null, position: 2 }, target: "pending_draft", state: "changed" })))
    .toBe("Termin 2 · Entwurf neben dem veröffentlichten Ergebnis – du gibst ihn frei");
  expect(targetText(item({ action: "linked", round: { id: "r2", position: 2 }, target: "draft", state: "same" }))).toBe("Termin 2 · schon übernommen");
  expect(targetText(item({ action: "new", finished: false, state: "new_round", target: null }))).toBe("Neuer Termin · Ergebnis folgt, wenn das Turnier fertig ist");
  expect(targetText(item({ action: "assign", round: { id: "r3", code: "T3" }, finished: false, state: "link", target: null }))).toBe("T3 · wird verknüpft");
});

test("Zahlen in der Einzahl und Mehrzahl, Bots und Gäste nur, wenn es welche gibt", () => {
  expect(countsText({ players: 6, rounds: 3, lobbies: 4, bots: 1, guests: 1 })).toBe("6 Spieler · 3 Runden · 4 Lobbys · 1 Bot · 1 Gast");
  expect(countsText({ players: 8, rounds: 1, lobbies: 1, bots: 2, guests: 0 })).toBe("8 Spieler · 1 Runde · 1 Lobby · 2 Bots");
  expect(countsText(null)).toBe("");
});

test("Abweichungen lesbar: Platz, Tagespunkte, Rundenpunkte, Marken, neu, fällt weg, Double Up", () => {
  const changes = [
    { participant_id: "p-a", name: "Ada Ausgedacht", kind: "changed", fields: {
      place: [1, 2], day_points: [null, 23], day_rounds: [[{ points: 8 }, null], [{ points: 8 }, { points: 2 }, { place: 3 }]],
      marks: [[], ["left"]], partner_id: ["p-b", "p-c"] } },
    { participant_id: "neu:dario", name: "Dario Demo#1234", kind: "added", fields: {} },
    { participant_id: "p-c", name: "Cleo Muster", kind: "removed", fields: {} },
    { participant_id: null, name: "", kind: "sheet", fields: { double_up: [false, true] } },
  ];
  expect(changeLines(changes)).toEqual([
    { key: "p-a", name: "Ada Ausgedacht", text: "Platz 1 → 2 · Tagespunkte – → 23 · Runden 8 · – → 8 · 2 · P3 · ausgestiegen · Partner geändert" },
    { key: "neu:dario", name: "Dario Demo#1234", text: "kommt neu dazu" },
    { key: "p-c", name: "Cleo Muster", text: "fehlt beim Partner – fällt weg" },
    { key: "sheet", name: "Ganzes Blatt", text: "Double Up: nein → ja" },
  ]);
  expect(changeLines([{ participant_id: "p", name: "X", kind: "changed", fields: { marks: [["left"], []] } }])[0].text).toBe("nicht mehr ausgestiegen");
});

test("jede Abweichung bei Marken ist lesbar, nicht nur „Ausgestiegen“ (Prüfer)", () => {
  const line = (before, after) => changeLines([{ participant_id: "p", name: "X", kind: "changed", fields: { marks: [before, after] } }])[0].text;
  expect(line(["dsq"], ["dsq", "left"])).toBe("ausgestiegen");
  expect(line(["dns", "dsq"], [])).toBe("nicht mehr DNS · nicht mehr DSQ");
  expect(line([], ["dnf", "fastest_lap"])).toBe("DNF · Schnellste Runde");
  expect(line(["pole"], ["left"])).toBe("ausgestiegen · nicht mehr Pole");
});

test("gleiche Rundenpunkte: es kommen nur Platz und Lobby dazu bzw. sie ändern sich", () => {
  const typed = [{ points: 8 }, { points: 7 }];
  const fetched = [{ place: 1, points: 8, lobby: "1" }, { place: 2, points: 7, lobby: "2" }];
  const line = (before, after) => changeLines([{ participant_id: "p", name: "X", kind: "changed", fields: { day_rounds: [before, after] } }])[0].text;
  expect(line(typed, fetched)).toBe("Runden: Platz und Lobby ergänzt");
  expect(line(fetched, [{ place: 1, points: 8, lobby: "2" }, fetched[1]])).toBe("Runden: Platz bzw. Lobby geändert");
});

test("Übernehmen schickt genau, was die Vorschau gezeigt hat", () => {
  const items = [item({ ref: "1", fingerprint: "f1", expected_version: 0 }), item({ ref: "2", fingerprint: "f2", expected_version: 3, round: { id: "r2" } })];
  expect(applyBody(items, ["2"])).toEqual({ items: [{ ref: "2", fingerprint: "f2", expected_version: 3, round_id: "r2" }] });
});

test("die Rückmeldung zählt Entwürfe, Termine und Konflikte", () => {
  expect(applySummary([{ status: "saved" }, { status: "saved" }, { status: "round" }, { status: "same" }]))
    .toEqual({ ok: true, text: "2 Ergebnisse als Entwurf übernommen · 1 Termin angelegt bzw. verknüpft." });
  expect(applySummary([{ status: "saved" }, { status: "conflict" }, { status: "error", message: "kaputt" }]))
    .toEqual({ ok: false, text: "1 Ergebnis als Entwurf übernommen · 1 hat sich seit der Vorschau geändert – bitte neu holen · 1 mit Fehler." });
  expect(applySummary([{ status: "same" }])).toEqual({ ok: true, text: "Nichts zu übernehmen – alles ist schon da." });
});

test("die Adresse der Plattform ohne https", () => {
  expect(sourceHost("https://tft.pineapps.at")).toBe("tft.pineapps.at");
  expect(sourceHost("")).toBe("");
});
