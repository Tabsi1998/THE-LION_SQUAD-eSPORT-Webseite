// Abseil-Spinne (#663) als reine Zustandsfolge: warten → abseilen bis zum Fußzeilen-Strich → loslassen →
// weglaufen → der Faden schwingt im Wind → der Faden reißt oben ab und fliegt davon → Pause, dann von der
// anderen Seite. Alles in Seitenkoordinaten, damit man nachscrollen kann. Die Anzeige liegt in index.jsx.

export const TOP = 90;
export const RUN_SPEED = 110;
export const RELEASE_SECONDS = 0.7;
export const SWAY_SECONDS = 5.5;
export const DETACH_SECONDS = 3;

export function createRappel(spec) {
  return { phase: "wait", timer: spec.first, side: spec.side, speed: spec.speed, rest: spec.rest, size: spec.size, y: TOP, x: 0, length: 0, runDir: spec.side === "left" ? 1 : -1, cycles: 0 };
}

/**
 * Einen Schritt weiter. `env` bringt die Seite mit: `floorY` (Strich über dem Impressum in Seitenkoordinaten),
 * `width` und `edgeX` (Abstand des Fadens vom Rand). Liefert immer ein neues Objekt.
 */
export function advanceRappel(state, dt, env) {
  const next = { ...state };
  const floor = Math.max(TOP + 120, env.floorY - state.size * 4);
  switch (state.phase) {
    case "wait":
      next.timer -= dt;
      if (next.timer <= 0) {
        next.phase = "descend";
        next.y = TOP;
        next.length = 0;
      }
      break;
    case "descend":
      next.y = Math.min(floor, state.y + state.speed * dt);
      next.length = next.y - TOP;
      if (next.y >= floor) {
        next.phase = "release";
        next.timer = RELEASE_SECONDS;
        next.x = 0;
      }
      break;
    case "release":
      next.timer -= dt;
      if (next.timer <= 0) next.phase = "run";
      break;
    case "run":
      next.x = state.x + state.runDir * RUN_SPEED * dt;
      if (Math.abs(next.x) > env.width + 60) {
        next.phase = "sway";
        next.timer = SWAY_SECONDS;
      }
      break;
    case "sway":
      next.timer -= dt;
      if (next.timer <= 0) {
        next.phase = "detach";
        next.timer = DETACH_SECONDS;
      }
      break;
    case "detach":
      next.timer -= dt;
      if (next.timer <= 0) {
        next.phase = "wait";
        next.timer = state.rest;
        next.side = state.side === "left" ? "right" : "left";
        next.runDir = next.side === "left" ? 1 : -1;
        next.y = TOP;
        next.length = 0;
        next.x = 0;
        next.cycles = state.cycles + 1;
      }
      break;
    default:
      break;
  }
  return next;
}

/** Was gerade zu sehen ist: Faden ja/nein, Spinne am Faden oder laufend. */
export function rappelView(state) {
  const thread = state.phase === "descend" || state.phase === "release" || state.phase === "run" || state.phase === "sway" || state.phase === "detach";
  const spiderOnThread = state.phase === "descend" || state.phase === "release";
  const running = state.phase === "run";
  return { thread, spiderOnThread, running, swaying: state.phase === "sway" || state.phase === "run", detaching: state.phase === "detach" };
}
