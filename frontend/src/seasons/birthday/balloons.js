// Luftballons am Vereinsgeburtstag (#856): ab und zu steigt eine kleine Welle an den Rändern auf - zwei, drei Ballons
// in Vereinsfarben, langsam, leicht pendelnd, mit Schnur. Sie gehören zur Seite (Seitenkoordinaten, sie scrollen mit)
// und liegen auf dem gemeinsamen Himmel hinter dem Inhalt - nie über Text. Zwischen den Wellen schläft der Loop.
import { mulberry32 } from "../rng";
import { wakeSky } from "../sky";

/** Farbe und Glanz je Ballon: Vereinsblau, Gold, Weiß und ein Rosa wie die Streusel der Torte. */
export const BALLOON_COLORS = [["#29B6E8", "#bfeaf9"], ["#FFD700", "#fff6c2"], ["#f7f4ee", "#ffffff"], ["#ff4fa3", "#ffc2e0"]];
export const WAVE_SECONDS = 26;

/** Ballons je Welle: wenige - bei „voll“ ein paar mehr; ohne Budget keine. */
export function waveSize(budget, effective = "normal") {
  if (!(Number(budget) > 0)) return 0;
  return effective === "full" ? 4 : 3;
}

/**
 * Eine Welle (Seitenkoordinaten): abwechselnd links und rechts im äußeren Streifen, Start unter dem Fenster, je
 * Ballon eigene Größe, Geschwindigkeit, Pendel und Verzögerung.
 */
export function balloonWave(rng, view, count, scrollY = 0) {
  const width = Math.max(320, Number(view?.width) || 1280);
  const height = Math.max(400, Number(view?.height) || 800);
  const firstSide = rng() < 0.5 ? 0 : 1;
  return Array.from({ length: count }, (_, index) => {
    const left = (index + firstSide) % 2 === 0;
    const band = width < 640 ? 0.07 : 0.09;
    const x = left ? width * (0.015 + rng() * band) : width * (1 - 0.015 - rng() * band);
    const size = Math.round((width < 640 ? 18 : 24) + rng() * (width < 640 ? 6 : 10));
    return {
      x: Math.round(x),
      startY: Math.round(scrollY + height + 40 + size * 1.2),
      size,
      speed: Math.round(36 + rng() * 26),
      sway: Math.round(5 + rng() * 9),
      swayHz: Math.round((0.12 + rng() * 0.12) * 1000) / 1000,
      phase: Math.round(rng() * 628) / 100,
      color: Math.floor(rng() * BALLOON_COLORS.length),
      delay: Math.round(rng() * 2600 + index * 900),
    };
  });
}

/** Wo ein Ballon nach `t` Sekunden ist (Seitenkoordinaten) - und wie er sich neigt. */
export function balloonAt(balloon, t) {
  const swing = Math.sin(2 * Math.PI * balloon.swayHz * t + balloon.phase);
  return { x: balloon.x + swing * balloon.sway, y: balloon.startY - balloon.speed * t, tilt: swing * 0.09 };
}

function drawBalloon(ctx, balloon, at) {
  const [body, shine] = BALLOON_COLORS[balloon.color] || BALLOON_COLORS[0];
  const w = balloon.size;
  const h = w * 1.22;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(at.tilt);
  // Die Schnur: leicht geschwungen, hängt unter dem Knoten.
  ctx.beginPath();
  ctx.moveTo(0, h / 2 + 3);
  ctx.bezierCurveTo(-w * 0.18, h / 2 + w * 0.7, w * 0.2, h / 2 + w * 1.3, -w * 0.05, h / 2 + w * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // Der Knoten.
  ctx.beginPath();
  ctx.moveTo(-2.6, h / 2 + 3.4);
  ctx.lineTo(2.6, h / 2 + 3.4);
  ctx.lineTo(0, h / 2 - 0.6);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  // Der Ballon mit Glanzlicht oben links.
  const gradient = ctx.createRadialGradient(-w * 0.18, -h * 0.22, w * 0.05, 0, 0, w * 0.75);
  gradient.addColorStop(0, shine);
  gradient.addColorStop(0.35, body);
  gradient.addColorStop(1, body);
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

const listeners = new Set();
const monotonic = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Eine Welle anfordern - jede Ballon-Ebene, die gerade lebt, nimmt sie auf. */
export function requestBalloons() {
  listeners.forEach((listener) => listener());
  wakeSky();
}

/** Die Ballon-Ebene für den gemeinsamen Canvas-Loop. */
export function createBalloonLayer({ budget = 120, effective = "normal", seed = 1, clock = monotonic, win = typeof window === "undefined" ? null : window } = {}) {
  const rng = mulberry32(seed);
  const count = waveSize(budget, effective);
  const state = { flying: [] };
  const scroll = () => (win ? Number(win.scrollY) || 0 : 0);
  const view = () => (win ? { width: win.innerWidth || 1280, height: win.innerHeight || 800 } : { width: 1280, height: 800 });
  const onWave = () => {
    if (!count || state.flying.length > count * 2) return;
    const now = clock();
    balloonWave(rng, view(), count, scroll()).forEach((balloon) => state.flying.push({ balloon, start: now }));
  };
  listeners.add(onWave);

  const draw = (ctx, _dt, size) => {
    const now = clock();
    const scrollY = scroll();
    const still = [];
    for (const item of state.flying) {
      const t = (now - item.start - item.balloon.delay) / 1000;
      if (t < 0) {
        still.push(item);
        continue;
      }
      if (t > WAVE_SECONDS * 2) continue;
      const at = balloonAt(item.balloon, t);
      const screenY = at.y - scrollY;
      if (screenY < -item.balloon.size * 4) continue;
      if (screenY < size.height + item.balloon.size * 3) drawBalloon(ctx, item.balloon, { ...at, y: screenY });
      still.push(item);
    }
    state.flying = still;
  };

  return {
    kind: "balloons",
    draw,
    idle: () => state.flying.length === 0,
    snapshot: () => ({ flying: state.flying.length, wave: count }),
    dispose: () => {
      listeners.delete(onWave);
      state.flying = [];
    },
  };
}

/**
 * Wann das nächste Mal gefeiert wird (Millisekunden): Ballons alle 70 bis 120 Sekunden, Konfetti alle drei bis fünf
 * Minuten - die erste Ballon-Welle kurz nach dem Laden.
 */
export function nextCelebration(kind, rng, first = false) {
  if (kind === "balloons") return first ? 2500 : 70000 + Math.round(rng() * 50000);
  return first ? 150000 + Math.round(rng() * 60000) : 180000 + Math.round(rng() * 120000);
}
