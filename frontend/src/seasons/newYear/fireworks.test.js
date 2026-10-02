import { mulberry32 } from "../rng";
import { COLORS, GRAVITY, SHELLS, SHELL_TYPES, SMOKE_SECONDS, burstPoint, burstStars, crackleFlashes, distanceLight, distanceScale, launchDuration, rocketAt, smokeAt, soundDelay, starAt, starLight, trailRate, windDrift } from "./fireworks";

// Feuerwerksrechnung (N1, #739): jede Art eigen, Bahnen geschlossen gerechnet (Luftwiderstand, Schwerkraft, Wind),
// Nachglühen, Rauch, Entfernung - und das Budget hält.

const SIZE = { width: 1440, height: 900 };

function launch(overrides = {}) {
  return { id: "t", at: 0, type: "peony", x: 0.5, distance: 0.2, colors: ["blue", "gold"], burstY: 0.25, rise: 1.4, drift: 10, ...overrides };
}

test("sechs Arten, keine zwei gleich: Sterne, Tempo, Bremse, Schwere, Lebensdauer, Spur und Aufstieg unterscheiden sich", () => {
  expect(SHELL_TYPES).toEqual(["peony", "chrysanthemum", "willow", "crackle", "ring", "heart"]);
  const signatures = SHELL_TYPES.map((type) => JSON.stringify(SHELLS[type]));
  expect(new Set(signatures).size).toBe(6);
  // Die Weide hängt lange und schwebt: kleinste Schwere, größte Bremse, längstes Leben, längste Spur.
  expect(SHELLS.willow.gravity).toBe(Math.min(...SHELL_TYPES.map((type) => SHELLS[type].gravity)));
  expect(SHELLS.willow.life[1]).toBe(Math.max(...SHELL_TYPES.map((type) => SHELLS[type].life[1])));
  expect(SHELLS.willow.trail).toBe(Math.max(...SHELL_TYPES.map((type) => SHELLS[type].trail)));
  // Der Knister steigt am schnellsten und lebt am kürzesten.
  expect(SHELLS.crackle.rise[1]).toBe(Math.min(...SHELL_TYPES.map((type) => SHELLS[type].rise[1])));
});

test("Aufstieg: von unten bis zum Zerplatzpunkt, gebremst; danach keine Rakete mehr", () => {
  const rocket = launch();
  const start = rocketAt(rocket, 0, SIZE);
  expect(start.y).toBe(SIZE.height + 12);
  expect(start.x).toBe(720);
  const end = rocketAt(rocket, rocket.rise, SIZE);
  expect(end).toEqual(expect.objectContaining(burstPoint(rocket, SIZE)));
  // Gebremst: in der ersten Hälfte mehr als drei Viertel des Wegs.
  const half = rocketAt(rocket, rocket.rise / 2, SIZE);
  expect((start.y - half.y) / (start.y - end.y)).toBeCloseTo(0.75, 2);
  expect(rocketAt(rocket, rocket.rise + 0.01, SIZE)).toBeNull();
  // Wind schiebt den Zerplatzpunkt zur Seite.
  expect(burstPoint(rocket, SIZE, 14).x).toBeGreaterThan(burstPoint(rocket, SIZE, 0).x);
});

test("Explosion: Kugel rund, Ring geneigt, Herz in Herzform; Farben aus dem Paar; Budget kürzt, nie unter zwölf", () => {
  const rng = mulberry32(42);
  const ball = burstStars(launch({ type: "peony" }), rng);
  expect(ball.length).toBeGreaterThanOrEqual(56);
  expect(ball.every((star) => ["blue", "gold"].includes(star.color))).toBe(true);
  expect(ball.some((star) => star.color === "gold")).toBe(true);
  const ring = burstStars(launch({ type: "ring" }), mulberry32(7));
  const speeds = ring.map((star) => Math.hypot(star.vx, star.vy));
  // Geneigter Kreis: waagrecht volles Tempo, senkrecht gestaucht.
  expect(Math.max(...ring.map((star) => Math.abs(star.vx)))).toBeGreaterThan(Math.max(...ring.map((star) => Math.abs(star.vy))));
  expect(Math.min(...speeds)).toBeGreaterThan(0);
  const heart = burstStars(launch({ type: "heart" }), mulberry32(9));
  // Das Herz hat seine Spitze unten (größtes vy) und zwei Bögen oben.
  const lowest = heart.reduce((best, star) => (star.vy > best.vy ? star : best));
  expect(Math.abs(lowest.vx)).toBeLessThan(5);
  const crackle = burstStars(launch({ type: "crackle" }), mulberry32(3));
  expect(crackle.every((star) => star.crackleAt >= 0.55 && star.crackleAt <= 0.78)).toBe(true);
  expect(burstStars(launch(), mulberry32(1), 0)).toHaveLength(12);
  expect(burstStars(launch(), mulberry32(1), 0.5).length).toBeLessThan(burstStars(launch(), mulberry32(1), 1).length);
});

test("Bahn eines Sterns: am Anfang am Zerplatzpunkt, Bremse und Schwerkraft geschlossen, Wind treibt, ferne fallen langsamer", () => {
  const star = { vx: 100, vy: -50 };
  const shell = SHELLS.peony;
  const origin = { x: 500, y: 300 };
  expect(starAt(star, 0, shell, origin)).toEqual(origin);
  // Lange Zeit: waagrecht nur noch vx/k weit, senkrecht mit Endgeschwindigkeit g/k nach unten.
  const late = starAt(star, 10, shell, origin);
  expect(late.x).toBeCloseTo(500 + 100 / shell.drag, 0);
  const terminal = GRAVITY / shell.drag;
  const later = starAt(star, 11, shell, origin);
  expect(later.y - late.y).toBeCloseTo(terminal, 0);
  expect(starAt(star, 2, shell, origin, 14).x).toBeGreaterThan(starAt(star, 2, shell, origin, 0).x);
  expect(starAt(star, 2, shell, origin, 0, 1).y).toBeLessThan(starAt(star, 2, shell, origin, 0, 0).y);
});

test("Licht: Blitz, voll, Nachglühen zur Glut, aus; Glitzern flackert; der Knister erlischt beim Zerplatzen und blitzt", () => {
  const star = { life: 2, glitter: null, crackleAt: null };
  expect(starLight(star, 0).alpha).toBe(1);
  expect(starLight(star, 0.5).alpha).toBeCloseTo(0.95, 2);
  expect(starLight(star, 0.5).ember).toBe(0);
  const late = starLight(star, 1.8);
  expect(late.alpha).toBeLessThan(0.3);
  expect(late.ember).toBeGreaterThan(0.8);
  expect(starLight(star, 2).alpha).toBe(0);
  const glitter = { life: 2, glitter: 1.2, crackleAt: null };
  const values = [0.6, 0.62, 0.64, 0.66, 0.68].map((age) => starLight(glitter, age).alpha);
  expect(new Set(values).size).toBeGreaterThan(2);
  const crackle = { life: 1, glitter: null, crackleAt: 0.6 };
  expect(starLight(crackle, 0.59).alpha).toBeGreaterThan(0);
  expect(starLight(crackle, 0.61).alpha).toBe(0);
  const flashes = crackleFlashes(crackle, mulberry32(5));
  expect(flashes.length).toBeGreaterThanOrEqual(3);
  expect(flashes.length).toBeLessThanOrEqual(5);
});

test("Rauch wächst, steigt kaum, treibt mit dem Wind und vergeht; Entfernung macht kleiner, dunkler und den Knall später", () => {
  const origin = { x: 400, y: 200 };
  const early = smokeAt(origin, 0.5, 10);
  const later = smokeAt(origin, 6, 10);
  expect(later.r).toBeGreaterThan(early.r);
  expect(later.alpha).toBeLessThan(early.alpha);
  expect(later.x).toBeGreaterThan(early.x);
  expect(smokeAt(origin, SMOKE_SECONDS + 0.1)).toBeNull();
  expect([distanceScale(0), distanceScale(1)]).toEqual([1, 0.55]);
  expect([distanceLight(0), distanceLight(1)]).toEqual([1, 0.6]);
  expect(soundDelay(0)).toBeLessThan(soundDelay(1));
  expect(trailRate(launch({ distance: 0 }))).toBeGreaterThan(trailRate(launch({ distance: 1 })));
  expect(launchDuration(launch({ type: "willow", rise: 1.6 }))).toBeCloseTo(1.6 + SHELLS.willow.life[1] + 0.2, 2);
});

test("Wind aus dem Wetter: Westwind treibt nach rechts, Ostwind nach links, ohne Wetter ein leichter Zug", () => {
  expect(windDrift({ wind_factor: 1, wind_dir: 270 })).toBeGreaterThan(0);
  expect(windDrift({ wind_factor: 1, wind_dir: 90 })).toBeLessThan(0);
  expect(windDrift(null)).toBeCloseTo(8.4, 1);
  expect(Object.keys(COLORS)).toEqual(expect.arrayContaining(["blue", "gold", "silver", "white"]));
});
