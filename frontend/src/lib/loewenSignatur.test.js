import { rankInfo } from "./loewenRang";
import { MAX_DPR, SIGNATURE_FX, SIGNATURE_LAYERS, SIGNATURE_STEPS, canvasDpr, signatureEnabled, signatureFor, signatureLayers } from "./loewenSignatur";

// Löwen-Rang Teil 2 (#1455): Signatur je Rang, Stärke je Level im Rang.

test("Löwenkönig: 55 nur Glanz, 56 Flammen, 57 Knistern, 58 Wolken, 59 Blitze, 60 volles Sturmfeuer", () => {
  const steps = [55, 56, 57, 58, 59, 60].map((level) => signatureFor(level));
  expect(steps.map((s) => s.fx)).toEqual(Array(6).fill("storm"));
  expect(steps.map((s) => Number(s.k.toFixed(2)))).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  expect(steps.map((s) => s.layers)).toEqual([
    [],
    ["flames"],
    ["flames", "crackle"],
    ["flames", "crackle", "clouds"],
    ["flames", "crackle", "clouds", "bolts"],
    ["flames", "crackle", "clouds", "bolts", "fury"],
  ]);
  expect(steps[0].step).toBe("Krone glänzt");
  expect(steps[5].step).toBe("volles Sturmfeuer");
});

test("Stärke k: erstes Level eines Rangs 0, letztes 1 - auch beim kurzen Rang 1 (Level 1–4)", () => {
  expect(signatureFor(1).k).toBe(0);
  expect(signatureFor(2).k).toBeCloseTo(1 / 3, 5);
  expect(signatureFor(4).k).toBe(1);
  expect(signatureFor(30).k).toBe(0);
  expect(signatureFor(32).k).toBe(0.5);
  expect(signatureFor(34).k).toBe(1);
  // außerhalb der Spanne: wie das nächste gültige Level
  expect(signatureFor(0)).toMatchObject({ rank: 1, k: 0 });
  expect(signatureFor(99)).toMatchObject({ rank: 12, k: 1 });
});

test("Effekt je Rang: jede der 12 Signaturen gehört genau einem Rang", () => {
  expect(SIGNATURE_FX).toEqual(["spark", "paw", "ember", "hunt", "frost", "gold", "fire", "roar", "feather", "lava", "sun", "storm"]);
  for (let rank = 1; rank <= 12; rank++) {
    const level = rank === 1 ? 1 : (rank - 1) * 5;
    expect(signatureFor(level)).toMatchObject({ rank, fx: SIGNATURE_FX[rank - 1] });
    expect(SIGNATURE_LAYERS[SIGNATURE_FX[rank - 1]]).toBeTruthy();
  }
  expect(signatureFor(32).fx).toBe("fire");
  expect(signatureFor(9).fx).toBe("paw");
});

test("jeder Rang: erstes Level ohne Effekt, mit jedem Level mehr, beim letzten alle Ebenen", () => {
  for (let rank = 1; rank <= 12; rank++) {
    const { from, to } = rankInfo(rank === 1 ? 1 : (rank - 1) * 5);
    const fx = SIGNATURE_FX[rank - 1];
    expect(signatureFor(from).layers, `Rang ${rank} Level ${from}`).toEqual([]);
    expect(signatureFor(from + 1).layers.length, `Rang ${rank} Level ${from + 1}`).toBeGreaterThan(0);
    expect(signatureFor(to).layers).toEqual(Object.keys(SIGNATURE_LAYERS[fx]));
    let previous = -1;
    for (let level = from; level <= to; level++) {
      const n = signatureFor(level).layers.length;
      expect(n, `Rang ${rank} Level ${level}`).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
    // Für jedes Level gibt es eine Beschreibung.
    expect(SIGNATURE_STEPS[fx]).toHaveLength(to - from + 1);
  }
});

test("signatureLayers: unbekannte Signatur oder Stärke 0 - nichts", () => {
  expect(signatureLayers("rainbow", 1)).toEqual([]);
  expect(signatureLayers("fire", 0)).toEqual([]);
});

test("Bewegung reduzieren: kein Effekt; nur im Profilkopf, nicht in Karten und Listen", () => {
  expect(signatureEnabled({ level: 60 })).toBe(true);
  expect(signatureEnabled({ level: 60, reducedMotion: true })).toBe(false);
  for (const variant of ["card", "list", "mini"]) expect(signatureEnabled({ level: 60, variant })).toBe(false);
  expect(signatureEnabled({ level: 55 })).toBe(false);
});

test("gleiche Regel wie der Rahmen: Effekt genau dann, wenn der Fortschritt im Rang über 0 liegt", () => {
  // LevelAvatarFrame prüft nur `progress > 0`, damit diese Datei nicht ins Haupt-Bundle kommt.
  for (let level = 1; level <= 60; level++) {
    expect(signatureEnabled({ level }), `Level ${level}`).toBe(rankInfo(level).progress > 0);
  }
});

test("Pixeldichte der Leinwand begrenzt", () => {
  expect(canvasDpr(3)).toBe(MAX_DPR);
  expect(canvasDpr(2)).toBe(MAX_DPR);
  expect(canvasDpr(1)).toBe(1);
  expect(canvasDpr(undefined)).toBe(1);
});
