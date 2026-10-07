import { readFileSync } from "node:fs";
import path from "node:path";
import { hashString } from "../rng";
import { CARD_STREAMER, STREAMER_COLORS, cardStreamerPlan, flutterAt, loopDelay } from "./cardStreamer";

// Eine Luftschlange auf der Kante einer Karte (#1093): Schlaufen auf der Kante, das Ende hängt außen über die Ecke;
// beim Anheben flattert sie einmal durch und liegt danach wie vorher. Die Keyframes in carnival.css folgen denselben
// Stützstellen, die App rechnet mit derselben Rechnung (Fingerabdruck auf beiden Seiten).

/** Fingerabdruck dieser Rechnung - derselbe steht in mobile/src/seasons/carnival/cardStreamer.test.ts. */
const STREAMER_PARITY = 1678939084;

function points(d) {
  return d.slice(2).split(" L ").map((pair) => pair.split(" ").map(Number));
}

test("auf der Kante in Schlaufen, das Ende außen neben der Ecke; je Saat fest, Ecke wählbar", () => {
  const plans = Array.from({ length: 30 }, (_, n) => cardStreamerPlan(420, `carnival:2027:/events:${n}`));
  expect(cardStreamerPlan(420, "carnival:2027:/events:4")).toEqual(plans[4]);
  plans.forEach((plan) => {
    expect(plan.loops.length).toBeGreaterThanOrEqual(CARD_STREAMER.loops[0]);
    expect(plan.loops.length).toBeLessThanOrEqual(CARD_STREAMER.loops[1]);
    expect(STREAMER_COLORS).toContainEqual(plan.colors);
    const lying = plan.loops.flatMap((loop) => points(loop.d));
    // Die Schlaufen liegen über der Kante (nie in der Karte) und im Kasten.
    lying.forEach(([x, y]) => {
      expect(y).toBeLessThanOrEqual(-0.89);
      expect(y).toBeGreaterThanOrEqual(plan.box.lying.top);
      expect(x).toBeGreaterThanOrEqual(plan.box.lying.left);
      expect(x).toBeLessThanOrEqual(plan.box.lying.right);
    });
    // Das Ende hängt außen: links der linken Ecke oder rechts der rechten.
    const hang = points(plan.hang.d).filter(([, y]) => y > 2);
    hang.forEach(([x, y]) => {
      if (plan.side === "left") expect(x).toBeLessThan(0);
      else expect(x).toBeGreaterThan(420);
      expect(y).toBeLessThanOrEqual(plan.box.hanging.bottom);
    });
    // Zuerst nach außen.
    expect(Math.sign(plan.swing)).toBe(plan.side === "left" ? 1 : -1);
  });
  expect(new Set(plans.map((plan) => plan.side)).size).toBe(2);
  expect(cardStreamerPlan(420, "x", { side: "right" }).side).toBe("right");
  const bare = cardStreamerPlan(420, "x", { hang: false });
  expect(bare.hang).toBeNull();
  expect(bare.box.hanging).toBeNull();
});

test("Flattern: eine Welle durch die Schlaufen, das Ende pendelt nur nach außen; nach 0,9 s liegt alles wie vorher", () => {
  const plan = cardStreamerPlan(420, "welle", { side: "left" });
  expect(loopDelay(0)).toBe(0);
  expect(loopDelay(2)).toBe(2 * CARD_STREAMER.wave);
  expect(flutterAt(0, plan)).toEqual({ loops: plan.loops.map(() => 1), swing: 0 });
  const early = flutterAt(0.25 * CARD_STREAMER.loopMs, plan);
  expect(early.loops[0]).toBe(1.75);
  expect(early.loops[early.loops.length - 1]).toBeLessThan(1.75);
  for (let ms = 0; ms <= CARD_STREAMER.ms; ms += 30) expect(flutterAt(ms, plan).swing).toBeGreaterThanOrEqual(0);
  expect(flutterAt(0.2 * CARD_STREAMER.ms, plan).swing).toBe(CARD_STREAMER.swing);
  expect(flutterAt(CARD_STREAMER.ms, plan)).toEqual({ loops: plan.loops.map(() => 1), swing: 0 });
  expect(loopDelay(CARD_STREAMER.loops[1] - 1) + CARD_STREAMER.loopMs).toBeLessThanOrEqual(CARD_STREAMER.ms);
  expect(CARD_STREAMER.ms).toBeLessThan(2000);
});

test("die Keyframes in carnival.css folgen denselben Stützstellen", () => {
  const css = readFileSync(path.resolve(__dirname, "carnival.css"), "utf8").replace(/\r\n/g, "\n");
  const lift = /@keyframes tls-cstreamer-lift \{([\s\S]*?)\n\}/.exec(css)[1];
  const swing = /@keyframes tls-cstreamer-swing \{([\s\S]*?)\n\}/.exec(css)[1];
  CARD_STREAMER.liftKeys.slice(1, -1).forEach(([t, v]) => expect(lift).toContain(`${Math.round(t * 100)}% { transform: scaleY(${v}); }`));
  const rest = CARD_STREAMER.swingKeys.filter(([, v]) => v === 0).map(([t]) => `${Math.round(t * 100)}%`).join(", ");
  expect(swing).toContain(`${rest} { transform: rotate(0deg); }`);
  expect(swing).toContain(`${Math.round(CARD_STREAMER.swingKeys[1][0] * 100)}% { transform: rotate(var(--swing, 16deg)); }`);
  CARD_STREAMER.swingKeys.filter(([, v]) => v > 0 && v < 1).forEach(([t, v]) => expect(swing).toContain(`${Math.round(t * 100)}% { transform: rotate(calc(var(--swing, 16deg) * ${v})); }`));
  expect(css).toContain(`animation: tls-cstreamer-lift ${CARD_STREAMER.loopMs}ms`);
  expect(css).toContain(`animation: tls-cstreamer-swing ${CARD_STREAMER.ms}ms`);
});

test("Parität mit der App: dieselben Zahlen, dieselben Luftschlangen", () => {
  const plan = cardStreamerPlan(354, "carnival:2027:Dashboard:1");
  const sample = {
    streamer: CARD_STREAMER,
    plans: [plan, cardStreamerPlan(612, "carnival:2027:/events:0", { side: "right" }), cardStreamerPlan(200, "kurz", { hang: false })],
    flutter: [0, 40, 130, 260, 333, 450, 600, 720, 900].map((ms) => flutterAt(ms, plan)),
  };
  expect(hashString(JSON.stringify(sample))).toBe(STREAMER_PARITY);
});
