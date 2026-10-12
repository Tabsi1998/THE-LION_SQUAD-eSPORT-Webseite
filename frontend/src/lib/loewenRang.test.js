import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import RING from "./loewenRangRing.json";
import { FRAME_WIDTHS, LIST_PADDING, RANK_NAMES, frameLayout, framePadding, frameSources, rankForLevel, rankInfo, ringOf } from "./loewenRang";

// Löwen-Rang (#1452, #1454): Rang-Zuordnung wie im Backend, Ausrichtung des Rahmens am gemessenen Ring.

test("12 Ränge mit denselben Namen wie das Backend", () => {
  const backend = readFileSync(path.join(process.cwd(), "../backend/services/levels.py"), "utf8");
  const names = backend.match(/RANK_NAMES = \(([\s\S]*?)\)/)[1].match(/"([^"]+)"/g).map((name) => name.slice(1, -1));
  expect(RANK_NAMES).toEqual(names);
  expect(RANK_NAMES).toHaveLength(12);
});

test("Grenzen: 4/5, 54/55, 60 und außerhalb", () => {
  expect([1, 4, 5, 9, 10, 54, 55, 59, 60].map(rankForLevel)).toEqual([1, 1, 2, 2, 3, 11, 12, 12, 12]);
  expect(rankForLevel(0)).toBe(1);
  expect(rankForLevel(undefined)).toBe(1);
  expect(rankForLevel(99)).toBe(12);
  expect(rankInfo(4)).toMatchObject({ rank: 1, key: "01", name: "Jungtier", from: 1, to: 4, step: 3, pips: 3, filled: 3, max: false });
  expect(rankInfo(5)).toMatchObject({ rank: 2, key: "02", name: "Fährte", from: 5, to: 9, step: 0, pips: 4, filled: 0 });
  expect(rankInfo(9)).toMatchObject({ rank: 2, filled: 4, progress: 1 });
  expect(rankInfo(54)).toMatchObject({ rank: 11, name: "Sonnenlöwe", from: 50, to: 54 });
  expect(rankInfo(55)).toMatchObject({ rank: 12, name: "Löwenkönig", from: 55, to: 60, pips: 5, filled: 0, max: false });
  expect(rankInfo(60)).toMatchObject({ rank: 12, pips: 5, filled: 5, max: true });
});

test("Farben nur Cyan und Gold", () => {
  const colors = new Set(Array.from({ length: 60 }, (_, i) => rankInfo(i + 1).color));
  expect([...colors].sort()).toEqual(["#29B6E8", "#FFD700"]);
});

test("Ausrichtung: der gemessene Ring liegt genau auf dem Foto", () => {
  for (const key of Object.keys(RING)) {
    const ring = ringOf(key);
    const P = 86;
    const { F, ox, oy } = frameLayout(P, ring);
    // Rahmenmitte liegt bei (ox, oy) relativ zur Fotomitte; der Ring sitzt bei (cx, cy) im Bild.
    const ringX = ox + (ring.cx - 0.5) * F;
    const ringY = oy + (ring.cy - 0.5) * F;
    expect(Math.abs(ringX)).toBeLessThan(1e-9);
    expect(Math.abs(ringY)).toBeLessThan(1e-9);
    expect(ring.r * F).toBeCloseTo(P, 9);
  }
  // Rang 7: Löwenkopf oben, das Loch liegt tiefer - der Rahmen wandert nach oben.
  expect(frameLayout(86, ringOf("07")).oy).toBeLessThan(-10);
});

test("12 Rahmen mit Geometrie und drei Bildgrößen", () => {
  expect(Object.keys(RING).sort()).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")));
  for (const [key, ring] of Object.entries(RING)) {
    expect(ring.r).toBeGreaterThan(0.2);
    expect(ring.r).toBeLessThan(0.4);
    expect(Math.abs(ring.cx - 0.5)).toBeLessThan(0.06);
    expect(Math.abs(ring.cy - 0.5)).toBeLessThan(0.06);
    expect(ring.v).toMatch(/^[0-9a-f]{8}$/);
    const [left, top, right, bottom] = ring.box;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(1);
    expect(bottom).toBeLessThanOrEqual(1);
    expect(left < ring.cx - ring.r && right > ring.cx + ring.r && top < ring.cy - ring.r && bottom > ring.cy + ring.r).toBe(true);
    for (const width of FRAME_WIDTHS) {
      expect(existsSync(path.join(process.cwd(), `public/assets/loewen-rang/rang-${key}-${width}.webp`))).toBe(true);
    }
  }
  expect(ringOf("99")).toBe(RING["01"]);
});

test("Bildquellen: srcset über drei Breiten, Maske passend zur Größe", () => {
  const src = frameSources("12", 100);
  expect(src.srcSet).toBe(FRAME_WIDTHS.map((w) => `/assets/loewen-rang/rang-12-${w}.webp?v=${RING["12"].v} ${w}w`).join(", "));
  expect(src.mask).toContain("rang-12-320.webp");
  expect(frameSources("12", 340).mask).toContain("rang-12-640.webp");
  expect(frameSources("01", 60).mask).toContain("rang-01-160.webp");
});

test("Platz: für alle 12 Ränge liegt die Grafik in der reservierten Box", () => {
  for (const key of Object.keys(RING)) {
    const ring = ringOf(key);
    const D = 100;
    const { F, ox, oy } = frameLayout(D / 2, ring);
    const [left, top, right, bottom] = ring.box;
    // Grafik in Koordinaten um die Fotomitte; die Box reicht vom Foto aus um den Außenabstand je Seite.
    const art = { left: ox - F / 2 + left * F, top: oy - F / 2 + top * F, right: ox - F / 2 + right * F, bottom: oy - F / 2 + bottom * F };
    for (const [name, pad] of [["eigener", framePadding(ring)], ["Listen", LIST_PADDING]]) {
      const [pt, pr, pb, pl] = pad.map((value) => value * D);
      expect(art.top, `${key} ${name} oben`).toBeGreaterThanOrEqual(-D / 2 - pt - 1e-9);
      expect(art.right, `${key} ${name} rechts`).toBeLessThanOrEqual(D / 2 + pr + 1e-9);
      expect(art.bottom, `${key} ${name} unten`).toBeLessThanOrEqual(D / 2 + pb + 1e-9);
      expect(art.left, `${key} ${name} links`).toBeGreaterThanOrEqual(-D / 2 - pl - 1e-9);
    }
    // eng: der eigene Abstand ist nicht größer als nötig (Rundung auf drei Stellen)
    const own = framePadding(ring).map((value) => value * D);
    expect(own[0] - (-D / 2 - art.top) < 0.11 || own[0] === 0).toBe(true);
    expect(own[2] - (art.bottom - D / 2) < 0.11 || own[2] === 0).toBe(true);
  }
  // Niedrige Ränge brauchen weniger Platz als hohe - das Profil wächst nicht pauschal.
  expect(framePadding(ringOf("01"))[1]).toBeLessThan(framePadding(ringOf("12"))[1]);
  expect(LIST_PADDING.every((value) => value > 0 && value < 0.7)).toBe(true);
});
