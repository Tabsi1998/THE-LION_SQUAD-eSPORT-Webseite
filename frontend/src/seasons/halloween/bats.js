// Fledermausschwarm (#635, #658, Runde IV): reine Logik ohne DOM. Wenige Tiere als dunkle Silhouetten mit
// einem feinen hellen Rand. Die Bahnen liegen in Seitenkoordinaten - quer durchs Fenster, als Sturzflug unter
// die Unterkante (man kann nachscrollen) oder von unten aufsteigend über den oberen Rand hinaus; die Ebene
// zeichnet sie um den Scrollstand versetzt, so bleiben sie an der Seite hängen statt am Fenster.

export const FLIGHT_SECONDS = [8, 12];
export const MODES = ["across", "across", "dive", "rise"];

export function batCount(range, rng = Math.random) {
  const [min, max] = Array.isArray(range) ? range : range === "full" ? [5, 8] : [3, 5];
  return min + Math.floor(rng() * (max - min + 1));
}

/** Sekunden bis zum nächsten Flug: 60–180, nachts etwas häufiger. */
export function nextFlightDelay(night, rng = Math.random) {
  const base = 60 + rng() * 120;
  return night ? base * 0.7 : base;
}

/**
 * Kubische Bezier-Kurve in Seitenkoordinaten. `view` sagt, wo das Fenster gerade ist (scrollY) und wie lang die
 * Seite ist; `mode` erzwingt eine Bahnform, sonst würfelt der Zufall (quer doppelt so oft wie Sturz oder Aufstieg).
 */
export function flightPath(size, rng = Math.random, view = null, mode = null) {
  const top = view?.scrollY || 0;
  const pageHeight = Math.max(view?.pageHeight || 0, top + size.height);
  const shape = mode || MODES[Math.floor(rng() * MODES.length)];
  const fromLeft = rng() < 0.5;
  if (shape === "dive") {
    const x0 = fromLeft ? -80 : size.width + 80;
    const x3 = size.width * (0.2 + rng() * 0.6);
    const y0 = top + size.height * (0.05 + rng() * 0.2);
    const y3 = Math.min(pageHeight - 40, top + size.height + 400 + rng() * 900);
    return {
      p0: { x: x0, y: y0 },
      p1: { x: x0 + (x3 - x0) * 0.4, y: y0 - 60 },
      p2: { x: x3 + (fromLeft ? 140 : -140), y: y0 + (y3 - y0) * 0.6 },
      p3: { x: x3, y: y3 },
      facing: fromLeft ? 1 : -1,
      mode: shape,
    };
  }
  if (shape === "rise") {
    const x0 = size.width * (0.2 + rng() * 0.6);
    const x3 = fromLeft ? size.width + 80 : -80;
    const y0 = Math.min(pageHeight - 40, top + size.height + 200 + rng() * 400);
    const y3 = Math.max(-80, top - 300 - rng() * 300);
    return {
      p0: { x: x0, y: y0 },
      p1: { x: x0 + (fromLeft ? -120 : 120), y: y0 - (y0 - y3) * 0.4 },
      p2: { x: x3 - (fromLeft ? 160 : -160), y: y3 + 80 },
      p3: { x: x3, y: y3 },
      facing: fromLeft ? 1 : -1,
      mode: shape,
    };
  }
  const startX = fromLeft ? -120 : size.width + 120;
  const endX = fromLeft ? size.width + 120 : -120;
  const y0 = top + size.height * (0.08 + rng() * 0.28);
  const y3 = top + size.height * (0.08 + rng() * 0.28);
  return {
    p0: { x: startX, y: y0 },
    p1: { x: startX + (endX - startX) * 0.3, y: y0 - size.height * (0.05 + rng() * 0.12) },
    p2: { x: startX + (endX - startX) * 0.7, y: y3 + size.height * (0.03 + rng() * 0.12) },
    p3: { x: endX, y: y3 },
    facing: fromLeft ? 1 : -1,
    mode: "across",
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

export function createFlock(size, range, rng = Math.random, view = null, mode = null) {
  const path = flightPath(size, rng, view, mode);
  const duration = FLIGHT_SECONDS[0] + rng() * (FLIGHT_SECONDS[1] - FLIGHT_SECONDS[0]);
  const count = batCount(range, rng);
  const bats = Array.from({ length: count }, (_, index) => {
    const offset = formationOffset(index, rng);
    return { delay: offset.delay, offsetX: offset.x, offsetY: offset.y, scale: 0.85 + rng() * 0.55, flapSpeed: 7 + rng() * 4, phase: rng() * Math.PI * 2 };
  });
  return { path, duration, bats, elapsed: 0, done: false };
}

/** Schwarm um dt Sekunden weiterbewegen; liefert die sichtbaren Tiere mit Position (Seitenkoordinaten) und Flügelschlag. */
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
