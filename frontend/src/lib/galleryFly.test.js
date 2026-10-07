import { flyTransform, inViewport } from "./galleryFly";

const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

// Galerie (#1079): die Bühne (Drehpunkt in ihrer Mitte) wird so verschoben und verkleinert, dass das Bild darin genau
// auf der Kachel liegt.
test("flyTransform: Bild in der Bühnenmitte landet auf der Kachel", () => {
  const stage = box(100, 100, 800, 600);
  expect(flyTransform(stage, box(0, 0, 200, 150))).toEqual({ dx: -400, dy: -325, scale: 0.25 });
  // Seitenverhältnis anders: es zählt die engere Seite, das Bild passt ganz in die Kachel.
  expect(flyTransform(stage, box(0, 0, 400, 150)).scale).toBe(0.25);
});

test("flyTransform: ein Bild oberhalb der Mitte (Knopf darunter) landet trotzdem genau auf der Kachel", () => {
  const stage = box(0, 0, 1000, 800);
  const media = box(300, 100, 400, 300);
  const tile = box(40, 600, 200, 150);
  const fly = flyTransform(stage, tile, media);
  // Nachrechnen: Mitte des Bildes nach Verschiebung und Maßstab um die Bühnenmitte (500, 400).
  const landX = 500 + fly.scale * (500 - 500) + fly.dx;
  const landY = 400 + fly.scale * (250 - 400) + fly.dy;
  expect(fly.scale).toBe(0.5);
  expect(landX).toBe(140);
  expect(landY).toBe(675);
});

test("flyTransform: ohne Maße kein Flug, ungeladenes Bild zählt als ganze Bühne", () => {
  expect(flyTransform(box(0, 0, 0, 0), box(0, 0, 10, 10))).toBeNull();
  expect(flyTransform(box(0, 0, 100, 100), box(0, 0, 0, 0))).toBeNull();
  expect(flyTransform(box(0, 0, 100, 100), box(0, 0, 50, 50), box(0, 0, 0, 0))).toEqual({ dx: -25, dy: -25, scale: 0.5 });
});

test("inViewport: teilweise sichtbar zählt, ganz außerhalb nicht", () => {
  expect(inViewport(box(10, 10, 100, 100), 1024, 768)).toBe(true);
  expect(inViewport(box(10, 700, 100, 100), 1024, 768)).toBe(true);
  expect(inViewport(box(10, 900, 100, 100), 1024, 768)).toBe(false);
  expect(inViewport(box(10, -200, 100, 100), 1024, 768)).toBe(false);
  expect(inViewport(box(10, 10, 0, 0), 1024, 768)).toBe(false);
});
