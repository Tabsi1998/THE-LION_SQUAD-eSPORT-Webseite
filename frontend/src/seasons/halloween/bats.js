// Fledermausschwarm (#635, #658): reine Logik ohne DOM. Wenige Tiere als dunkle Silhouetten mit einem
// feinen hellen Rand, damit sie auf Dunkel zu erkennen sind; in loser Formation, je Seite anders.

export const FLIGHT_SECONDS = [8, 12];

export function batCount(range, rng = Math.random) {
  const [min, max] = Array.isArray(range) ? range : range === "full" ? [5, 8] : [3, 5];
  return min + Math.floor(rng() * (max - min + 1));
}

/** Sekunden bis zum nächsten Flug: 60–180, nachts etwas häufiger. */
export function nextFlightDelay(night, rng = Math.random) {
  const base = 60 + rng() * 120;
  return night ? base * 0.7 : base;
}

/** Kubische Bezier-Kurve quer über den Bildschirm im oberen Drittel, links oder rechts los. */
export function flightPath(size, rng = Math.random) {
  const fromLeft = rng() < 0.5;
  const startX = fromLeft ? -120 : size.width + 120;
  const endX = fromLeft ? size.width + 120 : -120;
  const y0 = size.height * (0.08 + rng() * 0.28);
  const y3 = size.height * (0.08 + rng() * 0.28);
  return {
    p0: { x: startX, y: y0 },
    p1: { x: startX + (endX - startX) * 0.3, y: y0 - size.height * (0.05 + rng() * 0.12) },
    p2: { x: startX + (endX - startX) * 0.7, y: y3 + size.height * (0.03 + rng() * 0.12) },
    p3: { x: endX, y: y3 },
    facing: fromLeft ? 1 : -1,
  };
}

export function pointAt(path, t) {
  const u = 1 - t;
  const x = u * u * u * path.p0.x + 3 * u * u * t * path.p1.x + 3 * u * t * t * path.p2.x + t * t * t * path.p3.x;
  const y = u * u * u * path.p0.y + 3 * u * u * t * path.p1.y + 3 * u * t * t * path.p2.y + t * t * t * path.p3.y;
  return { x, y };
}

/** Lose Staffel: jedes Tier etwas versetzt, keiner fliegt genau über dem anderen. */
export function formationOffset(index, rng) {
  const side = index % 2 ? 1 : -1;
  const rank = Math.ceil(index / 2);
  return { x: -rank * 55 - rng() * 20, y: side * (rank * 22 + rng() * 14), delay: rank * 0.12 + rng() * 0.2 };
}

export function createFlock(size, range, rng = Math.random) {
  const path = flightPath(size, rng);
  const duration = FLIGHT_SECONDS[0] + rng() * (FLIGHT_SECONDS[1] - FLIGHT_SECONDS[0]);
  const count = batCount(range, rng);
  const bats = Array.from({ length: count }, (_, index) => {
    const offset = formationOffset(index, rng);
    return { delay: offset.delay, offsetX: offset.x, offsetY: offset.y, scale: 0.85 + rng() * 0.55, flapSpeed: 7 + rng() * 4, phase: rng() * Math.PI * 2 };
  });
  return { path, duration, bats, elapsed: 0, done: false };
}

/** Schwarm um dt Sekunden weiterbewegen; liefert die sichtbaren Tiere mit Position und Flügelschlag. */
export function advanceFlock(flock, dt) {
  flock.elapsed += dt;
  const visible = [];
  let anyLeft = false;
  flock.bats.forEach((bat) => {
    const t = (flock.elapsed - bat.delay) / flock.duration;
    if (t < 0) {
      anyLeft = true;
      return;
    }
    if (t > 1) return;
    anyLeft = true;
    const point = pointAt(flock.path, t);
    visible.push({
      x: point.x + bat.offsetX * flock.path.facing,
      y: point.y + bat.offsetY + Math.sin(flock.elapsed * 2 + bat.phase) * 6,
      scale: bat.scale,
      flap: Math.sin(flock.elapsed * bat.flapSpeed + bat.phase),
      facing: flock.path.facing,
    });
  });
  flock.done = !anyLeft;
  return visible;
}

/** Eine Fledermaus als Silhouette wie in der ersten Fassung (#649): Körper und zwei Flügel mit Flügelschlag -
 * dazu nur ein Hauch heller Rand, damit sie auf Dunkel zu sehen ist. */
export function drawBat(ctx, bat) {
  const s = 10 * bat.scale;
  const wing = 0.35 + bat.flap * 0.45;
  ctx.save();
  ctx.translate(bat.x, bat.y);
  ctx.scale(bat.facing, 1);
  ctx.fillStyle = "rgba(14, 12, 20, 0.94)";
  ctx.strokeStyle = "rgba(170,225,240,0.16)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.35, s * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  [1, -1].forEach((side) => {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.2);
    ctx.quadraticCurveTo(side * s * 1.2, -s * (0.9 + wing), side * s * 2.2, -s * wing);
    ctx.quadraticCurveTo(side * s * 1.6, s * (0.2 - wing * 0.3), side * s * 1.1, s * 0.25);
    ctx.quadraticCurveTo(side * s * 0.6, s * 0.05, 0, s * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}
