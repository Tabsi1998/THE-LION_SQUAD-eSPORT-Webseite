// Fledermäuse leben weiter (H8, #696) und reagieren (H9, #697): eine kleine, deterministische Lebenslogik
// ohne DOM. Zustände: perched → alert → takeoff → flying → approaching → landing → settle → perched; dazu
// „gone“ nach einem Verscheuchen, bis ein neuer Platz frei ist. Vier Temperamente aus dem Seed: sleepy,
// skittish, roamer, curious. Flüge sind Bézier-Bahnen mit kleinen Wellen und Körperdrehung; der Flügelschlag
// läuft getrennt (CSS). Lange Ruhephasen, nie Dauerfeuer.

export const STATES = ["perched", "alert", "takeoff", "flying", "approaching", "landing", "settle", "gone"];
export const TEMPERAMENTS = {
  sleepy: { alertRadius: 90, fleeRadius: 40, fleeChance: 0.15, restSeconds: [240, 480], wander: 0.15, flapSpeed: 0.24, awayFor: [45, 90] },
  skittish: { alertRadius: 170, fleeRadius: 90, fleeChance: 0.6, restSeconds: [120, 300], wander: 0.35, flapSpeed: 0.16, awayFor: [25, 60] },
  roamer: { alertRadius: 120, fleeRadius: 60, fleeChance: 0.3, restSeconds: [60, 150], wander: 0.8, flapSpeed: 0.2, awayFor: [20, 45] },
  curious: { alertRadius: 200, fleeRadius: 55, fleeChance: 0.2, restSeconds: [150, 360], wander: 0.3, flapSpeed: 0.2, awayFor: [30, 70] },
};
export const TEMPERAMENT_KEYS = Object.keys(TEMPERAMENTS);
export const ALERT_SECONDS = 1.6;
/** Ein ruhender Zeiger in der Nähe macht nicht immer wieder aufmerksam: je Fledermaus eine Pause. */
export const ALERT_COOLDOWN_MS = 12000;
export const TAKEOFF_SECONDS = 0.45;
export const LANDING_SECONDS = 0.7;
export const SETTLE_SECONDS = 1.2;
export const MAX_ACTIVE_FLIGHTS = 2;
export const PROXIMITY_COOLDOWN_MS = 8000;
export const BAT_COOLDOWN_MS = 30000;
export const SCROLL_STARTLE_SPEED = 2400;
export const SCROLL_COOLDOWN_MS = 45000;

function between(rng, [min, max]) {
  return min + rng() * (max - min);
}

export function temperamentFor(rng) {
  return TEMPERAMENT_KEYS[Math.floor(rng() * TEMPERAMENT_KEYS.length) % TEMPERAMENT_KEYS.length];
}

/** Eine neue Fledermaus auf ihrem Platz. */
export function createBat(id, perch, rng, forced = null) {
  const temperament = forced && TEMPERAMENTS[forced] ? forced : temperamentFor(rng);
  const spec = TEMPERAMENTS[temperament];
  return {
    id, perch, x: perch.x, y: perch.y, size: perch.size, pose: perch.pose, fixed: perch.fixed, temperament,
    state: "perched", timer: between(rng, spec.restSeconds), alertedAt: -Infinity, lastFleeAt: -Infinity,
    path: null, flight: null, target: null, rotation: 0, facing: 1, wave: rng() * Math.PI * 2, restless: rng() < spec.wander,
  };
}

/** Punkt auf einer Bahn ohne Welle und Drehung (alte Sprache der Tests). */
export function pointOn(path, t) {
  return bezier(path.p0, path.p1, path.p2, path.p3, t);
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Flucht: erst ein Stück hoch, dann weit weg - meist unten aus dem Bild, sonst oben (wie bisher). */
export function fleePath(from, rng, view = { top: 0, bottom: 800, width: 1280 }) {
  const dir = rng() < 0.5 ? -1 : 1;
  const dx = dir * (400 + rng() * 500);
  const endY = rng() < 0.62 ? view.bottom + 120 + rng() * 200 : view.top - 120 - rng() * 120;
  const dy = endY - from.y;
  return { p0: from, p1: { x: from.x + dx * 0.25, y: from.y - 110 - rng() * 60 }, p2: { x: from.x + dx * 0.75, y: from.y + dy - 120 }, p3: { x: from.x + dx, y: from.y + dy }, facing: dir, seconds: 2.6 + rng() * 0.8 };
}

/** Anflug von außerhalb des Fensters zu einem Platz: weit ausholend, mit Bogen, am Ende abbremsend. */
export function approachPath(target, rng, view = { top: 0, bottom: 800, width: 1280 }) {
  const fromLeft = rng() < 0.5;
  const start = { x: fromLeft ? -120 : view.width + 120, y: view.top + (view.bottom - view.top) * (0.1 + rng() * 0.5) };
  const dx = target.x - start.x;
  return {
    p0: start,
    p1: { x: start.x + dx * 0.35, y: start.y - 80 - rng() * 80 },
    p2: { x: target.x - dx * 0.12, y: target.y - 60 - rng() * 40 },
    p3: { x: target.x, y: target.y },
    facing: fromLeft ? 1 : -1,
    seconds: 3.2 + rng() * 1.2,
  };
}

/** Umziehen von Platz zu Platz (Roamer): ein Bogen mit Höhe, Dauer nach Entfernung. */
export function hopPath(from, to, rng) {
  const dx = to.x - from.x;
  const lift = 80 + rng() * 120;
  const distance = Math.hypot(dx, to.y - from.y);
  return {
    p0: { x: from.x, y: from.y },
    p1: { x: from.x + dx * 0.3, y: Math.min(from.y, to.y) - lift },
    p2: { x: from.x + dx * 0.7, y: Math.min(from.y, to.y) - lift * 0.6 },
    p3: { x: to.x, y: to.y },
    facing: dx >= 0 ? 1 : -1,
    seconds: Math.max(1.8, Math.min(5, 1.2 + distance / 260)),
  };
}

/** Punkt und Blickrichtung auf einer Bahn zur Zeit t (0–1): Welle und Drehung aus der Tangente; am Ende abbremsen. */
export function flightPoint(path, t, wave = 0) {
  const eased = t < 0.85 ? t : 0.85 + (1 - Math.pow(1 - (t - 0.85) / 0.15, 2)) * 0.15;
  const here = bezier(path.p0, path.p1, path.p2, path.p3, eased);
  const ahead = bezier(path.p0, path.p1, path.p2, path.p3, Math.min(1, eased + 0.02));
  const angle = Math.atan2(ahead.y - here.y, ahead.x - here.x) * (180 / Math.PI);
  const ripple = Math.sin(t * Math.PI * 6 + wave) * 6 * (1 - t);
  // Nase entlang der Tangente: eine gespiegelte (nach links fliegende) Figur dreht relativ zur linken Achse.
  const relative = ((path.facing >= 0 ? angle : angle - 180) + 540) % 360 - 180;
  return { x: here.x, y: here.y + ripple, rotation: Math.max(-35, Math.min(35, relative)) };
}

export function activeFlights(bats) {
  return bats.filter((bat) => ["takeoff", "flying", "approaching", "landing"].includes(bat.state)).length;
}

/** Aufschrecken (Klick, Nähe, Scrollen): nur aus dem Sitzen/Hängen heraus und nicht während einer Alarmpause. */
export function startle(bat, rng, view, now = 0) {
  if (!["perched", "alert"].includes(bat.state)) return bat;
  return { ...bat, state: "takeoff", timer: TAKEOFF_SECONDS, path: fleePath({ x: bat.x, y: bat.y }, rng, view), flight: 0, target: null, lastFleeAt: now };
}

/** Aufmerksam werden (Kopf, Flügel): kurz, danach wieder Ruhe. */
export function alert(bat, seconds = ALERT_SECONDS, now = 0) {
  if (bat.state !== "perched") return bat;
  return { ...bat, state: "alert", timer: seconds, alertedAt: now };
}

/**
 * Nähe des Zeigers (H9): innerhalb des Alarmradius wird die Fledermaus aufmerksam; erst näher und nur mit begrenzter
 * Wahrscheinlichkeit (Temperament) und Abklingzeiten fliegt sie weg. Liefert die Entscheidung, nicht den Zustand.
 */
export function reactToPointer(bat, pointer, rng, now, lastFleeAt = -Infinity) {
  if (!["perched", "alert"].includes(bat.state)) return "none";
  const spec = TEMPERAMENTS[bat.temperament];
  const distance = Math.hypot(pointer.x - bat.x, pointer.y - (bat.y + bat.size * 0.5));
  if (distance > spec.alertRadius) return "none";
  if (distance <= spec.fleeRadius && now - lastFleeAt >= PROXIMITY_COOLDOWN_MS && now - bat.lastFleeAt >= BAT_COOLDOWN_MS && rng() < spec.fleeChance) return "flee";
  if (bat.state === "alert" || now - (bat.alertedAt ?? -Infinity) < ALERT_COOLDOWN_MS) return "none";
  return "alert";
}

/** Schnelles Scrollen (H9): selten schreckt eine sichtbare Fledermaus auf - mit Abklingzeit und Zufall. */
export function reactToScroll(speed, rng, now, lastScrollStartleAt = -Infinity) {
  if (Math.abs(speed) < SCROLL_STARTLE_SPEED) return false;
  if (now - lastScrollStartleAt < SCROLL_COOLDOWN_MS) return false;
  return rng() < 0.35;
}

/**
 * Einen Schritt weiter. `env`: { view, viewFor(fixed), rng, findPerch(bat) → freier Platz oder null, canFly() → darf
 * ein Flug starten (Anzahl) }. Liefert ein neues Objekt, wenn sich etwas ändert, sonst dasselbe.
 */
export function advanceBat(bat, dt, env) {
  const spec = TEMPERAMENTS[bat.temperament];
  switch (bat.state) {
    case "perched": {
      const timer = bat.timer - dt;
      if (timer > 0) return timer === bat.timer ? bat : { ...bat, timer };
      // Ruhephase vorbei: Roamer und Unruhige suchen einen neuen Platz, alle anderen dösen weiter.
      if (bat.restless && env.canFly?.() !== false) {
        const target = env.findPerch?.(bat) || null;
        if (target) {
          return { ...bat, state: "takeoff", timer: TAKEOFF_SECONDS, target, path: hopPath({ x: bat.x, y: bat.y }, { x: target.x, y: target.y }, env.rng), flight: 0 };
        }
      }
      return { ...bat, timer: between(env.rng, spec.restSeconds) };
    }
    case "alert": {
      const timer = bat.timer - dt;
      if (timer > 0) return { ...bat, timer };
      return { ...bat, state: "perched", timer: Math.max(8, bat.timer + between(env.rng, [10, 40])) };
    }
    case "takeoff": {
      const timer = bat.timer - dt;
      if (timer > 0) return { ...bat, timer };
      return { ...bat, state: bat.target ? "approaching" : "flying", timer: 0, flight: 0 };
    }
    case "flying":
    case "approaching": {
      const flight = Math.min(1, (bat.flight || 0) + dt / bat.path.seconds);
      const point = flightPoint(bat.path, flight, bat.wave);
      const next = { ...bat, flight, x: point.x, y: point.y, rotation: point.rotation, facing: bat.path.facing };
      if (flight < 1) return next;
      if (bat.state === "flying") return { ...next, state: "gone", timer: between(env.rng, spec.awayFor), path: null, rotation: 0 };
      return { ...next, state: "landing", timer: LANDING_SECONDS, rotation: 0, x: bat.target.x, y: bat.target.y, pose: bat.target.pose, size: bat.target.size };
    }
    case "landing": {
      const timer = bat.timer - dt;
      if (timer > 0) return { ...bat, timer };
      const perch = bat.target;
      return { ...bat, state: "settle", timer: SETTLE_SECONDS, perch, pose: perch.pose, fixed: perch.fixed, size: perch.size, x: perch.x, y: perch.y, target: null, path: null };
    }
    case "settle": {
      const timer = bat.timer - dt;
      if (timer > 0) return { ...bat, timer };
      return { ...bat, state: "perched", timer: between(env.rng, spec.restSeconds) };
    }
    case "gone": {
      const timer = bat.timer - dt;
      if (timer > 0) return { ...bat, timer };
      if (env.canFly?.() === false) return { ...bat, timer: 5 };
      const target = env.findPerch?.(bat) || null;
      if (!target) return { ...bat, timer: 10 };
      const path = approachPath({ x: target.x, y: target.y }, env.rng, (env.viewFor && env.viewFor(target.fixed)) || env.view);
      return { ...bat, state: "approaching", timer: 0, target, path, flight: 0, x: path.p0.x, y: path.p0.y, pose: target.pose, fixed: target.fixed, size: target.size, perch: target };
    }
    default:
      return bat;
  }
}
