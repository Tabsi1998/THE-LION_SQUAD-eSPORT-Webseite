import { checkState, jerseyRequestLine, parseJerseyInput, setByLine, syncNote } from "./jerseyNumber";

// Wunschnummer (#2034, App #2050): dieselben Regeln und Sätze wie im Web (frontend/src/lib/jerseyNumber.test.js).

const range = { min: 0, max: 99 };

test("Eingabe: leer, keine Ziffern, außerhalb des Bereichs, gültig", () => {
  expect(parseJerseyInput("", range)).toEqual({ value: null, error: null });
  expect(parseJerseyInput("7a", range)).toEqual({ value: null, error: "Nur Ziffern, bitte." });
  expect(parseJerseyInput("100", range)).toEqual({ value: 100, error: "Nur Nummern von 0 bis 99." });
  expect(parseJerseyInput(" 07 ", range)).toEqual({ value: 7, error: null });
});

test("Live-Prüfung in Ton und Satz", () => {
  const base = { input: "7", local: null, result: null, busy: false, failed: false };
  expect(checkState({ ...base, input: "" })).toEqual({ tone: "idle", text: "" });
  expect(checkState({ ...base, local: "Nur Ziffern, bitte." })).toEqual({ tone: "bad", text: "Nur Ziffern, bitte." });
  expect(checkState({ ...base, busy: true })).toEqual({ tone: "busy", text: "Prüfe …" });
  expect(checkState({ ...base, failed: true }).tone).toBe("bad");
  expect(checkState({ ...base, result: { number: 7, free: true, text: "Frei." } })).toEqual({ tone: "ok", text: "Frei" });
  expect(checkState({ ...base, result: { number: 7, free: false, reason: "own", text: "Das ist schon deine Nummer." } }).tone).toBe("ok");
  expect(checkState({ ...base, result: { number: 7, free: false, reason: "taken", text: "Diese Nummer hat schon jemand." } }))
    .toEqual({ tone: "bad", text: "Diese Nummer hat schon jemand." });
});

test("Anträge, Herkunft und Abgleich in einem Satz", () => {
  expect(jerseyRequestLine({ current: 7, wished: 6 })).toBe("Statt 7: Wunsch 6");
  expect(jerseyRequestLine({ current: 7, wished: null })).toBe("Statt 7: neu wählen");
  expect(setByLine("board")).toBe("Vom Vorstand eingetragen");
  expect(setByLine("dolibarr")).toBe("Aus der Mitgliederverwaltung");
  expect(setByLine("member")).toBe("Von dir gewählt");
  expect(syncNote({ state: "ok", text: "Steht auch in der Mitgliederverwaltung." })).toBe("");
  expect(syncNote({ state: "off", text: "nicht angebunden" })).toBe("");
  expect(syncNote({ state: "field_missing", text: "Deine Nummer ist hier gesichert." })).toBe("Deine Nummer ist hier gesichert.");
  expect(syncNote(null)).toBe("");
});
