// Geister als Schwaden (#662): selten treibt einer im Türkis der Seite durchs Bild - weich, ohne Gesicht,
// nachts etwas öfter. Reine Logik für den gemeinsamen Canvas-Loop.

/** Sekunden bis zur nächsten Schwade: 120–300, nachts kürzer. */
export function nextWispDelay(night, rng = Math.random) {
  const base = 120 + rng() * 180;
  return night ? base * 0.7 : base;
}

export function createWisp(size, rng = Math.random) {
  const fromLeft = rng() < 0.5;
  const speed = 16 + rng() * 14;
  return {
    x: fromLeft ? -70 : size.width + 70,
    y: size.height * (0.15 + rng() * 0.45),
    vx: fromLeft ? speed : -speed,
    vy: (rng() - 0.5) * 4,
    phase: rng() * Math.PI * 2,
    radius: 18 + rng() * 10,
    age: 0,
    done: false,
  };
}

export function advanceWisp(wisp, dt, size) {
  wisp.age += dt;
  wisp.x += wisp.vx * dt;
  wisp.y += wisp.vy * dt + Math.sin(wisp.age * 0.9 + wisp.phase) * 8 * dt;
  if (wisp.x < -120 || wisp.x > size.width + 120) wisp.done = true;
  return wisp;
}

/** Eine Schwade: weicher Kern, drei nachziehende Schleier, alles sehr durchscheinend. */
export function drawWisp(ctx, wisp) {
  const alpha = Math.min(1, wisp.age / 3) * 0.22;
  const dir = wisp.vx < 0 ? 1 : -1;
  ctx.save();
  for (let n = 0; n < 4; n += 1) {
    const r = wisp.radius * (1 - n * 0.18);
    const x = wisp.x + dir * n * r * 0.9;
    const y = wisp.y + Math.sin(wisp.age * 1.4 + n * 0.8 + wisp.phase) * 5;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(190, 235, 245, ${(alpha * (1 - n * 0.2)).toFixed(3)})`);
    gradient.addColorStop(1, "rgba(190, 235, 245, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
