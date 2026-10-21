import { dayFieldErrors, dayPlaces, dayRowPayload, dayTotal, emptyRound, roundCount, roundPoints, usesDayRounds } from "@/lib/tournamentDays";
import { autoPlaces, emptyRow, formToPayload, pastedToRows, sheetToForm } from "@/lib/referenceResults";
import { parseResultPaste } from "@/lib/resultPaste";

// Turniertage im Ergebnisblatt (#1961): Runden R1…Rn, GES P, Platz aus der Tagessumme (Gleichstand, Double Up),
// Rundenmatrix einfügen und der Vertrag zum Server. Nur erfundene Namen.

const SCHEME = [8, 7, 6, 5, 4, 3, 2, 1];
const RULES = { points_mode: "scheme", day_rounds: { count: 5, points_by_place: SCHEME }, custom_bonuses: [{ key: "bingo", label: "Bingo", points: 3 }] };
const rounds = (...points) => points.map((value) => emptyRound({ points: value === null ? "" : String(value) }));

test("Rundenpunkte wie eingetragen, sonst aus dem Platz in der Lobby samt Bots", () => {
  expect(roundPoints({ points: "2", place: "8" }, SCHEME)).toBe(2);
  expect(roundPoints({ points: "", place: "7" }, SCHEME)).toBe(2);
  expect(roundPoints({ points: "", place: "9" }, SCHEME)).toBe(0);
  expect(roundPoints({ points: "", place: "" }, SCHEME)).toBeNull();
  expect(dayTotal({ rounds: rounds(8, 7, null), day_points: "" }, SCHEME)).toBe(15);
  expect(dayTotal({ rounds: rounds(8, 7), day_points: "16" }, SCHEME)).toBe(16);
  expect(dayTotal({ rounds: [], day_points: "" }, SCHEME)).toBeNull();
});

test("Gleichstand teilt den Platz (4, 4, 6), Nichtstart ohne Platz; ohne Tagessumme gilt die Reihenfolge", () => {
  const rows = [
    emptyRow({ name: "Ada", rounds: rounds(8, 8) }), emptyRow({ name: "Bea", rounds: rounds(7, 7) }),
    emptyRow({ name: "Cem", rounds: rounds(6, 6) }), emptyRow({ name: "Dan", rounds: rounds(5, 4) }),
    emptyRow({ name: "Eli", rounds: rounds(4, 5) }), emptyRow({ name: "Fay", rounds: rounds(1, 1) }),
    emptyRow({ name: "Gus", rounds: rounds(3, 3), marks: ["dns"] }),
  ];
  expect(Object.values(autoPlaces(rows, { scheme: SCHEME }))).toEqual([1, 2, 3, 4, 4, 6, null]);
  expect(dayPlaces([emptyRow({ name: "Ada" })], { scheme: SCHEME })).toBeNull();
});

test("Double Up: ein Paar ist eine Einheit (1, 1, 2, 2), auch wenn nur eine Seite den Partner nennt", () => {
  const rows = [
    emptyRow({ name: "Ada", partner: "Bea", rounds: rounds(4, 4) }), emptyRow({ name: "Bea", rounds: rounds(4, 4) }),
    emptyRow({ name: "Cem", partner: "dan", rounds: rounds(3, 3) }), emptyRow({ name: "Dan", partner: "Cem", rounds: rounds(3, 3) }),
  ];
  expect(Object.values(autoPlaces(rows, { scheme: SCHEME, doubleUp: true }))).toEqual([1, 1, 2, 2]);
  // Ohne Double Up zählt jede Zeile für sich - gleiche Summen teilen sich trotzdem den Platz.
  expect(Object.values(autoPlaces(rows, { scheme: SCHEME }))).toEqual([1, 1, 3, 3]);
});

test("Vertrag: Runden, GES P, Partner und Boni nur, wenn eingetragen; das Blatt sagt Double Up", () => {
  const form = sheetToForm(null, []);
  form.doubleUp = true;
  form.rows = [
    emptyRow({ participant_id: "p1", name: "Ada", partner: "bea", rounds: [emptyRound({ points: "8" }), emptyRound({ place: "7", lobby: " B " }), emptyRound()], bonus_keys: ["bingo"] }),
    emptyRow({ name: "Bea", rounds: rounds(8, 2), day_points: "11" }),
    emptyRow({ name: "Cem" }),
  ];
  const { payload } = formToPayload(form, RULES);
  expect(payload.double_up).toBe(true);
  expect(payload.rows[0]).toMatchObject({ participant_id: "p1", place: 1, day_rounds: [{ points: 8 }, { place: 7, lobby: "B" }], partner: { name: "Bea" }, bonus_keys: ["bingo"] });
  expect(payload.rows[1]).toMatchObject({ name: "Bea", place: 1, day_rounds: [{ points: 8 }, { points: 2 }], day_points: 11 });
  expect(payload.rows[1].partner).toBeUndefined();
  expect(payload.rows[2]).not.toHaveProperty("day_rounds");
  expect(dayRowPayload(form.rows[0], { doubleUp: false, reference: () => ({ name: "x" }) }).partner).toBeUndefined();
});

test("gespeichertes Blatt zurück ins Formular: Runden, GES P, Partner mit Namen, Boni, Double Up", () => {
  const form = sheetToForm({ double_up: true, rows: [
    { participant_id: "p1", place: 1, points_source: "scheme", marks: ["left"], day_rounds: [{ points: 8 }, null, { place: 3, lobby: "A" }], day_points: 20, partner_id: "p2", bonus_keys: ["bingo"] },
    { participant_id: "p2", place: 1, points_source: "scheme", marks: [], partner_id: "p1" },
  ] }, [{ id: "p1", name: "Ada" }, { id: "p2", name: "Bea" }]);
  expect(form.doubleUp).toBe(true);
  expect(form.rows[0]).toMatchObject({ partner: "Bea", day_points: "20", bonus_keys: ["bingo"], marks: ["left"] });
  expect(form.rows[0].rounds.map((entry) => [entry.points, entry.place, entry.lobby])).toEqual([["8", "", ""], ["", "", ""], ["", "3", "A"]]);
  expect(roundCount({ day_rounds: { count: 0 } }, form.rows)).toBe(3);
  expect(usesDayRounds({}, [emptyRow({ day_points: "4" })])).toBe(true);
  expect(usesDayRounds({ day_rounds: { count: 0 } }, [emptyRow()])).toBe(false);
});

test("ungültige Runden halten das Blatt auf", () => {
  expect(dayFieldErrors({ rounds: [emptyRound({ points: "acht" }), emptyRound({ place: "0" }), emptyRound({ place: "101" })], day_points: "x" })).toEqual({
    round_0: "R1: Punkte als Zahl.", round_place_1: "R2: Platz als ganze Zahl von 1 bis 100.", round_place_2: "R3: Platz als ganze Zahl von 1 bis 100.", day_points: "GES P als Zahl.",
  });
});

test("Rundenmatrix einfügen: R 1 … R 5, GES P und eine Spalte je Sonderbonus", () => {
  const text = [
    "Platz\tName\tR 1\tR 2\tR 3\tR 4\tR 5\tGES P\tBingo",
    "1\tAda Ausgedacht#TLS\t8\t7\t8\t6\t8\t37\tx",
    "\tBea Beispiel\t5\t6\t-\t\t\t11\t",
    "\tCem Muster\t4\t4\t4\t4\t4\t20\t0",
  ].join("\n");
  const parsed = parseResultPaste(text, { bonuses: RULES.custom_bonuses });
  expect(parsed.header).toBe(true);
  expect(parsed.rows.map((row) => [row.place, row.name, row.rounds, row.day_points, row.bonus_keys])).toEqual([
    [1, "Ada Ausgedacht#TLS", [8, 7, 8, 6, 8], 37, ["bingo"]],
    [null, "Bea Beispiel", [5, 6], 11, []],
    [null, "Cem Muster", [4, 4, 4, 4, 4], 20, []],
  ]);
  const rows = pastedToRows(parsed.rows, []);
  expect(rows[1].rounds.map((entry) => entry.points)).toEqual(["5", "6"]);
  expect(rows[0]).toMatchObject({ day_points: "37", bonus_keys: ["bingo"] });
  // Ohne Spalten der Runden bleibt alles wie bisher.
  expect(parseResultPaste("1. Ada  25").rows[0]).toMatchObject({ rounds: [], day_points: null, bonus_keys: [] });
  // „R1“ ohne Leerzeichen und „Runde 2“ gehen auch.
  expect(parseResultPaste("Name;R1;Runde 2;GES\nAda;8;7;15").rows[0]).toMatchObject({ rounds: [8, 7], day_points: 15 });
});
