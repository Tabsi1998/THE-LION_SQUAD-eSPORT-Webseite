import { InvalidIdError, idSegment, isValidId } from "./apiIds";
import { loadProblem } from "../components/ListState";

// Kennungen auf dem Weg in den API-Pfad (#1000): einmal dekodiert, geprüft, als genau ein Pfadteil kodiert.

test("normale Kennungen bleiben, wie sie sind", () => {
  expect(idSegment("herbst-lan")).toBe("herbst-lan");
  expect(idSegment("t-1")).toBe("t-1");
  expect(idSegment(42)).toBe("42");
  expect(idSegment("  neonfalke ")).toBe("neonfalke");
});

test("roh oder schon kodiert: dasselbe Ergebnis, nie doppelt kodiert", () => {
  expect(idSegment("löwen-cup")).toBe("l%C3%B6wen-cup");
  expect(idSegment("l%C3%B6wen-cup")).toBe("l%C3%B6wen-cup");
  expect(idSegment("sommer cup")).toBe("sommer%20cup");
  expect(idSegment("sommer%20cup")).toBe("sommer%20cup");
  // Eine kaputte Kodierung bleibt Text und wird sicher kodiert.
  expect(idSegment("100%")).toBe("100%25");
  expect(idSegment("%E0%A4%A")).toBe("%25E0%25A4%25A");
});

test("keine Kennung: leer, Punkte, Pfadzeichen, Steuerzeichen, Überlänge, falscher Typ", () => {
  for (const value of ["", "   ", ".", "..", "%2e%2e", "%2E", "..%2Fadmin%2Fusers", "a/b", "a%2Fb", "a\\b", "a%5Cb","x?y", "x%23y", "a%00b", "a\nb", "x".repeat(201), null, undefined, {}, ["a"], true]) {
    expect([value, isValidId(value)]).toEqual([value, false]);
    expect(() => idSegment(value)).toThrow(InvalidIdError);
  }
});

test("eine ungültige Kennung zeigt der Screen als „nicht gefunden“", () => {
  let error: unknown;
  try {
    idSegment("..");
  } catch (caught) {
    error = caught;
  }
  expect(loadProblem(error).kind).toBe("notFound");
});
