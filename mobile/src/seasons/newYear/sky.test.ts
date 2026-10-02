import { launchDuration, SMOKE_SECONDS, type Launch } from "./fireworks";
import { APP_CAPS, LATE_MS, LOOKAHEAD_MS, capFor, countParticles, drawFire, emptyFire, fireIdle, nextLaunchAt, stepFire, type DrawKit } from "./sky";

// Feuerwerks-Ebene der App (S11, N1, N5): startet zur Serverzeit, holt nach dem Hintergrund nichts nach, hält das
// Budget (200/400), räumt Fertiges weg, schiebt alles mit dem Scrollen und darf schlafen, wenn nichts ansteht.

const SIZE = { width: 400, height: 800 };

function rocket(id: string, at: number, overrides: Partial<Launch> = {}): Launch {
  return { id, at, type: "peony", x: 0.5, distance: 0.3, colors: ["blue", "gold"], burstY: 0.3, rise: 1.2, drift: 0, ...overrides };
}

test("Budget wie in #642: „normal“ 200, „kräftig“ 400, „dezent“ nichts", () => {
  expect([capFor("normal"), capFor("full"), capFor("subtle"), capFor("off")]).toEqual([APP_CAPS.normal, APP_CAPS.full, 0, 0]);
});

test("startet zur Serverzeit, zerplatzt nach dem Aufstieg, räumt danach auf - zu spät gekommene bleiben aus", () => {
  const plan = [rocket("old", 0), rocket("a", 5_000)];
  let state = stepFire(emptyFire(), plan, 4_900, SIZE, 0, 200);
  expect(state.live).toHaveLength(0);
  expect(state.started.old).toBe(1);
  state = stepFire(state, plan, 5_020, SIZE, 0, 200);
  expect(state.live.map((item) => item.launch.id)).toEqual(["a"]);
  state = stepFire(state, plan, 5_000 + 1_200 + 20, SIZE, 0, 200);
  expect(state.live[0].stars?.length).toBeGreaterThan(12);
  expect(state.smoke).toHaveLength(1);
  state = stepFire(state, plan, 5_000 + launchDuration(plan[1]) * 1000 + 50, SIZE, 0, 200);
  expect(state.live).toHaveLength(0);
  state = stepFire(state, plan, 5_000 + 1_200 + SMOKE_SECONDS * 1000 + 50, SIZE, 0, 200);
  expect(state.smoke).toHaveLength(0);
});

test("Budget: viele Raketen auf einmal bekommen weniger Sterne - nie viel mehr als erlaubt", () => {
  const plan = Array.from({ length: 20 }, (_, i) => rocket(`r${i}`, 1_000));
  let state = stepFire(emptyFire(), plan, 1_000, SIZE, 0, 200);
  state = stepFire(state, plan, 2_250, SIZE, 0, 200);
  expect(countParticles(state)).toBeLessThanOrEqual(200 + 20 * 12);
});

test("Scrollen schiebt Raketen, Funken und Rauch mit - was neu entsteht, hat den Stand schon", () => {
  const plan = [rocket("s", 1_000)];
  let state = stepFire(emptyFire(), plan, 1_400, SIZE, 0, 200);
  const sparksBefore = state.live[0].sparks.map((spark) => spark.y);
  state = stepFire(state, plan, 1_400, SIZE, 0, 200, 50);
  expect(state.live[0].shift).toBe(-50);
  state.live[0].sparks.slice(0, sparksBefore.length).forEach((spark, i) => expect(spark.y).toBeCloseTo(sparksBefore[i] - 50, 5));
  state = stepFire(state, plan, 2_300, SIZE, 0, 200, 30);
  expect(state.smoke[0].shift).toBe(-80);
});

test("schläft, wenn nichts in der Luft ist und in den nächsten Sekunden nichts startet; nächste Startzeit für das Wecken", () => {
  const plan = [rocket("later", 60_000)];
  expect(fireIdle(emptyFire(), plan, 0)).toBe(true);
  expect(fireIdle(emptyFire(), plan, 60_000 - LOOKAHEAD_MS + 100)).toBe(false);
  expect(nextLaunchAt(plan, 0)).toBe(60_000);
  expect(nextLaunchAt(plan, 70_000)).toBeNull();
  expect(LATE_MS).toBe(1500);
});

test("Zeichnen: Rauch, Funken, Rakete, Sterne - je Leuchtpunkt Schein und Kern", () => {
  const plan = [rocket("d", 1_000, { type: "chrysanthemum" })];
  let state = stepFire(emptyFire(), plan, 1_500, SIZE, 0, 200);
  const circles: number[] = [];
  const canvas = { drawCircle: (_x: number, y: number) => circles.push(y) } as never;
  const paint = { setColor() {}, setAlphaf() {} };
  const kit = { paint, smokePaint: paint, colors: { blue: 1, gold: 2, white: 3 }, ember: 4, smoke: 5 } as unknown as DrawKit;
  drawFire(canvas, state, 1_500, SIZE, 0, kit);
  expect(circles.length).toBeGreaterThan(2);
  circles.length = 0;
  state = stepFire(state, plan, 2_600, SIZE, 0, 200);
  drawFire(canvas, state, 2_600, SIZE, 0, kit);
  expect(circles.length).toBeGreaterThan(40);
});
