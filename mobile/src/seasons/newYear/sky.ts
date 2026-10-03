// Die Feuerwerks-Ebene in der App (S11 #642, N1 #739, N5 #743): wie layer.js im Web, aber als Worklets auf dem
// UI-Thread - `stepFire` startet Raketen zu ihrer Zeit (Serveruhr), lässt sie zerplatzen, räumt fertige weg und
// schiebt alles mit dem Scrollen (die Teilchen gehören zum Screen); `drawFire` zeichnet mit Skia: Rauch dahinter, die
// Funkenspur, je Stern ein Schein und ein Kern in additiver Mischung. Kein Nachholen nach dem Hintergrund. Um 00:00
// formen die Funken der Ziffer-Raketen die neue Jahreszahl (#853, yearDigits.ts).

import type { SkCanvas, SkColor, SkPaint } from "@shopify/react-native-skia";
import { CRACKLE_SECONDS, SHELLS, SMOKE_SECONDS, SPARK_SECONDS, burstPoint, burstStars, crackleFlashes, distanceLight, hashText, launchDuration, maxStars, rocketAt, seededRandom, smokeAt, spreadFor, starAt, starLight, trailRate, type Launch, type Point, type Size, type Star } from "./fireworks";
import { YEAR_FORM, isGlyph, yearStarAt, yearStarCount, yearStarLight, yearStars, type YearStar } from "./yearDigits";

/** Teilchen je Show in der App (#642: 200/400) - „normal“ und „kräftig“. */
export const APP_CAPS = { normal: 200, full: 400 } as const;
export const LATE_MS = 1500;
/** So weit schaut die Ebene voraus, bevor sie schlafen geht (der JS-Thread weckt sie rechtzeitig). */
export const LOOKAHEAD_MS = 4000;
const MAX_SMOKE = 10;

export type Spark = { x: number; y: number; born: number; vx: number; vy: number };
export type Flash = { dx: number; dy: number; size: number };
export type FireItem = { launch: Launch; t0: number; stars: Star[] | null; digits: YearStar[] | null; origin: Point | null; sparks: Spark[]; lastSpark: number; flashes: Flash[][] | null; shift: number; seed: number };
export type Puff = { origin: Point; t0: number; distance: number; shift: number };
export type FireState = { live: FireItem[]; smoke: Puff[]; started: Record<string, number>; startedCount: number };

export function emptyFire(): FireState {
  "worklet";
  return { live: [], smoke: [], started: {}, startedCount: 0 };
}

export function capFor(effective: string): number {
  return effective === "full" ? APP_CAPS.full : effective === "normal" ? APP_CAPS.normal : 0;
}

export function countParticles(state: FireState): number {
  "worklet";
  let sum = 0;
  for (const item of state.live) sum += (item.stars ? item.stars.length : 0) + (item.digits ? item.digits.length : 0) + item.sparks.length;
  return sum;
}

/**
 * Ein Bild weiter: fällige Raketen starten (zu spät gekommene bleiben aus), Funkenspur nachlegen, nach dem Aufstieg
 * zerplatzen (so viele Sterne, wie das Budget erlaubt), Fertiges wegräumen, `scrolled` (Punkte, die der Screen seit
 * dem letzten Bild gescrollt hat) schiebt alles mit. Gibt den Zustand zurück (für `modify`).
 */
export function stepFire(state: FireState, plan: Launch[], now: number, size: Size, wind: number, cap: number, scrolled = 0): FireState {
  "worklet";
  // Erst alles Vorhandene mit dem Scrollen schieben - was in diesem Bild neu entsteht, hat den Stand schon.
  for (const puff of state.smoke) puff.shift -= scrolled;
  for (const item of state.live) {
    item.shift -= scrolled;
    for (const spark of item.sparks) spark.y -= scrolled;
  }
  for (const launch of plan) {
    if (state.started[launch.id]) continue;
    if (launch.at <= now - LATE_MS) {
      state.started[launch.id] = 1;
      state.startedCount += 1;
    } else if (launch.at <= now) {
      state.started[launch.id] = 1;
      state.startedCount += 1;
      state.live.push({ launch, t0: launch.at, stars: null, digits: null, origin: null, sparks: [], lastSpark: launch.at, flashes: null, shift: 0, seed: hashText(`burst:${launch.id}`) });
    }
  }
  // Ausklang (N5): Merker vergangener Stunden nicht ansammeln.
  if (state.startedCount > plan.length + 400) {
    const keep: Record<string, number> = {};
    let count = 0;
    for (const launch of plan) {
      if (state.started[launch.id]) {
        keep[launch.id] = 1;
        count += 1;
      }
    }
    state.started = keep;
    state.startedCount = count;
  }
  let particles = countParticles(state);
  const next: FireItem[] = [];
  for (const item of state.live) {
    const { launch } = item;
    const t = (now - item.t0) / 1000;
    if (t < launch.rise) {
      const rocket = rocketAt(launch, t, size, wind);
      const every = 1000 / Math.max(1, trailRate(launch));
      const rng = seededRandom(item.seed + Math.floor(item.lastSpark));
      while (rocket && item.lastSpark + every <= now && particles < cap) {
        item.lastSpark += every;
        item.sparks.push({ x: rocket.x + (rng() - 0.5) * 2, y: rocket.y + 3 + item.shift, born: item.lastSpark, vx: (rng() - 0.5) * 10, vy: 12 + rng() * 18 });
        particles += 1;
      }
    } else if (!item.stars) {
      // Zerplatzen: so viele Sterne, wie das Budget erlaubt - die Jahreszahl bekommt ihren festen Anteil (lesbar).
      const room = Math.max(0, cap - particles);
      item.origin = burstPoint(launch, size, wind);
      const rng = seededRandom(item.seed);
      if (isGlyph(launch)) {
        item.digits = yearStars(launch, rng, size, yearStarCount(cap));
        item.stars = [];
        particles += item.digits.length;
      } else {
        item.stars = burstStars(launch, rng, Math.min(1, room / maxStars(launch)), spreadFor(size));
        particles += item.stars.length;
      }
      if (state.smoke.length < MAX_SMOKE) state.smoke.push({ origin: item.origin, t0: item.t0 + launch.rise * 1000, distance: launch.distance, shift: item.shift });
      if (launch.type === "crackle") {
        const flashes: Flash[][] = [];
        for (let i = 0; i < item.stars.length; i += 1) flashes.push(crackleFlashes(rng));
        item.flashes = flashes;
      }
    }
    item.sparks = item.sparks.filter((spark) => now - spark.born < SPARK_SECONDS * 1000);
    if (t < launchDuration(launch)) next.push(item);
  }
  state.live = next;
  const smoke: Puff[] = [];
  for (const puff of state.smoke) {
    if ((now - puff.t0) / 1000 < SMOKE_SECONDS) smoke.push(puff);
  }
  state.smoke = smoke;
  return state;
}

/** Steht in den nächsten Sekunden nichts an und ist nichts in der Luft? Dann darf die Ebene schlafen. */
export function fireIdle(state: FireState, plan: Launch[], now: number): boolean {
  "worklet";
  if (state.live.length || state.smoke.length) return false;
  for (const launch of plan) {
    if (!state.started[launch.id] && launch.at > now - LATE_MS && launch.at < now + LOOKAHEAD_MS) return false;
  }
  return true;
}

/** Die nächste Startzeit nach `now` (ms) - für das Wecken vom JS-Thread; ohne weitere: null. */
export function nextLaunchAt(plan: Launch[], now: number): number | null {
  let best: number | null = null;
  for (const launch of plan) if (launch.at > now && (best === null || launch.at < best)) best = launch.at;
  return best;
}

export type DrawKit = { paint: SkPaint; smokePaint: SkPaint; colors: Record<string, SkColor>; ember: SkColor; smoke: SkColor };

/** So viele Ringe je Rauchwolke: innen dicht, nach außen immer dünner - wie der Verlauf im Web. */
export const SMOKE_RINGS = 6;

/** Ein leuchtender Punkt: weicher Schein und heller Kern (additiv) - ohne teure Unschärfe. */
function glow(canvas: SkCanvas, kit: DrawKit, color: SkColor, x: number, y: number, radius: number, alpha: number) {
  "worklet";
  if (alpha <= 0.01) return;
  kit.paint.setColor(color);
  kit.paint.setAlphaf(Math.min(1, alpha * 0.22));
  canvas.drawCircle(x, y, radius * 3, kit.paint);
  kit.paint.setAlphaf(Math.min(1, alpha));
  canvas.drawCircle(x, y, radius, kit.paint);
}

/** Die Funken einer Ziffer: im Flug in die Form mit kurzer Spur, dann stehend, beim Rieseln mit Glut - wie im Web. */
function drawYear(canvas: SkCanvas, kit: DrawKit, stars: YearStar[], age: number, origin: Point, wind: number, light: number) {
  "worklet";
  for (const star of stars) {
    const lit = yearStarLight(star, age);
    if (lit.alpha <= 0) continue;
    const pos = yearStarAt(star, age, origin, wind);
    const color = lit.ember > 0.6 ? kit.ember : kit.colors[star.color];
    if (age < YEAR_FORM) {
      for (let k = 1; k <= 2; k += 1) {
        const prev = yearStarAt(star, Math.max(0, age - 0.05 * k), origin, wind);
        glow(canvas, kit, color, prev.x, prev.y, star.size * (1 - k * 0.25), lit.alpha * light * (0.4 - k * 0.12));
      }
    }
    glow(canvas, kit, color, pos.x, pos.y, star.size, lit.alpha * light);
  }
}

/** Das Bild der Ebene: Rauch, Funkenspuren, Raketen, Sterne (mit Spuren, Glut und Knister-Blitzen), die Jahreszahl. */
export function drawFire(canvas: SkCanvas, state: FireState, now: number, size: Size, wind: number, kit: DrawKit) {
  "worklet";
  // Rauch deckt ab statt zu leuchten (eigener Pinsel ohne „Plus“) und hat keinen harten Rand: gestapelte Ringe, jeder
  // kleiner und gleich dünn - in der Mitte am dichtesten, am Rand kaum noch da. Eine Scheibe sah aus wie eine Blase.
  kit.smokePaint.setColor(kit.smoke);
  kit.smokePaint.setAlphaf(0);
  for (const puff of state.smoke) {
    const smoke = smokeAt(puff.origin, (now - puff.t0) / 1000, wind, puff.distance);
    if (!smoke || smoke.alpha <= 0.005) continue;
    kit.smokePaint.setAlphaf(smoke.alpha / SMOKE_RINGS);
    for (let ring = 0; ring < SMOKE_RINGS; ring += 1) canvas.drawCircle(smoke.x, smoke.y + puff.shift, smoke.r * (1 - ring / SMOKE_RINGS), kit.smokePaint);
  }
  for (const item of state.live) {
    const { launch } = item;
    const shell = SHELLS[launch.type] || SHELLS.peony;
    const light = distanceLight(launch.distance);
    const t = (now - item.t0) / 1000;
    for (const spark of item.sparks) {
      const age = (now - spark.born) / 1000;
      glow(canvas, kit, kit.ember, spark.x + spark.vx * age, spark.y + spark.vy * age + 20 * age * age, 0.9, (1 - age / SPARK_SECONDS) * 0.8 * light);
    }
    if (t < launch.rise) {
      const rocket = rocketAt(launch, t, size, wind);
      if (rocket) glow(canvas, kit, kit.colors.gold, rocket.x, rocket.y + item.shift, 1.6, 0.95 * light);
      continue;
    }
    if (!item.stars || !item.origin) continue;
    const age = t - launch.rise;
    const origin = { x: item.origin.x, y: item.origin.y + item.shift };
    if (item.digits) {
      drawYear(canvas, kit, item.digits, age, origin, wind, light);
      continue;
    }
    for (let index = 0; index < item.stars.length; index += 1) {
      const star = item.stars[index];
      const lit = starLight(star, age);
      const pos = starAt(star, age, shell, origin, wind, launch.distance);
      if (lit.alpha > 0) {
        const color = lit.ember > 0.6 ? kit.ember : kit.colors[star.color];
        if (shell.trail > 0) {
          for (let k = 1; k <= 3; k += 1) {
            const back = age - (shell.trail * k) / 3;
            if (back <= 0) break;
            const prev = starAt(star, back, shell, origin, wind, launch.distance);
            glow(canvas, kit, color, prev.x, prev.y, star.size * (1 - k * 0.2), lit.alpha * light * (0.45 - k * 0.12));
          }
        }
        glow(canvas, kit, color, pos.x, pos.y, star.size, lit.alpha * light);
      } else if (star.crackleAt !== null && item.flashes) {
        const since = age - star.crackleAt * star.life;
        if (since >= 0 && since < CRACKLE_SECONDS) {
          for (const flash of item.flashes[index]) glow(canvas, kit, kit.colors.white, pos.x + flash.dx, pos.y + flash.dy, flash.size, (1 - since / CRACKLE_SECONDS) * light);
        }
      }
    }
  }
}
