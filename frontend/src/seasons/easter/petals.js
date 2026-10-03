// Blütenblätter für den gemeinsamen Canvas-Loop (#753): wenige, langsam, selten - ein Blatt hier und da, das taumelnd
// sinkt. Sie gehören zur Seite (beim Scrollen ziehen sie mit wie der Schnee). Ohne Bewegung, bei „dezent“ und am
// Karfreitag gibt es die Ebene gar nicht (index.jsx).
import { mulberry32 } from "../rng";

// Kirschblüte rosa und hell, Forsythie gelb - kräftig genug, dass man ein Blatt erkennt, nicht einen Krümel.
export const PETAL_COLORS = ["#f3a6ba", "#fbd3de", "#fff3ee", "#f6d462"];
export const MAX_PETALS = 14;

/** Wie viele Blätter: aus dem Budget des Himmels (40/60/120/240) und dem Anteil der Seite, höchstens vierzehn. */
export function petalCount(budget, share = 1) {
  return Math.max(0, Math.min(MAX_PETALS, Math.round((Math.max(0, Number(budget) || 0) / 10) * share)));
}

/** Ein neues Blatt: irgendwo in der Breite, über dem Fenster (oder am Anfang irgendwo darin). */
export function createPetal(rng, size, anywhere = false) {
  return {
    x: rng() * size.width,
    y: anywhere ? rng() * size.height : -20 - rng() * size.height * 0.6,
    r: 4.4 + rng() * 3.4,
    fall: 11 + rng() * 12,
    amp: 16 + rng() * 26,
    freq: 0.35 + rng() * 0.35,
    phase: rng() * Math.PI * 2,
    angle: rng() * Math.PI * 2,
    spin: (rng() - 0.5) * 1.6,
    flip: 1.2 + rng() * 1.6,
    color: PETAL_COLORS[Math.floor(rng() * PETAL_COLORS.length)],
    t: 0,
  };
}

/** Ein Schritt (Sekunden): sinken, pendeln, drehen; unten raus → oben neu. */
export function stepPetal(petal, dt, size, rng) {
  const t = petal.t + dt;
  const next = { ...petal, t, y: petal.y + petal.fall * dt, angle: petal.angle + petal.spin * dt };
  if (next.y > size.height + 24) return createPetal(rng, size);
  return next;
}

/** Wo das Blatt gerade gezeichnet wird: die Mitte pendelt um x. */
export function petalAt(petal) {
  return { x: petal.x + Math.sin(petal.t * petal.freq * Math.PI * 2 + petal.phase) * petal.amp, y: petal.y, squash: 0.5 + 0.5 * Math.abs(Math.sin(petal.t * petal.flip + petal.phase)) };
}

/** Die Ebene: `draw(ctx, dt, size)` für den Loop. `win` für den Scrollstand (die Blätter gehören zur Seite). */
export function createPetalLayer({ count = 6, seed = 1, win = typeof window === "undefined" ? null : window } = {}) {
  const rng = mulberry32(Number(seed) >>> 0);
  let petals = null;
  let lastScrollY = win ? Number(win.scrollY) || 0 : 0;
  return {
    count,
    petals: () => petals || [],
    draw(ctx, dt, size) {
      if (!petals) petals = Array.from({ length: count }, () => createPetal(rng, size, true));
      const scrollY = win ? Number(win.scrollY) || 0 : 0;
      const shift = scrollY - lastScrollY;
      lastScrollY = scrollY;
      const step = Math.min(0.1, Math.max(0, dt));
      petals = petals.map((petal) => stepPetal(shift ? { ...petal, y: petal.y - shift } : petal, step, size, rng));
      if (!ctx) return;
      for (const petal of petals) {
        const at = petalAt(petal);
        if (at.y < -12 || at.y > size.height + 12) continue;
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.rotate(petal.angle);
        ctx.scale(1, at.squash);
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = petal.color;
        ctx.beginPath();
        // Ein Blütenblatt: rundlich, an einem Ende spitz, mit einer feinen Mittelrippe.
        ctx.moveTo(-petal.r, 0);
        ctx.quadraticCurveTo(-petal.r * 0.1, -petal.r * 1.05, petal.r, 0);
        ctx.quadraticCurveTo(-petal.r * 0.1, petal.r * 1.05, -petal.r, 0);
        ctx.fill();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-petal.r * 0.7, 0);
        ctx.lineTo(petal.r * 0.6, 0);
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}
