// Abseil-Spinne in der App (#665, wie #663 im Web) als reine Zustandsfolge: warten → abseilen vom oberen Rand
// bis über die Tab-Leiste → loslassen → seitlich weglaufen → der Faden schwingt → reißt oben ab und fliegt
// davon → Pause, dann von der anderen Seite. Die Anzeige liegt in halloween.tsx.

export const TOP = 0;
export const RUN_SPEED = 110;
export const RELEASE_SECONDS = 0.7;
export const SWAY_SECONDS = 3.5;
export const DETACH_SECONDS = 2.2;

export type RappelSpec = { side: "left" | "right"; size: number; speed: number; first: number; rest: number };
export type RappelPhase = "wait" | "descend" | "release" | "run" | "sway" | "detach";
export type RappelState = { phase: RappelPhase; timer: number; side: "left" | "right"; speed: number; rest: number; size: number; y: number; x: number; length: number; runDir: 1 | -1; cycles: number };
export type RappelEnv = { floorY: number; width: number };

export function createRappel(spec: RappelSpec): RappelState {
  return { phase: "wait", timer: spec.first, side: spec.side, speed: spec.speed, rest: spec.rest, size: spec.size, y: TOP, x: 0, length: 0, runDir: spec.side === "left" ? 1 : -1, cycles: 0 };
}

export function advanceRappel(state: RappelState, dt: number, env: RappelEnv): RappelState {
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

export function rappelView(state: { phase: RappelPhase }) {
  const thread = state.phase === "descend" || state.phase === "release" || state.phase === "run" || state.phase === "sway" || state.phase === "detach";
  return {
    thread,
    spiderOnThread: state.phase === "descend" || state.phase === "release",
    running: state.phase === "run",
    swaying: state.phase === "sway" || state.phase === "run",
    detaching: state.phase === "detach",
  };
}
