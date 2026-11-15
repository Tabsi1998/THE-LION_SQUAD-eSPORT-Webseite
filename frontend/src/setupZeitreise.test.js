import { afterEach, describe, expect, it, vi } from "vitest";
import { shiftedDateClass } from "./setupZeitreise";

// Die Hilfsuhr der Zeitreise-Probe (#775): springt auf den Tag, läuft weiter und bleibt ein echtes Date.
describe("shiftedDateClass", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("springt auf den Tag und läuft ab dort weiter", async () => {
    const ShiftedDate = shiftedDateClass("2031-01-02T03:04:05Z");
    const first = ShiftedDate.now();
    expect(new ShiftedDate(first).toISOString().slice(0, 10)).toBe("2031-01-02");
    expect(Math.abs(new ShiftedDate().getTime() - first)).toBeLessThan(5000);
    // Eine stehende Uhr ließe Tests kippen, die auf vergangene Zeit warten (useSpamGuard).
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ShiftedDate.now()).toBeGreaterThan(first);
  });

  it("feste Daten, parse, UTC und Date() ohne new bleiben wie beim echten Date", () => {
    const ShiftedDate = shiftedDateClass("2031-01-02T03:04:05Z");
    expect(new ShiftedDate("2026-11-15T12:00:00Z").toISOString()).toBe("2026-11-15T12:00:00.000Z");
    expect(new ShiftedDate(2026, 10, 15).getMonth()).toBe(10);
    expect(ShiftedDate.parse("2026-11-15T00:00:00Z")).toBe(Date.parse("2026-11-15T00:00:00Z"));
    expect(ShiftedDate.UTC(2026, 10, 15)).toBe(Date.UTC(2026, 10, 15));
    expect(ShiftedDate()).toContain("2031");
  });

  it("ist für instanceof dasselbe wie Date, in beide Richtungen", () => {
    const ShiftedDate = shiftedDateClass("2031-01-02T03:04:05Z");
    expect(new ShiftedDate()).toBeInstanceOf(Date);
    expect(new Date()).toBeInstanceOf(ShiftedDate);
    class Termin extends ShiftedDate {}
    expect(new Termin().getFullYear()).toBe(2031);
    expect(new Termin()).toBeInstanceOf(Date);
  });

  it("die Fake-Timer beginnen am verstellten Tag", () => {
    const ShiftedDate = shiftedDateClass("2031-01-02T03:04:05Z");
    const saved = globalThis.Date;
    globalThis.Date = ShiftedDate;
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      expect(new Date().getFullYear()).toBe(2031);
    } finally {
      vi.useRealTimers();
      globalThis.Date = saved;
    }
  });

  it("lehnt einen Wert ab, der kein Datum ist", () => {
    expect(() => shiftedDateClass("+6m")).toThrow(/ISO-Datum/);
  });
});
