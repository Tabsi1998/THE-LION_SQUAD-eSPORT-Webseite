// Die Hilfsuhr der Zeitreise-Probe (#775): springt auf den Tag, läuft weiter und bleibt ein echtes Date.
const { shiftedDateClass } = require("../../jest.zeitreise-date");

describe("shiftedDateClass", () => {
  it("springt auf den Tag und läuft ab dort weiter", async () => {
    const ShiftedDate = shiftedDateClass("2031-01-02T03:04:05Z", Date);
    const first = ShiftedDate.now();
    expect(new ShiftedDate(first).toISOString().slice(0, 10)).toBe("2031-01-02");
    expect(Math.abs(new ShiftedDate().getTime() - first)).toBeLessThan(5000);
    // Eine stehende Uhr ließe Tests kippen, die auf vergangene Zeit warten.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ShiftedDate.now()).toBeGreaterThan(first);
  });

  it("feste Daten, parse, UTC und Date() ohne new bleiben wie beim echten Date", () => {
    const ShiftedDate = shiftedDateClass("2031-01-02T03:04:05Z", Date);
    expect(new ShiftedDate("2026-11-15T12:00:00Z").toISOString()).toBe("2026-11-15T12:00:00.000Z");
    expect(new ShiftedDate(2026, 10, 15).getMonth()).toBe(10);
    expect(ShiftedDate.parse("2026-11-15T00:00:00Z")).toBe(Date.parse("2026-11-15T00:00:00Z"));
    expect(ShiftedDate.UTC(2026, 10, 15)).toBe(Date.UTC(2026, 10, 15));
    expect(ShiftedDate()).toContain("2031");
  });

  it("ist für instanceof dasselbe wie Date, in beide Richtungen", () => {
    const ShiftedDate = shiftedDateClass("2031-01-02T03:04:05Z", Date);
    expect(new ShiftedDate()).toBeInstanceOf(Date);
    expect(new Date()).toBeInstanceOf(ShiftedDate);
  });

  it("lehnt einen Wert ab, der kein Datum ist", () => {
    expect(() => shiftedDateClass("+6m", Date)).toThrow(/ISO-Datum/);
  });
});
