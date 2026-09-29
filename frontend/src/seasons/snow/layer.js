// Die Schnee-Ebene für den gemeinsamen Canvas-Loop (S7, #638; W2, #728): hält die Flocken je Tiefe, zeichnet sie
// als vorgezeichnete Sprites (sechs Formen in drei Größen, hinten weich), hört auf das Wetter (Wind und ob es
// wirklich schneit), führt die Böen und den Ausklang und schiebt die Flocken mit dem Scrollen (sie gehören zur Seite). Pausiert wird sie vom Loop (versteckter Tab); ohne Bewegung
// (Reduced Motion, „dezent“) wird sie gar nicht erst erzeugt (index.jsx).

import { hashString, mulberry32 } from "../rng";
import { DEPTHS, DEPTH_ORDER, SHAPES, advanceFlake, createFlake, fadeAt, flakeCounts, nextGust, scrollFlake, windAt, windFrom } from "./flakes";

/** Sprite-Größen (Radius), auf die eine Flocke gerundet wird. */
export const SPRITE_RADII = [1.6, 2.6, 4, 6.2];
const WHITE = "rgba(255, 255, 255, 1)";

/** Eine Form um den Ursprung mit Radius r zeichnen - Weiß, leicht durchscheinend im Kern. */
export function drawShape(ctx, shape, r) {
  ctx.save();
  ctx.strokeStyle = WHITE;
  ctx.fillStyle = WHITE;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(0.6, r * 0.22);
  if (shape === "dot") {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    gradient.addColorStop(0.6, "rgba(255, 255, 255, 0.45)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === "plate") {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape === "needle") {
    ctx.beginPath();
    ctx.moveTo(-r, -r * 0.2);
    ctx.lineTo(r, r * 0.2);
    ctx.moveTo(-r * 0.7, r * 0.5);
    ctx.lineTo(r * 0.7, -r * 0.5);
    ctx.stroke();
  } else if (shape === "clump") {
    [[0, 0, r * 0.7], [-r * 0.45, r * 0.3, r * 0.5], [r * 0.5, -r * 0.25, r * 0.45]].forEach(([x, y, radius]) => {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    // star und dendrite: sechs Strahlen, der Dendrit mit zwei Astpaaren je Strahl und Punkten an den Spitzen.
    const dendrite = shape === "dendrite";
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ux * r, uy * r);
      ctx.stroke();
      const branches = dendrite ? [0.45, 0.72] : [0.62];
      branches.forEach((at) => {
        const bx = ux * r * at;
        const by = uy * r * at;
        const len = r * (dendrite ? 0.28 : 0.22);
        [a + Math.PI / 3, a - Math.PI / 3].forEach((angle) => {
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(angle) * len, by + Math.sin(angle) * len);
          ctx.stroke();
        });
      });
      if (dendrite) {
        ctx.beginPath();
        ctx.arc(ux * r, uy * r, r * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** Sprites: je Form und Größe eine kleine Zeichenfläche (mit Gerätefaktor); null, wenn es keine 2D-Fläche gibt (Tests). */
export function makeSprites(doc = typeof document === "undefined" ? null : document, ratio = 1) {
  if (!doc || typeof doc.createElement !== "function") return null;
  const sprites = {};
  for (const shape of SHAPES) {
    sprites[shape] = {};
    for (const r of SPRITE_RADII) {
      const pad = Math.ceil(r * 1.6) + 2;
      const canvas = doc.createElement("canvas");
      const size = Math.ceil(pad * 2 * ratio);
      canvas.width = size;
      canvas.height = size;
      const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
      if (!ctx) return null;
      ctx.setTransform(ratio, 0, 0, ratio, pad * ratio, pad * ratio);
      drawShape(ctx, shape, r);
      sprites[shape][r] = { canvas, pad, r };
    }
  }
  return sprites;
}

function spriteFor(sprites, flake) {
  const bucket = SPRITE_RADII.reduce((best, r) => (Math.abs(r - flake.radius) < Math.abs(best - flake.radius) ? r : best), SPRITE_RADII[0]);
  return sprites[flake.shape] ? sprites[flake.shape][bucket] : null;
}

/**
 * Die Ebene. `budget` (sky.js) und `share` (Seitenklasse) bestimmen die Zahl, `weather` Wind und ob es schneit,
 * `endsAt` den Ausklang. `win`/`doc`/`now`/`random` sind für Tests austauschbar.
 */
export function createSnowLayer({ budget = 120, share = 1, seed = "snow", weather = null, endsAt = "", win = typeof window === "undefined" ? null : window, doc = typeof document === "undefined" ? null : document, now = () => Date.now(), ratio = 1 } = {}) {
  const rng = mulberry32(hashString(`snow:${seed}`));
  const state = { t: 0, wind: windFrom(weather), snowing: Boolean(weather && Number(weather.snow_cm) > 0), gust: nextGust(rng, 0), flakes: { back: [], mid: [], front: [] }, counts: null, sprites: null, lastCount: -1e9, spawned: 0 };
  // Scrollstand des letzten Bildes: die Flocken gehören zur Seite, der Unterschied schiebt sie (scrollFlake).
  let lastScrollY = win ? Number(win.scrollY) || 0 : 0;
  const onWeather = (event) => {
    const detail = event && event.detail;
    if (!detail) return;
    state.wind = windFrom(detail);
    state.snowing = Number(detail.snow_cm) > 0;
    state.lastCount = -1e9;
  };
  if (win && typeof win.addEventListener === "function") win.addEventListener("tls:season-weather", onWeather);

  const settle = (size, first) => {
    const counts = flakeCounts(budget, { share, snowing: state.snowing, fade: fadeAt(endsAt, now()) });
    state.counts = counts;
    DEPTH_ORDER.forEach((depth) => {
      const list = state.flakes[depth];
      while (list.length < counts[depth]) {
        list.push(createFlake(depth, size, rng, { index: state.spawned, anywhere: first }));
        state.spawned += 1;
      }
      if (list.length > counts[depth]) list.length = counts[depth];
    });
  };

  return {
    key: "snow-flakes",
    draw(ctx, dt, size) {
      if (!state.sprites) state.sprites = makeSprites(doc, ratio) || false;
      state.t += dt;
      if (state.t - state.lastCount > 5) {
        settle(size, state.lastCount < -1e8);
        state.lastCount = state.t;
      }
      if (state.t > state.gust.at + state.gust.length + 4) state.gust = nextGust(rng, state.t);
      const wind = windAt(state.t, state.wind, state.gust);
      const scrollY = win ? Number(win.scrollY) || 0 : 0;
      const scrolled = scrollY - lastScrollY;
      lastScrollY = scrollY;
      DEPTH_ORDER.forEach((depth) => {
        const soft = DEPTHS[depth].soft;
        state.flakes[depth].forEach((flake) => {
          if (scrolled) scrollFlake(flake, scrolled, size);
          advanceFlake(flake, dt, wind, size);
          if (flake.y < -20 || flake.y > size.height + 20) return;
          ctx.save();
          ctx.globalAlpha = flake.opacity;
          ctx.translate(flake.x, flake.y);
          if (!soft && flake.spin) ctx.rotate(flake.rotation);
          const sprite = state.sprites ? spriteFor(state.sprites, flake) : null;
          if (sprite) {
            const scale = flake.radius / sprite.r;
            ctx.scale(scale, scale);
            ctx.drawImage(sprite.canvas, -sprite.pad, -sprite.pad, sprite.pad * 2, sprite.pad * 2);
          } else {
            drawShape(ctx, flake.shape, flake.radius);
          }
          ctx.restore();
        });
      });
    },
    dispose() {
      if (win && typeof win.removeEventListener === "function") win.removeEventListener("tls:season-weather", onWeather);
    },
    /** Nur für Tests. */
    state() {
      return { t: state.t, wind: state.wind, snowing: state.snowing, counts: state.counts, gust: state.gust, flakes: Object.fromEntries(DEPTH_ORDER.map((depth) => [depth, state.flakes[depth].length])), positions: Object.fromEntries(DEPTH_ORDER.map((depth) => [depth, state.flakes[depth].map((flake) => ({ x: flake.x, y: flake.y }))])) };
    },
  };
}
