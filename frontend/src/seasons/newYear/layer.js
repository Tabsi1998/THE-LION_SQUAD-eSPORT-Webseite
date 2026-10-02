// Die Feuerwerks-Ebene für den gemeinsamen Canvas-Loop (S9 #640, N1 #739, N5 #743): startet die Raketen der
// Choreografie zu ihrer Zeit (Serveruhr), zeichnet Aufstieg mit Funkenspur, die Sterne je Art (mit Spuren, Glitzern,
// Knistern, Nachglühen) und dahinter den Rauch. Hält das Teilchenbudget (#640: 200/600/1200 je Gerät), holt nach einem
// versteckten Tab nichts nach, räumt fertige Raketen weg und schläft, wenn nichts ansteht (der Loop prüft alle 2 s).

import { hashString, mulberry32 } from "../rng";
import { COLORS, CRACKLE_SECONDS, EMBER, SHELLS, SMOKE_SECONDS, SPARK_SECONDS, burstPoint, burstStars, crackleFlashes, distanceLight, launchDuration, rocketAt, smokeAt, spreadFor, starAt, starLight, trailRate } from "./fireworks";

/** Teilchen je Gerät für die Show (#640); `budget` des Himmels (40/120/240) wird darauf abgebildet. */
export const SHOW_CAPS = { 40: 200, 60: 300, 120: 600, 240: 1200 };
/** Eine Rakete, die schon so lange hätte steigen sollen, startet nicht mehr - kein Nachholen nach versteckten Tabs. */
export const LATE_MS = 1500;
/** So weit schaut die Ebene voraus, ob bald etwas ansteht (sonst schläft der Loop). */
export const LOOKAHEAD_MS = 4000;
const MAX_SMOKE = 14;

export function showCap(budget) {
  return SHOW_CAPS[budget] || Math.round(Math.max(0, Number(budget) || 0) * 5);
}

function hexToRgb(hex) {
  const value = parseInt(String(hex).slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Leuchtpunkte je Farbe: heller Kern, weicher Schein - einmal vorgezeichnet, dann nur noch kopiert. */
export function makeGlows(doc = typeof document === "undefined" ? null : document, ratio = 1) {
  if (!doc || typeof doc.createElement !== "function") return null;
  const glows = {};
  for (const [name, hex] of Object.entries({ ...COLORS, ember: EMBER })) {
    const canvas = doc.createElement("canvas");
    const size = Math.ceil(24 * ratio);
    canvas.width = size;
    canvas.height = size;
    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx) return null;
    const [r, g, b] = hexToRgb(hex);
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, 0.95)`);
    gradient.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.35)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    glows[name] = canvas;
  }
  return glows;
}

/**
 * Die Ebene. `plan()` liefert die anstehenden Raketen (Choreografie aus der aktuellen Saison), `clock()` die Serverzeit
 * in ms, `wind()` die Drift in px/s, `onLaunch`/`onBurst` melden Klang (index.jsx). `budget` kommt vom Himmel (sky.js).
 */
export function createFireworksLayer({ plan, clock = () => Date.now(), wind = () => 0, budget = 120, onLaunch = () => {}, onBurst = () => {}, doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window, ratio = 1 } = {}) {
  const cap = showCap(budget);
  const state = { live: [], started: new Set(), smoke: [], glows: null, particles: 0 };
  // Die Teilchen gehören zur Seite (wie der Schnee): was in der Luft ist, zieht beim Scrollen mit.
  let lastScrollY = win ? Number(win.scrollY) || 0 : 0;

  const start = (launch, now) => {
    state.started.add(launch.id);
    state.live.push({ launch, t0: launch.at, stars: null, sparks: [], origin: null, rng: mulberry32(hashString(`burst:${launch.id}`)), lastSpark: launch.at, flashes: null, shift: 0 });
    onLaunch(launch, now);
  };

  /** Raketen, deren Zeit gekommen ist - zu spät gekommene (versteckter Tab) bleiben aus. */
  const launchDue = (now) => {
    const launches = plan();
    for (const launch of launches) {
      if (state.started.has(launch.id)) continue;
      if (launch.at <= now && launch.at > now - LATE_MS) start(launch, now);
      else if (launch.at <= now - LATE_MS) state.started.add(launch.id);
    }
    // Ausklang (N5): Merker vergangener Stunden nicht ansammeln - nur behalten, was im aktuellen Plan steht.
    if (state.started.size > launches.length + 400) {
      const current = new Set(launches.map((launch) => launch.id));
      state.started = new Set([...state.started].filter((id) => current.has(id)));
    }
  };

  const countParticles = () => state.live.reduce((sum, item) => sum + (item.stars ? item.stars.length : 0) + item.sparks.length, 0);

  /** Scrollen schiebt alles in der Luft - neue Teilchen bekommen den Stand des Bildes. */
  const scrollBy = (dy) => {
    if (!dy) return;
    for (const puff of state.smoke) puff.shift -= dy;
    for (const item of state.live) {
      item.shift -= dy;
      for (const spark of item.sparks) spark.y -= dy;
    }
  };

  const update = (now, size, scrolled = 0) => {
    const drift = wind();
    scrollBy(scrolled);
    launchDue(now);
    state.particles = countParticles();
    for (const item of state.live) {
      const { launch } = item;
      const t = (now - item.t0) / 1000;
      if (t < launch.rise) {
        // Funkenspur: neue Funken an der Rakete, sie sinken und verglimmen.
        const rocket = rocketAt(launch, t, size, drift);
        const every = 1000 / Math.max(1, trailRate(launch));
        while (rocket && item.lastSpark + every <= now && state.particles < cap) {
          item.lastSpark += every;
          item.sparks.push({ x: rocket.x + (item.rng() - 0.5) * 2, y: rocket.y + 3 + item.shift, born: item.lastSpark, vx: (item.rng() - 0.5) * 10, vy: 12 + item.rng() * 18 });
          state.particles += 1;
        }
      } else if (!item.stars) {
        // Zerplatzen: so viele Sterne, wie das Budget noch erlaubt.
        const shell = SHELLS[launch.type] || SHELLS.peony;
        const room = Math.max(0, cap - state.particles);
        const wanted = shell.stars[1];
        item.origin = burstPoint(launch, size, drift);
        item.stars = burstStars(launch, item.rng, Math.min(1, room / wanted), spreadFor(size));
        state.particles += item.stars.length;
        if (state.smoke.length < MAX_SMOKE) state.smoke.push({ origin: item.origin, t0: item.t0 + launch.rise * 1000, distance: launch.distance, shift: item.shift });
        if (launch.type === "crackle") item.flashes = item.stars.map(() => crackleFlashes(null, item.rng));
        onBurst(launch, now);
      }
      item.sparks = item.sparks.filter((spark) => now - spark.born < SPARK_SECONDS * 1000);
    }
    state.live = state.live.filter((item) => (now - item.t0) / 1000 < launchDuration(item.launch));
    state.smoke = state.smoke.filter((puff) => (now - puff.t0) / 1000 < SMOKE_SECONDS);
  };

  const drawGlow = (ctx, color, x, y, radius, alpha) => {
    if (alpha <= 0.01) return;
    const glow = state.glows && state.glows[color];
    const r = radius * 3.2;
    if (glow) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(glow, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLORS[color] || EMBER;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const draw = (ctx, dt, size) => {
    if (!state.glows) state.glows = makeGlows(doc, ratio);
    const now = clock();
    const scrollY = win ? Number(win.scrollY) || 0 : 0;
    update(now, size, scrollY - lastScrollY);
    lastScrollY = scrollY;
    const drift = wind();
    // Rauch zuerst - hinter allem, ohne Leuchten.
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (const puff of state.smoke) {
      const smoke = smokeAt(puff.origin, (now - puff.t0) / 1000, drift, puff.distance);
      if (!smoke || smoke.alpha <= 0.005) continue;
      smoke.y += puff.shift || 0;
      const gradient = ctx.createRadialGradient(smoke.x, smoke.y, 0, smoke.x, smoke.y, smoke.r);
      gradient.addColorStop(0, `rgba(170, 175, 190, ${smoke.alpha})`);
      gradient.addColorStop(1, "rgba(170, 175, 190, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(smoke.x, smoke.y, smoke.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    for (const item of state.live) {
      const { launch } = item;
      const shell = SHELLS[launch.type] || SHELLS.peony;
      const light = distanceLight(launch.distance);
      const t = (now - item.t0) / 1000;
      for (const spark of item.sparks) {
        const age = (now - spark.born) / 1000;
        drawGlow(ctx, "ember", spark.x + spark.vx * age, spark.y + spark.vy * age + 20 * age * age, 0.9, (1 - age / SPARK_SECONDS) * 0.8 * light);
      }
      if (t < launch.rise) {
        const rocket = rocketAt(launch, t, size, drift);
        if (rocket) drawGlow(ctx, "gold", rocket.x, rocket.y + item.shift, 1.6, 0.95 * light);
        continue;
      }
      if (!item.stars) continue;
      const age = t - launch.rise;
      const origin = { x: item.origin.x, y: item.origin.y + item.shift };
      item.stars.forEach((star, index) => {
        const lit = starLight(star, age);
        const pos = starAt(star, age, shell, origin, drift, launch.distance);
        if (lit.alpha > 0) {
          // Spuren: ein paar frühere Punkte derselben Bahn, immer schwächer (Chrysantheme, Weide lang).
          if (shell.trail > 0) {
            for (let k = 1; k <= 3; k += 1) {
              const back = age - (shell.trail * k) / 3;
              if (back <= 0) break;
              const prev = starAt(star, back, shell, origin, drift, launch.distance);
              drawGlow(ctx, lit.ember > 0.5 ? "ember" : star.color, prev.x, prev.y, star.size * (1 - k * 0.2), lit.alpha * light * (0.45 - k * 0.12));
            }
          }
          drawGlow(ctx, lit.ember > 0.6 ? "ember" : star.color, pos.x, pos.y, star.size, lit.alpha * light);
        } else if (star.crackleAt !== null && item.flashes) {
          // Knistern: kurz nach dem Erlöschen ein paar weiße Blitze um die Stelle.
          const since = age - star.crackleAt * star.life;
          if (since >= 0 && since < CRACKLE_SECONDS) {
            for (const flash of item.flashes[index]) drawGlow(ctx, "white", pos.x + flash.dx, pos.y + flash.dy, flash.size, (1 - since / CRACKLE_SECONDS) * light);
          }
        }
      });
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  return {
    kind: "fireworks",
    draw,
    /** Schlafen, wenn nichts in der Luft ist und in den nächsten Sekunden nichts startet. */
    idle: () => {
      if (state.live.length || state.smoke.length) return false;
      const now = clock();
      return !plan().some((launch) => !state.started.has(launch.id) && launch.at > now - LATE_MS && launch.at < now + LOOKAHEAD_MS);
    },
    dispose: () => {
      state.live = [];
      state.smoke = [];
      state.started.clear();
    },
    /** Nur für Tests und die Abnahme: was gerade in der Luft ist. */
    snapshot: () => ({ live: state.live.length, smoke: state.smoke.length, particles: countParticles(), cap }),
    update,
  };
}

