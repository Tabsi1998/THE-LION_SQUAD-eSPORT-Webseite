import fs from "fs";
import path from "path";
import GEOMETRY from "../../assets/loewen-rang/geometry.json";
import {
  FRAME_SIZES,
  FRAME_WIDTHS,
  MAX_OVERHANG_SHARE,
  MAX_PARTICLES,
  PLATE_OVERLAP,
  PROFILE_WIDE,
  RANK_NAMES,
  TOP_OVERHANG,
  areaFor,
  frameAnimated,
  frameBox,
  frameFit,
  frameLabel,
  frameLayout,
  framePadding,
  frameWidthFor,
  overhangSpace,
  plateSpace,
  plateTag,
  prestigeCount,
  rankForLevel,
  rankInfo,
  ringOf,
  shineStrength,
  signaturePlan,
  type FrameVariant,
} from "./loewenRang";

// Löwen-Rang in der App (#1457): dieselbe Rechnung wie im Web. Die Fälle in frontend/src/lib/loewenRang.cases.json
// prüft auch der Web-Test (frontend/src/lib/loewenRang.test.js) - ändert jemand die Rechnung auf einer Seite, wird
// der Test der anderen rot.

const ROOT = path.join(__dirname, "../../..");
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, "frontend/src/lib/loewenRang.cases.json"), "utf8"));
const WEB_RING = JSON.parse(fs.readFileSync(path.join(ROOT, "frontend/src/lib/loewenRangRing.json"), "utf8"));
const KEYS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

test("12 Ränge mit denselben Namen wie das Backend", () => {
  const backend = fs.readFileSync(path.join(ROOT, "backend/services/levels.py"), "utf8");
  const names = (backend.match(/RANK_NAMES = \(([\s\S]*?)\)/)?.[1].match(/"([^"]+)"/g) || []).map((name) => name.slice(1, -1));
  expect(RANK_NAMES).toEqual(names);
  expect(RANK_NAMES).toHaveLength(12);
});

test("dieselben Werte wie im Web: Rang, Name, Rauten und Fortschritt für alle 60 Level", () => {
  expect(CASES.levels).toHaveLength(60);
  for (const expected of CASES.levels) expect(rankInfo(expected.level)).toEqual(expected);
});

test("dieselben Werte wie im Web: Fläche, Foto und Versatz für alle 12 Rahmen", () => {
  expect(CASES.frames.map((frame: { key: string }) => frame.key)).toEqual(KEYS);
  for (const { key, fit, pad, layout } of CASES.frames) {
    const ring = ringOf(key);
    expect(frameFit(ring)).toEqual(fit);
    expect(framePadding(ring)).toEqual(pad);
    expect(frameLayout(0.5, ring)).toEqual(layout);
  }
});

test("die Geometrie der App ist dieselbe wie im Web", () => {
  const app = GEOMETRY as unknown as Record<string, { cx: number; cy: number; r: number; box: number[]; v: string; edge: number[][] }>;
  expect(Object.keys(app).sort()).toEqual(KEYS);
  for (const key of KEYS) {
    const { cx, cy, r, box, v } = app[key];
    expect({ cx, cy, r, box, v }).toEqual(WEB_RING[key]);
    expect(app[key].edge.length).toBeGreaterThan(24);
  }
  expect(ringOf("99")).toBe(ringOf("01"));
});

test("Grenzen: 4/5, 54/55, 60 und außerhalb", () => {
  expect([1, 4, 5, 9, 10, 54, 55, 59, 60].map(rankForLevel)).toEqual([1, 1, 2, 2, 3, 11, 12, 12, 12]);
  expect([0, undefined, null, "abc", 99].map(rankForLevel)).toEqual([1, 1, 1, 1, 12]);
  expect(rankInfo(9)).toMatchObject({ rank: 2, name: "Fährte", pips: 4, filled: 4, progress: 1 });
  expect(rankInfo(60)).toMatchObject({ rank: 12, pips: 5, filled: 5, max: true });
});

// Kleinstes Foto als Anteil der Fläche: Rang 9 mit den Schwingen bis an beide Ränder (wie im Web).
const MIN_PHOTO = 0.48;
const VARIANTS = Object.keys(FRAME_SIZES) as FrameVariant[];

test("feste Fläche je Größe: seitlich und unten passt der Rahmen hinein, oben höchstens 15 % Überstand", () => {
  for (const area of [...Object.values(FRAME_SIZES), PROFILE_WIDE]) {
    for (let rank = 1; rank <= 12; rank += 1) {
      const level = Math.max(1, (rank - 1) * 5);
      const box = frameBox(level, area);
      const [left, top, right, bottom] = box.ring.box;
      const { size, left: artLeft, top: artTop } = box.art;
      expect(box.info.rank).toBe(rank);
      expect(artLeft + left * size).toBeGreaterThanOrEqual(-1e-6);
      expect(artLeft + right * size).toBeLessThanOrEqual(area + 1e-6);
      expect(artTop + bottom * size).toBeLessThanOrEqual(area + 1e-6);
      expect(artTop + top * size).toBeGreaterThanOrEqual(-TOP_OVERHANG * area - 1e-6);
      // Der gemessene Ring liegt genau auf dem Foto.
      expect(artLeft + box.ring.cx * size).toBeCloseTo(box.photoLeft + box.photo / 2, 6);
      expect(artTop + box.ring.cy * size).toBeCloseTo(box.photoTop + box.photo / 2, 6);
      expect(box.ring.r * size).toBeCloseTo(box.photo / 2, 6);
      expect(box.photo / area).toBeGreaterThanOrEqual(MIN_PHOTO);
      // Das Schild hängt 10 Punkte in der Grafik, unter dem Foto.
      expect(box.plateTop).toBeCloseTo(artTop + bottom * size - PLATE_OVERLAP, 1);
    }
  }
  // Rang 1 bekommt ein großes Foto, Rang 12 ein kleineres - die Fläche bleibt gleich.
  expect(frameBox(1, 220).photo).toBeGreaterThan(frameBox(60, 220).photo);
  expect(frameBox(1, 220).area).toBe(frameBox(60, 220).area);
});

test("Größen: Profil 220 (Tablet 285), Karte 150, Liste 92, Podest 64", () => {
  expect(VARIANTS.map((variant) => areaFor(variant, 390))).toEqual([220, 150, 92, 64]);
  expect(areaFor("profile", 800)).toBe(285);
  expect(areaFor("list", 800)).toBe(92);
});

test("Bildgröße: die kleinste der drei Breiten, die in Gerätepixeln reicht", () => {
  expect(frameWidthFor(50, 3)).toBe(160);
  expect(frameWidthFor(100, 2)).toBe(320);
  expect(frameWidthFor(200, 3)).toBe(640);
  expect(frameWidthFor(400, 3)).toBe(640);
  for (const key of KEYS) {
    for (const width of FRAME_WIDTHS) expect(fs.existsSync(path.join(__dirname, `../../assets/loewen-rang/rang-${key}-${width}.webp`))).toBe(true);
  }
});

test("Schild: LVL, MAX, Team, Prestige-Sterne und Platz darunter", () => {
  expect(plateTag(9)).toBe("LVL 9");
  expect(plateTag(60)).toBe("LVL 60 · MAX");
  expect(plateTag(12, { team: true })).toBe("TEAM LVL 12");
  expect([undefined, -1, 0, 2.7, 9].map(prestigeCount)).toEqual([0, 0, 0, 2, 5]);
  expect([plateSpace("profile", 0), plateSpace("profile", 2), plateSpace("card", 0), plateSpace("card", 1), plateSpace("list", 3), plateSpace("mini", 0)]).toEqual([26, 41, 21, 35, 0, 0]);
});

test("zugänglicher Name: Level und Rang, Name vom Server", () => {
  expect(frameLabel(9)).toBe("Level 9, Rang Fährte");
  expect(frameLabel(9, { rankName: "Fährte", prestige: 2 })).toBe("Level 9, Rang Fährte, Prestige 2");
  expect(frameLabel(14, { team: true })).toBe("Team-Level 14, Rang Rudel");
  expect(frameLabel(undefined)).toBe("Level 1, Rang Jungtier");
});

test("Signatur: vier Arten, Stärke nach Level im Rang, wenige Teilchen", () => {
  const kinds = new Set(Array.from({ length: 60 }, (_, index) => signaturePlan(index + 1).kind));
  expect([...kinds].sort()).toEqual(["blitz", "frost", "glut", "funken"].sort());
  expect(Array.from({ length: 12 }, (_, index) => signaturePlan(Math.max(1, index * 5)).kind)).toEqual([
    "funken", "funken", "glut", "funken", "frost", "funken", "glut", "blitz", "frost", "glut", "glut", "blitz",
  ]);
  // Erstes Level im Rang: noch keine Teilchen; dann mehr, höchstens sechs.
  expect([5, 6, 7, 8, 9].map((level) => signaturePlan(level).count)).toEqual([0, 3, 4, 5, 6]);
  expect([55, 56, 60].map((level) => signaturePlan(level).count)).toEqual([0, 3, 6]);
  for (let level = 1; level <= 60; level += 1) expect(signaturePlan(level).count).toBeLessThanOrEqual(MAX_PARTICLES);
  expect(shineStrength(5)).toBeCloseTo(0.35);
  expect(shineStrength(9)).toBeCloseTo(0.9);
});

test("Bewegung nur im Profil und nie bei „Bewegung reduzieren“", () => {
  expect(frameAnimated("profile", false)).toBe(true);
  expect(frameAnimated("profile", true)).toBe(false);
  for (const variant of ["card", "list", "mini"] as FrameVariant[]) expect(frameAnimated(variant, false)).toBe(false);
});

test("Listen und Podest halten oben Platz für den Überstand frei - kein Rahmen malt in die Zeile darüber", () => {
  expect([overhangSpace("list", 92), overhangSpace("mini", 64), overhangSpace("profile", 220), overhangSpace("card", 150)]).toEqual([7, 5, 0, 0]);
  for (const variant of ["list", "mini"] as FrameVariant[]) {
    const area = FRAME_SIZES[variant];
    for (let level = 1; level <= 60; level += 1) {
      const box = frameBox(level, area);
      expect(box.overhang).toBeGreaterThanOrEqual(0);
      expect(box.overhang).toBeLessThanOrEqual(overhangSpace(variant, area));
    }
  }
  // Am weitesten ragt Rang 1 hinaus (großes Foto, Pfote oben), Rang 9 mit den Schwingen gar nicht.
  expect(frameBox(1, 92).overhang).toBeGreaterThan(5);
  expect(frameBox(40, 92).overhang).toBe(0);
  expect(MAX_OVERHANG_SHARE).toBeLessThanOrEqual(TOP_OVERHANG);
});
