// Ergebnis melden (#1132): was das Formular dem Server schickt. Dieselben Fälle prüft die App
// (mobile/src/lib/matchReport.test.ts) - beide lesen matchReport.cases.json.
import cases from "./matchReport.cases.json";
import { REPORT_STATE_TEXT, duelResults, fieldNumber, heatResults, rankingMode } from "./matchReport";

test.each(cases.duel)("Duell: $name", ({ input, results, error }) => {
  const outcome = duelResults(input);
  if (error) expect(outcome).toEqual({ error });
  else expect(outcome).toEqual({ results });
});

test.each(cases.heat)("Durchgang: $name", ({ input, results, error }) => {
  const outcome = heatResults(input.rows, input.mode);
  if (error) expect(outcome).toEqual({ error });
  else expect(outcome).toEqual({ results });
});

test("Zahlen aus dem Feld: leer, Komma, Unsinn, negativ", () => {
  expect(fieldNumber("")).toBeNull();
  expect(fieldNumber(" 3 ")).toBe(3);
  expect(fieldNumber("1,5")).toBe(1.5);
  expect(fieldNumber("abc")).toBeUndefined();
  expect(fieldNumber("-2")).toBeUndefined();
});

test("Wertung aus den Einstellungen des Spiels", () => {
  expect(rankingMode({ settings: { calculation: "fastest-lap" } })).toBe("time");
  expect(rankingMode({ settings: { score_type: "strokes" } })).toBe("lower_score");
  expect(rankingMode({})).toBe("higher_score");
});

test("die Sätze nach dem Melden", () => {
  expect(REPORT_STATE_TEXT.waiting).toBe("Deine Meldung ist da – wartet auf die Gegenseite.");
  expect(REPORT_STATE_TEXT.conflict).toBe("Die Meldungen weichen ab – die Turnierleitung entscheidet.");
});
