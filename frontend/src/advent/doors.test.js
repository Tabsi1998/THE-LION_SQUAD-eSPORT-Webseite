import { DOORS, HINGES, LIGHTS, ORNAMENTS, PLAQUES, SHAPES, cellOf, columnsFor, doorLabel, doorOrder, doorVariant, hingeAt, opensLabel } from "./doors";

// Adventkalender (#641, #732): jedes Türchen anders, aber nach dem Neuladen dasselbe - und am Rand des Kalenders
// schlägt kein Flügel über den Rahmen.

const SEEDS = Array.from({ length: 400 }, (_, index) => 1000003 * (index + 1));

test("dieselbe Saat, dasselbe Türchen - andere Saat, anderes Türchen", () => {
  expect(doorVariant(2280413230)).toEqual(doorVariant(2280413230));
  expect(doorVariant("2280413230")).toEqual(doorVariant(2280413230));
  const kinds = new Set(SEEDS.map((seed) => JSON.stringify(doorVariant(seed))));
  expect(kinds.size).toBeGreaterThan(390);
});

test("jede Eigenheit kommt vor und bleibt in ihren Grenzen", () => {
  const variants = SEEDS.map(doorVariant);
  expect(new Set(variants.map((v) => v.shape))).toEqual(new Set(SHAPES));
  expect(new Set(variants.map((v) => v.hinge))).toEqual(new Set(HINGES));
  expect(new Set(variants.map((v) => v.light.key))).toEqual(new Set(LIGHTS.map((light) => light.key)));
  expect(new Set(variants.map((v) => v.ornament))).toEqual(new Set(ORNAMENTS));
  expect(new Set(variants.map((v) => v.plaque))).toEqual(new Set(PLAQUES));
  for (const v of variants) {
    expect(v.inset).toBeGreaterThanOrEqual(0.085);
    expect(v.inset).toBeLessThanOrEqual(0.135);
    // Etwa im rechten Winkel: weiter aufgeschlagen läge der Flügel über dem Nachbarn.
    expect(v.angle).toBeGreaterThanOrEqual(90);
    expect(v.angle).toBeLessThanOrEqual(98);
    expect(Math.abs(v.tilt)).toBeLessThanOrEqual(1.5);
    expect(v.swing).toBeGreaterThanOrEqual(760);
    expect(v.swing).toBeLessThanOrEqual(1040);
    expect(v.pulse).toBeGreaterThanOrEqual(3.4);
    expect(v.delay).toBeLessThanOrEqual(3);
  }
});

test("runde Türchen: Scharnier nur links oder rechts, Schildchen in der Mitte", () => {
  const round = SEEDS.map(doorVariant).filter((v) => v.shape === "round");
  expect(round.length).toBeGreaterThan(80);
  expect(new Set(round.map((v) => v.hinge))).toEqual(new Set(["left", "right"]));
  expect(new Set(round.map((v) => v.plaque))).toEqual(new Set(["center"]));
});

test("Spalten: 3 am Handy, 4 am Tablet, 6 am PC - 24 geht immer auf", () => {
  expect([320, 358, 559].map(columnsFor)).toEqual([3, 3, 3]);
  expect([560, 704, 899].map(columnsFor)).toEqual([4, 4, 4]);
  expect([900, 1116, 2400].map(columnsFor)).toEqual([6, 6, 6]);
  expect([0, -5, undefined, NaN].map(columnsFor)).toEqual([6, 6, 6, 6]);
  for (const columns of [3, 4, 6]) expect(DOORS % columns).toBe(0);
});

test("Anordnung vom Server - nur wenn sie alle 24 Türchen genau einmal nennt", () => {
  const order = [8, 22, 9, 14, 5, 13, 17, 12, 2, 18, 6, 16, 19, 7, 10, 3, 24, 23, 11, 15, 21, 4, 1, 20];
  const plain = Array.from({ length: 24 }, (_, index) => index + 1);
  expect(doorOrder(order)).toEqual(order);
  expect(doorOrder(order.map(String))).toEqual(order);
  expect(doorOrder(order.slice(1))).toEqual(plain);
  expect(doorOrder([...order.slice(1), 22])).toEqual(plain);
  expect(doorOrder([...order.slice(1), 25])).toEqual(plain);
  expect(doorOrder(null)).toEqual(plain);
});

test("Platz im Raster", () => {
  expect(cellOf(0, 6)).toEqual({ col: 0, row: 0 });
  expect(cellOf(5, 6)).toEqual({ col: 5, row: 0 });
  expect(cellOf(6, 6)).toEqual({ col: 0, row: 1 });
  expect(cellOf(23, 3)).toEqual({ col: 2, row: 7 });
});

test("am Rand schlägt kein Flügel nach außen", () => {
  for (const columns of [3, 4, 6]) {
    const rows = DOORS / columns;
    for (let index = 0; index < DOORS; index += 1) {
      const cell = cellOf(index, columns);
      for (const hinge of HINGES) {
        const used = hingeAt(hinge, cell, columns);
        if (cell.col === 0) expect(["right", "top"]).toContain(used);
        if (cell.col === columns - 1) expect(["left", "top"]).toContain(used);
        if (cell.row === 0) expect(used).not.toBe("top");
        if (cell.col > 0 && cell.col < columns - 1 && cell.row > 0) expect(used).toBe(hinge);
        expect(cell.row).toBeLessThan(rows);
      }
    }
  }
  expect(hingeAt("top", { col: 0, row: 0 }, 6)).toBe("right");
  expect(hingeAt("top", { col: 5, row: 0 }, 6)).toBe("left");
  expect(hingeAt("double", { col: 0, row: 2 }, 6)).toBe("right");
  expect(hingeAt("double", { col: 5, row: 2 }, 6)).toBe("left");
  expect(hingeAt("top", { col: 0, row: 2 }, 6)).toBe("top");
});

test("wann ein Türchen aufgeht - nach der Uhr in Wien", () => {
  expect(opensLabel("2026-12-05T06:00:00+01:00")).toBe("5. Dezember, 6 Uhr");
  expect(opensLabel("2026-12-05T05:00:00Z")).toBe("5. Dezember, 6 Uhr");
  expect(opensLabel("2026-12-13T20:30:00+01:00")).toBe("13. Dezember, 20:30 Uhr");
  expect(opensLabel("2027-01-06T23:59:59+01:00")).toBe("6. Jänner, 23:59 Uhr");
  // Sommerzeit: 22 Uhr UTC ist in Wien schon Mitternacht des nächsten Tages.
  expect(opensLabel("2026-07-31T22:00:00Z")).toBe("1. August, 0 Uhr");
  expect(opensLabel("irgendwann")).toBe("");
});

test("was ein Türchen vorliest", () => {
  const opens_at = "2026-12-20T06:00:00+01:00";
  expect(doorLabel({ day: 20, state: "locked", opens_at })).toBe("Türchen 20 – öffnet sich am 20. Dezember, 6 Uhr");
  expect(doorLabel({ day: 12, state: "available", opens_at })).toBe("Türchen 12 öffnen");
  expect(doorLabel({ day: 12, state: "available", opens_at }, { today: true })).toBe("Türchen 12 öffnen – das heutige");
  expect(doorLabel({ day: 2, state: "opened", opens_at, content: { title: "Kranz-Quiz" } })).toBe("Türchen 2 – geöffnet: Kranz-Quiz");
  expect(doorLabel({ day: 2, state: "opened", opens_at })).toBe("Türchen 2 – geöffnet");
});
