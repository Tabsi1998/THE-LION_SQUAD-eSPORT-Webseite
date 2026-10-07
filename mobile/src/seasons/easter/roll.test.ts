import { hashString } from "../rng";
import { EGG_PATTERNS } from "./plan";
import { ROLL, cardEggPlan, eggBox, lyingHalf, rollPose, rollStep, tiltFrames, wayFrames } from "./roll";

// Ein Ei auf der Kante einer Karte (#1092) - dieselbe Rechnung wie im Web (frontend/src/seasons/easter/roll.test.js,
// derselbe Fingerabdruck): wackelt zweimal, rollt höchstens sechs Punkte zur näheren Ecke, nie über die Ecke.

/** Fingerabdruck der Web-Rechnung (roll.js) für dieselben Eingaben. */
const ROLL_PARITY = 277106003;

test("das Ei einer Karte: liegt auf der Seite, nahe einer Ecke, rollt zu ihr hin", () => {
  for (let n = 0; n < 30; n += 1) {
    const plan = cardEggPlan(360, `easter:2027:NewsList:${n}`);
    expect(EGG_PATTERNS).toContain(plan.pattern);
    expect(plan.dir).toBe(plan.x < 180 ? -1 : 1);
    expect(plan.x + plan.dir * plan.room).toBeCloseTo(plan.dir < 0 ? ROLL.margin : 360 - ROLL.margin, 0);
    const box = eggBox(plan);
    expect(box.top).toBeLessThan(0);
    expect(box.bottom).toBe(0);
  }
});

test("je Antippen höchstens sechs Punkte, nie über die Ecke", () => {
  const plan = { dir: 1 as const, room: 14 };
  expect([0, 6, 12, 14].map((offset) => rollStep(offset, plan))).toEqual([6, 12, 14, 14]);
});

test("Animationen: erst wackeln, dann rollen, am Ende am neuen Platz und gerade", () => {
  const tilt = tiltFrames(-28);
  expect(tilt.inputRange).toEqual([0, 0.12, 0.24, 0.36, 0.48, 0.7, 0.86, 0.94, 1]);
  expect(tilt.outputRange).toEqual(["0deg", "-9deg", "8.01deg", "-5.04deg", "0deg", "-28deg", "5.88deg", "-1.96deg", "0deg"]);
  const way = wayFrames(0, -6);
  expect(way.inputRange).toEqual([0, 0.48, 0.7, 0.86, 0.94, 1]);
  expect(way.outputRange).toEqual([0, 0, -3.72, -6, -6, -6]);
  expect(rollPose(ROLL.ms, 0, -6, -1)).toEqual({ angle: 0, x: -6 });
});

test("Parität mit dem Web: dieselben Zahlen, dieselben Eier", () => {
  const sample = {
    roll: ROLL,
    plans: [cardEggPlan(354, "egg:dashboard"), cardEggPlan(412, "easter:2027:Dashboard:2"), cardEggPlan(180, "easter:2027:/news:0")],
    halves: [[13, 70], [14.5, -80], [12.5, 66]].map(([size, lean]) => lyingHalf(size, lean)),
    steps: ([[0, { dir: 1, room: 20 }], [6, { dir: 1, room: 8 }], [-3, { dir: -1, room: 30 }]] as Array<[number, { dir: -1 | 1; room: number }]>).map(([offset, plan]) => rollStep(offset, plan)),
    poses: [0, 60, 130, 259, 400, 518, 600, 756, 900, 1000, 1080].map((ms) => rollPose(ms, 2, -4, -1)),
  };
  expect(hashString(JSON.stringify(sample))).toBe(ROLL_PARITY);
});
