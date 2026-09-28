// Fledermausschwarm (#635, #655): reine Logik ohne DOM. Groß genug, dass man ihn sieht, mit hellem Rand
// und Augen; Schwärme fliegen in V-Formation oder als loser Haufen, je Seite anders (Saat aus der Adresse).

export const FLIGHT_SECONDS = [7, 11];

export function batCount(intensity, rng = Math.random) {
  const [min, max] = intensity === "full" ? [9, 14] : [5, 8];
  return min + Math.floor(rng() * (max - min + 1));
}

/** Sekunden bis zum nächsten Flug: 45–150, nachts häufiger. */
export function nextFlightDelay(night, rng = Math.random) {
  const base = 45 + rng() * 105;
  return night ? base * 0.6 : base;
}

/** Kubische Bezier-Kurve quer über den Bildschirm, links oder rechts los, Auf und Ab, nie über die Mitte hinaus tief. */
export function flightPath(size, rng = Math.random) {
  const fromLeft = rng() < 0.5;
  const startX = fromLeft ? -140 : size.width + 140;
  const endX = fromLeft ? size.width + 140 : -140;
  const y0 = size.height * (0.08 + rng() * 0.32);
  const y3 = size.height * (0.08 + rng() * 0.32);
  return {
    p0: { x: startX, y: y0 },
    p1: { x: startX + (endX - startX) * 0.3, y: y0 - size.height * (0.06 + rng() * 0.16) },
    p2: { x: startX + (endX - startX) * 0.7, y: y3 + size.height * (0.04 + rng() * 0.16) },
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

/** Formation: V wie Zugvögel oder loser Haufen. */
export function formationOffset(index, count, formation, rng) {
  if (formation === "v") {
    const side = index % 2 ? 1 : -1;
    const rank = Math.ceil(index / 2);
    return { x: -rank * 42, y: side * rank * 26 + (rng() - 0.5) * 8, delay: rank * 0.08 };
  }
  return { x: (rng() - 0.5) * 220, y: (rng() - 0.5) * 140, delay: rng() * 0.9 };
}

export function createFlock(size, intensity, rng = Math.random) {
  const path = flightPath(size, rng);
  const duration = FLIGHT_SECONDS[0] + rng() * (FLIGHT_SECONDS[1] - FLIGHT_SECONDS[0]);
  const count = batCount(intensity, rng);
  const formation = rng() < 0.55 ? "v" : "loose";
  const bats = Array.from({ length: count }, (_, index) => {
    const offset = formationOffset(index, count, formation, rng);
    return {
      delay: offset.delay,
      offsetX: offset.x,
      offsetY: offset.y,
      scale: 1.7 + rng() * 1.4,
      flapSpeed: 8 + rng() * 5,
      phase: rng() * Math.PI * 2,
    };
  });
  return { path, duration, bats, formation, elapsed: 0, done: false };
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
      y: point.y + bat.offsetY + Math.sin(flock.elapsed * 2 + bat.phase) * 8,
      scale: bat.scale,
      flap: Math.sin(flock.elapsed * bat.flapSpeed + bat.phase),
      facing: flock.path.facing,
    });
  });
  flock.done = !anyLeft;
  return visible;
}

/** Eine Fledermaus: Körper, Ohren, zwei Flügel mit Flügelschlag, heller Rand und orange Augen. */
export function drawBat(ctx, bat) {
  const s = 10 * bat.scale;
  const wing = 0.35 + bat.flap * 0.45;
  ctx.save();
  ctx.translate(bat.x, bat.y);
  ctx.scale(bat.facing, 1);
  ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.fillStyle = "rgba(23,18,29,0.96)";
  [1, -1].forEach((side) => {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.2);
    ctx.quadraticCurveTo(side * s * 1.2, -s * (0.9 + wing), side * s * 2.3, -s * wing);
    ctx.quadraticCurveTo(side * s * 1.7, s * (0.25 - wing * 0.3), side * s * 1.15, s * 0.3);
    ctx.quadraticCurveTo(side * s * 0.6, s * 0.05, 0, s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.36, s * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.3, -s * 0.5);
  ctx.lineTo(-s * 0.45, -s * 0.95);
  ctx.lineTo(-s * 0.08, -s * 0.6);
  ctx.moveTo(s * 0.3, -s * 0.5);
  ctx.lineTo(s * 0.45, -s * 0.95);
  ctx.lineTo(s * 0.08, -s * 0.6);
  ctx.fill();
  ctx.fillStyle = "#ff9a3c";
  ctx.beginPath();
  ctx.arc(-s * 0.14, -s * 0.28, s * 0.09, 0, Math.PI * 2);
  ctx.arc(s * 0.14, -s * 0.28, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
