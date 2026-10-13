import { ASCENT_BURSTS, ASCENT_FX, ASCENT_TIMING, ascentMoment, burstDelay } from "./loewenAufstieg";
import { SIGNATURE_FX } from "./loewenSignatur";

// Löwen-Rang Teil 3 (#1456): welcher Aufstiegs-Moment zu welchem Level-Aufstieg gehört.

describe("ascentMoment", () => {
  it("Level im Rang: kleiner Moment, die neuen Rauten springen auf", () => {
    const moment = ascentMoment({ level: 12, previous: 11 });
    expect(moment).toMatchObject({ kind: "level", level: 12, previous: 11, fx: "ember", strong: false, particles: true, reduced: false });
    expect(moment.from.rank).toBe(3);
    expect(moment.to.rank).toBe(3);
    // Rang 3 (10–14): Level 11 hat eine Raute, Level 12 zwei - die zweite springt auf.
    expect(moment.pops).toEqual([1]);
    // Mehrere Level auf einmal im selben Rang: alle neuen Rauten nacheinander.
    expect(ascentMoment({ level: 14, previous: 11 }).pops).toEqual([1, 2, 3]);
  });

  it("Rangwechsel: großer Moment des neuen Rangs", () => {
    const moment = ascentMoment({ level: 25, previous: 24 });
    expect(moment).toMatchObject({ kind: "rank", fx: "gold", strong: true, burst: ASCENT_BURSTS.gold });
    expect(moment.from.name).toBe("Silbermähne");
    expect(moment.to.name).toBe("Goldmähne");
    // Erstes Level eines Rangs: noch keine Raute gefüllt.
    expect(moment.pops).toEqual([]);
    // Ein Sprung über einen Rang hinweg zeigt den Moment des Rangs, in dem man landet, und füllt dessen Rauten.
    const jump = ascentMoment({ level: 17, previous: 8 });
    expect(jump).toMatchObject({ kind: "rank", fx: "hunt" });
    expect(jump.pops).toEqual([0, 1]);
    // Level 4 → 5: Jungtier → Fährte; 54 → 55: Sonnenlöwe → Löwenkönig mit doppeltem Blitzeinschlag.
    expect(ascentMoment({ level: 5, previous: 4 })).toMatchObject({ kind: "rank", fx: "paw" });
    expect(ascentMoment({ level: 55, previous: 54 })).toMatchObject({ kind: "rank", fx: "storm" });
  });

  it("Level 60 bekommt den großen Moment, auch ohne Rangwechsel", () => {
    expect(ascentMoment({ level: 60, previous: 59 })).toMatchObject({ kind: "level", strong: true, fx: "storm", pops: [4] });
  });

  it("kein Moment: Prestige, kein Aufstieg, fehlende Daten", () => {
    expect(ascentMoment({ level: 1, previous: 60, prestige: 1, prestigeGained: true })).toBeNull();
    expect(ascentMoment({ level: 12, previous: 12 })).toBeNull();
    expect(ascentMoment({ level: 11, previous: 12 })).toBeNull();
    expect(ascentMoment(null)).toBeNull();
    expect(ascentMoment({})).toBeNull();
    // Ohne Vorgänger gilt das Level davor.
    expect(ascentMoment({ level: 15 })).toMatchObject({ kind: "rank", previous: 14 });
  });

  it("Bewegung reduzieren: nur Ein- und Ausblenden - keine Partikel, keine springenden Rauten", () => {
    const level = ascentMoment({ level: 13, previous: 11 }, { reduced: true });
    expect(level).toMatchObject({ kind: "level", particles: false, reduced: true, pops: [] });
    const rank = ascentMoment({ level: 30, previous: 29 }, { reduced: true });
    expect(rank).toMatchObject({ kind: "rank", particles: false, reduced: true, pops: [] });
  });

  it("jeder Rang hat seinen großen Moment, in derselben Reihenfolge wie die Signatur", () => {
    expect(ASCENT_FX).toEqual(SIGNATURE_FX);
    for (const fx of SIGNATURE_FX) expect(ASCENT_BURSTS[fx], fx).toBeTruthy();
    // Und der Moment eines Rangs ist die Signatur desselben Rangs.
    expect(ascentMoment({ level: 3, previous: 2 })).toMatchObject({ kind: "level", fx: "spark" });
    for (let rank = 2; rank <= 12; rank++) {
      const level = (rank - 1) * 5;
      const moment = ascentMoment({ level, previous: level - 1 });
      expect(moment.kind, `Rang ${rank}`).toBe("rank");
      expect(moment.fx, `Rang ${rank}`).toBe(SIGNATURE_FX[rank - 1]);
    }
  });
});

describe("burstDelay", () => {
  it("der große Moment wartet, bis der alte Rahmen weggeblitzt ist", () => {
    expect(burstDelay("rank")).toBeCloseTo((ASCENT_TIMING.hold + ASCENT_TIMING.out) / 1000, 6);
    expect(burstDelay("level")).toBeLessThan(burstDelay("rank"));
    expect(burstDelay("level")).toBeGreaterThan(ASCENT_TIMING.hold / 1000);
  });
});
