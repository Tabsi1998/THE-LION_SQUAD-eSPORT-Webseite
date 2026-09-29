// Erfolge II (E8, #618): die Partikel-Ebene als Canvas - höchstens 160 Teilchen (60 am Handy), Pause bei
// verstecktem Tab, nur Zeichnen im Canvas (keine Layout-Verschiebung). Je Material eine Art: Blätter,
// Funken, Glut, Glanz, Konfetti, Kristalle, Prisma, Flammen, Irrlichter.

export const MAX_PARTICLES = 160;
export const MAX_PARTICLES_MOBILE = 60;

export function particleCap(width, budget = MAX_PARTICLES) {
  const cap = width < 640 ? MAX_PARTICLES_MOBILE : MAX_PARTICLES;
  return Math.max(0, Math.min(cap, Math.floor(budget)));
}

function rnd(rng, min, max) { return min + rng() * (max - min); }

const PALETTES = {
  leaf: ["#C08A55", "#A0703C", "#7A5330", "#E3B27A"],
  spark: ["#F1F3F5", "#B4BAC0", "#FFFFFF", "#9AA0A6"],
  ember: ["#E3A25C", "#CD7F32", "#FF8A3D", "#FFD1A0"],
  glint: ["#FFFFFF", "#E8EAEC", "#C0C0C0", "#F7F7F7"],
  confetti: ["#FFD700", "#FFE066", "#FFFFFF", "#29B6E8", "#00FF88"],
  crystal: ["#8FE2FF", "#29B6E8", "#E6F9FF", "#FFFFFF"],
  prism: ["#B9F2FF", "#FF7AD9", "#FFE066", "#7AFFB2", "#7AB8FF", "#FFFFFF"],
  flame: ["#FF3B30", "#FF7A6E", "#FFD700", "#FF8A3D"],
  wisp: ["#C79BFF", "#A855F7", "#F3E8FF", "#7C3AED"],
};

export function spawnParticles({ kind = "confetti", count = 40, width = 800, height = 600, rng = Math.random, origin = null }) {
  const colors = PALETTES[kind] || PALETTES.confetti;
  const cx = origin?.x ?? width / 2;
  const cy = origin?.y ?? height / 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const speed = kind === "flame" || kind === "wisp" ? rnd(rng, 20, 90) : rnd(rng, 90, 320);
    out.push({
      x: kind === "confetti" || kind === "leaf" ? rng() * width : cx + Math.cos(angle) * rnd(rng, 0, 30),
      y: kind === "confetti" || kind === "leaf" ? -rnd(rng, 10, height * 0.5) : cy + Math.sin(angle) * rnd(rng, 0, 30),
      vx: kind === "confetti" || kind === "leaf" ? rnd(rng, -30, 30) : Math.cos(angle) * speed,
      vy: kind === "confetti" || kind === "leaf" ? rnd(rng, 60, 160) : Math.sin(angle) * speed - (kind === "flame" || kind === "wisp" ? 60 : 0),
      size: kind === "confetti" ? rnd(rng, 5, 10) : rnd(rng, 2, 6),
      rot: rng() * Math.PI,
      vr: rnd(rng, -4, 4),
      life: 0,
      ttl: rnd(rng, 1.4, kind === "wisp" ? 4 : 3),
      color: colors[Math.floor(rng() * colors.length)],
      kind,
    });
  }
  return out;
}

export function stepParticles(particles, dt, { width = 800, height = 600, gravity = 220, drag = 0.985 } = {}) {
  const alive = [];
  for (const p of particles) {
    p.life += dt;
    if (p.life >= p.ttl) continue;
    const upward = p.kind === "flame" || p.kind === "wisp";
    p.vy += (upward ? -gravity * 0.15 : gravity) * dt;
    p.vx *= drag;
    p.vy *= drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.kind === "wisp") p.x += Math.sin(p.life * 3 + p.rot) * 20 * dt;
    if (p.y > height + 40 || p.x < -40 || p.x > width + 40) continue;
    alive.push(p);
  }
  return alive;
}

export function drawParticles(ctx, particles, width, height) {
  ctx.clearRect(0, 0, width, height);
  for (const p of particles) {
    const fade = 1 - p.life / p.ttl;
    ctx.globalAlpha = Math.max(0, Math.min(1, fade * 1.2));
    ctx.fillStyle = p.color;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.kind === "confetti") ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    else if (p.kind === "crystal" || p.kind === "prism") {
      ctx.beginPath();
      ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.7, 0); ctx.lineTo(0, p.size); ctx.lineTo(-p.size * 0.7, 0); ctx.closePath();
      ctx.fill();
    } else if (p.kind === "leaf") {
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/**
 * Die Partikel-Ebene auf einem Canvas betreiben: spawn → Schleife über requestAnimationFrame, Pause bei
 * verstecktem Tab, stop() räumt auf. Ohne Canvas-Kontext (jsdom) läuft nichts, es fällt nichts um.
 */
export function runParticles(canvas, { kind, budget, origin, doc = typeof document !== "undefined" ? document : null, win = typeof window !== "undefined" ? window : null, rng = Math.random } = {}) {
  const ctx = canvas?.getContext?.("2d");
  if (!ctx || !win) return { stop() {}, count: () => 0 };
  const width = canvas.width || canvas.clientWidth || 800;
  const height = canvas.height || canvas.clientHeight || 600;
  let particles = spawnParticles({ kind, count: particleCap(width, budget), width, height, rng, origin });
  let last = win.performance?.now?.() ?? Date.now();
  let frame = null;
  let stopped = false;
  const tick = (now) => {
    if (stopped) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!(doc && doc.hidden)) {
      particles = stepParticles(particles, dt, { width, height });
      drawParticles(ctx, particles, width, height);
    }
    if (particles.length) frame = win.requestAnimationFrame(tick);
  };
  frame = win.requestAnimationFrame(tick);
  const onVisible = () => { last = win.performance?.now?.() ?? Date.now(); };
  doc?.addEventListener?.("visibilitychange", onVisible);
  return {
    stop() { stopped = true; if (frame) win.cancelAnimationFrame(frame); doc?.removeEventListener?.("visibilitychange", onVisible); },
    count: () => particles.length,
  };
}
