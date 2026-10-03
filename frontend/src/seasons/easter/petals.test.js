import { MAX_PETALS, createPetal, createPetalLayer, petalAt, petalCount, stepPetal } from "./petals";

// Blütenblätter (#753): wenige - aus dem Budget, höchstens vierzehn -, langsam sinkend und pendelnd, unten raus und
// oben neu; sie gehören zur Seite und ziehen beim Scrollen mit.

const SIZE = { width: 1200, height: 800 };

function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("wenige: aus dem Budget und dem Anteil der Seite, höchstens vierzehn", () => {
  expect(petalCount(0)).toBe(0);
  expect(petalCount(40, 0.5)).toBe(2);
  expect(petalCount(120)).toBe(12);
  expect(petalCount(240)).toBe(MAX_PETALS);
  expect(petalCount(120, 0)).toBe(0);
});

test("ein Blatt sinkt langsam und pendelt; unten raus kommt es oben neu", () => {
  const rng = seq([0.5]);
  const petal = createPetal(rng, SIZE);
  expect(petal.y).toBeLessThan(0);
  expect(petal.fall).toBeGreaterThan(10);
  expect(petal.fall).toBeLessThan(24);
  const later = stepPetal(petal, 1, SIZE, rng);
  expect(later.y).toBeCloseTo(petal.y + petal.fall);
  const swing = [0, 0.4, 0.8, 1.2].map((t) => petalAt({ ...petal, t }).x);
  expect(Math.max(...swing) - Math.min(...swing)).toBeGreaterThan(5);
  const gone = stepPetal({ ...petal, y: SIZE.height + 30 }, 0.1, SIZE, rng);
  expect(gone.y).toBeLessThan(0);
});

test("die Ebene: Blätter gleich im Fenster verteilt, beim Scrollen ziehen sie mit", () => {
  const win = { scrollY: 0 };
  const layer = createPetalLayer({ count: 5, seed: 3, win });
  layer.draw(null, 0, SIZE);
  const first = layer.petals();
  expect(first).toHaveLength(5);
  first.forEach((petal) => {
    expect(petal.y).toBeGreaterThanOrEqual(0);
    expect(petal.y).toBeLessThanOrEqual(SIZE.height);
  });
  win.scrollY = 100;
  layer.draw(null, 0, SIZE);
  layer.petals().forEach((petal, index) => expect(petal.y).toBeCloseTo(first[index].y - 100));
});
