import { checkState, jerseyRequestLine, parseJerseyInput } from "./jerseyNumber";

const range = { min: 0, max: 99 };

test("Eingabe: leer ist kein Fehler, nur Ziffern, Bereich vom Server, 0 ist eine Nummer", () => {
  expect(parseJerseyInput("", range)).toEqual({ value: null, error: null });
  expect(parseJerseyInput("  ", range)).toEqual({ value: null, error: null });
  expect(parseJerseyInput("0", range)).toEqual({ value: 0, error: null });
  expect(parseJerseyInput(" 07 ", range)).toEqual({ value: 7, error: null });
  expect(parseJerseyInput("-1", range).error).toBe("Nur Ziffern, bitte.");
  expect(parseJerseyInput("7a", range).error).toBe("Nur Ziffern, bitte.");
  expect(parseJerseyInput("12345", range).error).toBe("Nur Ziffern, bitte.");
  expect(parseJerseyInput("100", range)).toEqual({ value: 100, error: "Nur Nummern von 0 bis 99." });
});

test("Live-Prüfung: frei, eigene, vergeben, reserviert, prüft gerade, Fehler", () => {
  expect(checkState({ input: "" })).toEqual({ tone: "idle", text: "" });
  expect(checkState({ input: "x", local: "Nur Ziffern, bitte." })).toEqual({ tone: "bad", text: "Nur Ziffern, bitte." });
  expect(checkState({ input: "7", busy: true }).tone).toBe("busy");
  expect(checkState({ input: "7", result: { free: true } })).toEqual({ tone: "ok", text: "Frei" });
  expect(checkState({ input: "7", result: { free: false, reason: "own", text: "Das ist schon deine Nummer." } }).tone).toBe("ok");
  expect(checkState({ input: "7", result: { free: false, reason: "taken", text: "Diese Nummer hat schon jemand." } }))
    .toEqual({ tone: "bad", text: "Diese Nummer hat schon jemand." });
  expect(checkState({ input: "13", result: { free: false, reason: "rule", text: "Diese Nummer hält der Verein frei." } }).text).toMatch(/frei/);
  expect(checkState({ input: "7", failed: true }).tone).toBe("bad");
});

test("Antrag in einer Zeile: mit Wunsch oder als Neuwahl", () => {
  expect(jerseyRequestLine({ current: 7, wished: 8 })).toBe("Statt 7: Wunsch 8");
  expect(jerseyRequestLine({ current: 0, wished: null })).toBe("Statt 0: neu wählen");
  expect(jerseyRequestLine(null)).toBe("");
});
