import { ALERT_SECONDS, LANDING_SECONDS, SETTLE_SECONDS, TAKEOFF_SECONDS, TEMPERAMENTS, activeFlights, advanceBat, alert, approachPath, createBat, fleePath, flightPoint, hopPath, pointOn, reactToPointer, reactToScroll, startle } from "./batLife";

// Lebenslogik (H8) und Reaktionen (H9): Zustandsfolge deterministisch, Flüge als Bögen mit Welle und Drehung,
// Nähe macht aufmerksam und vertreibt nur selten, Scrollen schreckt mit Abklingzeit auf, nach dem Weg kommt ein
// neuer Platz.

function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

const perch = (key, x, y, pose = "hang") => ({ key, kind: "card", x, y, px: x, py: y, size: 24, pose, fixed: false });

test("eine Fledermaus hat ein Temperament und döst auf ihrem Platz", () => {
  const bat = createBat(1, perch("a", 100, 200), rngOf([0.3, 0.5, 0.9, 0.2]));
  expect(bat.state).toBe("perched");
  expect(Object.keys(TEMPERAMENTS)).toContain(bat.temperament);
  expect(bat.timer).toBeGreaterThan(0);
  const later = advanceBat(bat, 1, { rng: rngOf([0.5]) });
  expect(later.timer).toBeCloseTo(bat.timer - 1, 5);
  expect(later.state).toBe("perched");
});

test("Flucht: aufschrecken, Start, Flug aus dem Bild, weg, später Anflug auf einen neuen Platz mit Landung", () => {
  const rng = rngOf([0.7, 0.5, 0.2, 0.5, 0.5, 0.3, 0.4]);
  const view = { top: 0, bottom: 800, width: 1200 };
  const bat = createBat(1, perch("a", 300, 400), rngOf([0.3, 0.5]));
  const flying = startle(bat, rng, view, 1000);
  expect(flying.state).toBe("takeoff");
  expect(flying.path.p0).toEqual({ x: 300, y: 400 });
  expect(flying.lastFleeAt).toBe(1000);
  let state = advanceBat(flying, TAKEOFF_SECONDS, { rng, view });
  expect(state.state).toBe("flying");
  const steps = [];
  for (let i = 0; i < 40; i += 1) {
    state = advanceBat(state, 0.1, { rng, view });
    steps.push(state);
  }
  expect(steps.some((s) => s.rotation !== 0)).toBe(true);
  expect(state.state).toBe("gone");
  expect(state.timer).toBeGreaterThan(0);
  // Weg: erst nach der Pause und nur mit freiem Platz - dann Anflug von außerhalb, Landung, Setzen, Ruhe.
  const target = perch("b", 600, 500, "sit");
  let comeback = advanceBat({ ...state, timer: 0.1 }, 0.2, { rng, view, findPerch: () => null });
  expect(comeback.state).toBe("gone");
  comeback = advanceBat({ ...comeback, timer: 0.1 }, 0.2, { rng, view, findPerch: () => target, canFly: () => true });
  expect(comeback.state).toBe("approaching");
  expect(Math.abs(comeback.x) > 100 || comeback.x < 0).toBe(true);
  for (let i = 0; i < 60 && comeback.state === "approaching"; i += 1) comeback = advanceBat(comeback, 0.1, { rng, view });
  expect(comeback.state).toBe("landing");
  expect(comeback.x).toBe(600);
  expect(comeback.pose).toBe("sit");
  comeback = advanceBat(comeback, LANDING_SECONDS, { rng, view });
  expect(comeback.state).toBe("settle");
  expect(comeback.pose).toBe("sit");
  expect(comeback.perch.key).toBe("b");
  comeback = advanceBat(comeback, SETTLE_SECONDS, { rng, view });
  expect(comeback.state).toBe("perched");
  expect(activeFlights([comeback, flying])).toBe(1);
  // Zu viele Flüge oder kein Budget: die Wegbleibende wartet.
  expect(advanceBat({ ...state, timer: 0 }, 0.1, { rng, view, canFly: () => false }).timer).toBe(5);
  expect(startle(comeback, rng, view, 2).state).toBe("takeoff");
  expect(startle({ ...comeback, state: "flying" }, rng, view).state).toBe("flying");
});

test("Umziehen: eine unruhige Fledermaus fliegt nach der Ruhephase zu einem neuen Platz", () => {
  const rng = rngOf([0.5]);
  const bat = { ...createBat(2, perch("a", 100, 100), rngOf([0.6, 0.5])), restless: true, timer: 0.05 };
  const target = perch("c", 500, 300);
  const moving = advanceBat(bat, 0.1, { rng, findPerch: () => target, canFly: () => true });
  expect(moving.state).toBe("takeoff");
  expect(moving.target.key).toBe("c");
  expect(moving.path.p3).toEqual({ x: 500, y: 300 });
  const lazy = advanceBat({ ...bat, restless: false }, 0.1, { rng, findPerch: () => target });
  expect(lazy.state).toBe("perched");
  expect(lazy.timer).toBeGreaterThan(1);
  const waiting = advanceBat(bat, 0.1, { rng, findPerch: () => null, canFly: () => true });
  expect(waiting.state).toBe("perched");
});

test("Bahnen: Flucht geht erst hoch und endet außerhalb, Anflug kommt vom Rand, Hüpfer bogenförmig; Punkte mit Welle und Drehung", () => {
  const view = { top: 500, bottom: 1300, width: 1200 };
  const down = fleePath({ x: 300, y: 560 }, rngOf([0.7, 0.5, 0.2, 0.5, 0.5]), view);
  expect(down.p1.y).toBeLessThan(560);
  expect(down.p3.y).toBeGreaterThan(1300);
  expect(down.facing).toBe(1);
  const up = fleePath({ x: 300, y: 560 }, rngOf([0.2, 0.5, 0.9, 0.5, 0.5]), view);
  expect(up.p3.y).toBeLessThan(500);
  const approach = approachPath({ x: 600, y: 700 }, rngOf([0.2, 0.5, 0.5, 0.5, 0.5]), view);
  expect(approach.p0.x).toBe(-120);
  expect(approach.p3).toEqual({ x: 600, y: 700 });
  expect(approach.facing).toBe(1);
  const hop = hopPath({ x: 100, y: 100 }, { x: 500, y: 300 }, rngOf([0.5]));
  expect(hop.p1.y).toBeLessThan(100);
  expect(hop.seconds).toBeGreaterThanOrEqual(1.8);
  const start = flightPoint(hop, 0);
  const end = flightPoint(hop, 1);
  expect(start.x).toBeCloseTo(100, 1);
  expect(end.x).toBeCloseTo(500, 1);
  expect(end.y).toBeCloseTo(300, 1);
  expect(Math.abs(flightPoint(hop, 0.5).rotation)).toBeLessThanOrEqual(35);
  // Drehung folgt der Nase: nach rechts unten positiv, nach links unten (gespiegelte Figur) negativ.
  const rightDown = { p0: { x: 0, y: 0 }, p1: { x: 30, y: 30 }, p2: { x: 60, y: 60 }, p3: { x: 100, y: 100 }, facing: 1 };
  const leftDown = { p0: { x: 100, y: 0 }, p1: { x: 70, y: 30 }, p2: { x: 40, y: 60 }, p3: { x: 0, y: 100 }, facing: -1 };
  const leftUp = { p0: { x: 100, y: 100 }, p1: { x: 70, y: 70 }, p2: { x: 40, y: 40 }, p3: { x: 0, y: 0 }, facing: -1 };
  expect(flightPoint(rightDown, 0.5).rotation).toBeCloseTo(35, 5);
  expect(flightPoint(leftDown, 0.5).rotation).toBeCloseTo(-35, 5);
  expect(flightPoint(leftUp, 0.5).rotation).toBeCloseTo(35, 5);
  // Alte Sprache: pointOn ohne Welle.
  expect(pointOn(hop, 0)).toEqual({ x: 100, y: 100 });
});

test("Nähe macht aufmerksam, vertreibt nur nah, selten und mit Abklingzeit; schnelles Scrollen schreckt selten auf", () => {
  const bat = { ...createBat(3, perch("a", 100, 100), rngOf([0.25, 0.5])), temperament: "skittish", lastFleeAt: -Infinity };
  expect(reactToPointer(bat, { x: 400, y: 100 }, rngOf([0]), 1000)).toBe("none");
  expect(reactToPointer(bat, { x: 220, y: 100 }, rngOf([0]), 1000)).toBe("alert");
  expect(reactToPointer(alert(bat), { x: 220, y: 100 }, rngOf([0]), 1000)).toBe("none");
  // Ein ruhender Zeiger macht nicht alle 1,6 s wieder aufmerksam: erst nach der Pause je Fledermaus.
  expect(reactToPointer({ ...bat, alertedAt: 1000 - 5000 }, { x: 220, y: 100 }, rngOf([0]), 1000)).toBe("none");
  expect(reactToPointer({ ...bat, alertedAt: 1000 - 20000 }, { x: 220, y: 100 }, rngOf([0]), 1000)).toBe("alert");
  expect(alert(bat, undefined, 7).alertedAt).toBe(7);
  expect(reactToPointer(bat, { x: 130, y: 112 }, rngOf([0.99]), 1000)).toBe("alert");
  expect(reactToPointer(bat, { x: 130, y: 112 }, rngOf([0.1]), 1000)).toBe("flee");
  expect(reactToPointer(bat, { x: 130, y: 112 }, rngOf([0.1]), 1000, 1000 - 1000)).toBe("alert");
  expect(reactToPointer({ ...bat, lastFleeAt: 900 }, { x: 130, y: 112 }, rngOf([0.1]), 1000)).toBe("alert");
  expect(reactToPointer({ ...bat, state: "flying" }, { x: 100, y: 100 }, rngOf([0]), 1)).toBe("none");
  const alerted = alert(bat);
  expect(alerted.state).toBe("alert");
  expect(advanceBat(alerted, ALERT_SECONDS, { rng: rngOf([0.5]) }).state).toBe("perched");
  expect(reactToScroll(500, rngOf([0]), 1000)).toBe(false);
  expect(reactToScroll(3000, rngOf([0.9]), 1000)).toBe(false);
  expect(reactToScroll(3000, rngOf([0.1]), 1000)).toBe(true);
  expect(reactToScroll(3000, rngOf([0.1]), 1000, 1000 - 10000)).toBe(false);
});
