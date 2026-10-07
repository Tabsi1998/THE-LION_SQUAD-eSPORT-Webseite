import { readFileSync } from "node:fs";
import path from "node:path";
import { hashString } from "../rng";
import { PATTERN_NAMES } from "../easterHunt/EggShape";
import { ROLL, cardEggPlan, eggBox, lyingHalf, rollPose, rollStep } from "./roll";

// Ein Ei auf der Kante einer Karte (#1092): es wackelt zweimal, rollt höchstens sechs Pixel zur näheren Ecke und bleibt
// liegen - nie über die Ecke hinaus. Die Keyframes in easter.css folgen denselben Stützstellen, die App rechnet mit
// derselben Rechnung (Fingerabdruck auf beiden Seiten).

/** Fingerabdruck dieser Rechnung - derselbe steht in mobile/src/seasons/easter/roll.test.ts. */
const ROLL_PARITY = 277106003;

test("das Ei einer Karte: liegt auf der Seite, nahe einer Ecke, rollt zu ihr hin; je Saat fest", () => {
  const plans = Array.from({ length: 40 }, (_, n) => cardEggPlan(360, `easter:2027:/events:${n}`));
  expect(cardEggPlan(360, "easter:2027:/events:3")).toEqual(plans[3]);
  plans.forEach((plan) => {
    expect(PATTERN_NAMES).toContain(plan.pattern);
    expect(plan.size).toBeGreaterThanOrEqual(12.5);
    expect(plan.size).toBeLessThanOrEqual(15);
    expect(Math.abs(plan.lean)).toBeGreaterThanOrEqual(66);
    expect(Math.abs(plan.lean)).toBeLessThanOrEqual(80);
    // Zur näheren Ecke, nie weiter als bis knapp davor.
    expect(plan.dir).toBe(plan.x < 180 ? -1 : 1);
    expect(plan.x + plan.dir * plan.room).toBeCloseTo(plan.dir < 0 ? ROLL.margin : 360 - ROLL.margin, 0);
    // Das Gras steht auf der anderen Seite.
    expect(Math.sign(plan.tuft.x - plan.x)).toBe(-plan.dir);
    expect(plan.half).toBe(lyingHalf(plan.size, plan.lean));
  });
  expect(new Set(plans.map((plan) => plan.pattern)).size).toBeGreaterThan(6);
  expect(new Set(plans.map((plan) => plan.dir)).size).toBe(2);
});

test("je Anheben höchstens sechs Pixel, nie über die Ecke - ist kein Platz mehr, wackelt es nur", () => {
  const plan = { dir: -1, room: 14 };
  const steps = [0];
  for (let n = 0; n < 5; n += 1) steps.push(rollStep(steps[steps.length - 1], plan));
  expect(steps).toEqual([0, -6, -12, -14, -14, -14]);
  expect(rollStep(0, { dir: 1, room: 3.5 })).toBe(3.5);
  expect(rollStep(0, { dir: 1, room: 0 })).toBe(0);
});

test("der Kasten reicht für Ei, Gras und den ganzen Weg", () => {
  const plan = cardEggPlan(300, "box");
  const box = eggBox(plan);
  const end = plan.x + plan.dir * plan.room;
  expect(box.left).toBeLessThanOrEqual(Math.min(plan.x, end) - plan.size * 0.6);
  expect(box.right).toBeGreaterThanOrEqual(Math.max(plan.x, end) + plan.size * 0.6);
  expect(box.left).toBeLessThanOrEqual(plan.tuft.x - plan.tuft.width / 2);
  expect(box.right).toBeGreaterThanOrEqual(plan.tuft.x + plan.tuft.width / 2);
  expect(box.top).toBeLessThanOrEqual(-plan.half * 2);
  expect(box.bottom).toBe(0);
});

test("erst wackeln, dann rollen; am Ende genau am neuen Platz und gerade", () => {
  expect(rollPose(0, 0, -6, -1)).toEqual({ angle: 0, x: 0 });
  expect(rollPose(0.12 * ROLL.ms, 0, -6, -1)).toEqual({ angle: -ROLL.wobble, x: 0 });
  expect(rollPose(0.24 * ROLL.ms, 0, -6, -1).angle).toBeCloseTo(ROLL.wobble * 0.89, 1);
  expect(rollPose(ROLL.split * ROLL.ms, 0, -6, -1).x).toBe(0);
  expect(rollPose(0.7 * ROLL.ms, 0, -6, -1)).toEqual({ angle: -ROLL.turn, x: -3.72 });
  expect(rollPose(ROLL.ms, 0, -6, -1)).toEqual({ angle: 0, x: -6 });
  // Kein Weg mehr: es wackelt, dreht sich aber nicht nach vorn.
  expect(rollPose(0.7 * ROLL.ms, -14, -14, -1)).toEqual({ angle: 0, x: -14 });
  expect(ROLL.ms).toBeLessThan(2000);
});

test("die Keyframes in easter.css folgen denselben Stützstellen", () => {
  const css = readFileSync(path.resolve(__dirname, "easter.css"), "utf8").replace(/\r\n/g, "\n");
  const tilt = /@keyframes tls-card-egg-tilt \{([\s\S]*?)\n\}/.exec(css)[1];
  const roll = /@keyframes tls-card-egg-roll \{([\s\S]*?)\n\}/.exec(css)[1];
  ROLL.wobbleKeys.slice(1, -1).forEach(([t, v]) => expect(tilt).toContain(`${Math.round(t * 100)}% { transform: rotate(calc(var(--wobble, 9deg) * ${v})); }`));
  expect(tilt).toContain(`${Math.round(ROLL.rollKeys[1][0] * 100)}% { transform: rotate(var(--turn, 0deg)); }`);
  ROLL.rollKeys.slice(2, -1).forEach(([t, v]) => expect(tilt).toContain(`${Math.round(t * 100)}% { transform: rotate(calc(var(--turn, 0deg) * ${v})); }`));
  expect(roll).toContain(`0%, ${Math.round(ROLL.split * 100)}% { transform: translateX(var(--from, 0px)); }`);
  expect(roll).toContain(`${Math.round(ROLL.rollKeys[1][0] * 100)}% { transform: translateX(calc(var(--from, 0px) + (var(--to, 0px) - var(--from, 0px)) * ${ROLL.rollKeys[1][2]})); }`);
  expect(roll).toContain(`${Math.round(ROLL.rollKeys[2][0] * 100)}%, 100% { transform: translateX(var(--to, 0px)); }`);
  expect(css).toContain(`animation: tls-card-egg-roll ${ROLL.ms}ms`);
  expect(css).toContain(`animation: tls-card-egg-tilt ${ROLL.ms}ms`);
});

test("Parität mit der App: dieselben Zahlen, dieselben Eier", () => {
  const sample = {
    roll: ROLL,
    plans: [cardEggPlan(354, "egg:dashboard"), cardEggPlan(412, "easter:2027:Dashboard:2"), cardEggPlan(180, "easter:2027:/news:0")],
    halves: [[13, 70], [14.5, -80], [12.5, 66]].map(([size, lean]) => lyingHalf(size, lean)),
    steps: [[0, { dir: 1, room: 20 }], [6, { dir: 1, room: 8 }], [-3, { dir: -1, room: 30 }]].map(([offset, plan]) => rollStep(offset, plan)),
    poses: [0, 60, 130, 259, 400, 518, 600, 756, 900, 1000, 1080].map((ms) => rollPose(ms, 2, -4, -1)),
  };
  expect(hashString(JSON.stringify(sample))).toBe(ROLL_PARITY);
});
