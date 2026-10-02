import { AppState, type AppStateStatus } from "react-native";

// Bewegungsbudget in der App (A3, #717 - wie H11 im Web, frontend/src/seasons/motion.js): ein Planer für die
// großen Bewegungen der Saison. Er begrenzt, was gleichzeitig läuft (Plätze), hält Abstand zwischen zwei Starts,
// kennt je Effektklasse eine Abklingzeit, wartet nach dem Start erst einmal ab, schläft im App-Hintergrund und
// holt beim Zurückkehren nichts nach. Antippen der Person bekommt seinen Platz immer, belegt ihn aber.

export const DEFAULT_SLOTS = 2;
export const INITIAL_DELAY_MS = 4000;
export const MIN_GAP_MS = 2500;
export const RESUME_GRACE_MS = 1500;

export type EffectKind = "flock" | "bat_flight" | "bat_scare" | "rappel" | "crawler" | "ghost" | "web_spider" | "drop_spider" | "lightning";
export type EffectSpec = { slots: number; cooldownMs: number; priority: number; ttlMs: number; user?: boolean };

export const EFFECTS: Record<EffectKind, EffectSpec> = {
  flock: { slots: 1, cooldownMs: 45000, priority: 2, ttlMs: 14000 },
  bat_flight: { slots: 1, cooldownMs: 6000, priority: 3, ttlMs: 5000 },
  bat_scare: { slots: 1, cooldownMs: 0, priority: 5, ttlMs: 4000, user: true },
  rappel: { slots: 1, cooldownMs: 30000, priority: 2, ttlMs: 60000 },
  crawler: { slots: 1, cooldownMs: 60000, priority: 1, ttlMs: 30000 },
  ghost: { slots: 1, cooldownMs: 0, priority: 4, ttlMs: 9000, user: true },
  web_spider: { slots: 0, cooldownMs: 25000, priority: 1, ttlMs: 8000 },
  drop_spider: { slots: 1, cooldownMs: 20000, priority: 1, ttlMs: 12000 },
  // Wetterleuchten (#771) wie im Web: belegt keinen Platz, aber nie zwei Blitze binnen acht Sekunden.
  lightning: { slots: 0, cooldownMs: 8000, priority: 1, ttlMs: 600 },
};

export type MotionToken = { id: number; kind: EffectKind; cost: number; startedAt: number; until: number };
export type MotionReason = "hidden" | "warmup" | "resume" | "cooldown" | "gap" | "busy" | null;
export type MotionSnapshot = { used: number; slots: number; active: EffectKind[]; hidden: boolean; armed: boolean };
export type MotionScheduler = {
  request: (kind: EffectKind, options?: { force?: boolean; at?: number }) => MotionToken | null;
  release: (token: MotionToken | null | undefined, at?: number) => void;
  lastReason: () => MotionReason;
  snapshot: (at?: number) => MotionSnapshot;
  setHidden: (hidden: boolean, at?: number) => void;
  /** Ein Dialog oder Sheet ist offen: keine großen Bewegungen, solange es offen ist. */
  setBlocked: (blocked: boolean) => void;
  canRun: (kind: EffectKind, at?: number) => boolean;
  subscribe: (listener: (snapshot: MotionSnapshot) => void) => () => void;
  reset: (at?: number) => void;
  dispose: () => void;
};

type Options = { now?: () => number; slots?: number; initialDelayMs?: number; minGapMs?: number; unlimited?: boolean; appState?: Pick<typeof AppState, "currentState" | "addEventListener"> | null };

export function createMotionScheduler({ now = () => Date.now(), slots = DEFAULT_SLOTS, initialDelayMs = INITIAL_DELAY_MS, minGapMs = MIN_GAP_MS, unlimited = false, appState = AppState }: Options = {}): MotionScheduler {
  const startedAt = now();
  const state = {
    slots,
    armedAt: startedAt + initialDelayMs,
    lastStartAt: 0,
    lastByKind: {} as Partial<Record<EffectKind, number>>,
    active: new Map<number, MotionToken>(),
    nextId: 1,
    hidden: Boolean(appState && appState.currentState && appState.currentState !== "active"),
    blocked: false,
    resumeAt: 0,
    lastReason: null as MotionReason,
  };
  const listeners = new Set<(snapshot: MotionSnapshot) => void>();

  function sweep(at: number) {
    for (const [id, token] of state.active) if (token.until <= at) state.active.delete(id);
  }

  function used(at: number): number {
    sweep(at);
    let sum = 0;
    for (const token of state.active.values()) sum += token.cost;
    return sum;
  }

  function snapshot(at = now()): MotionSnapshot {
    return { used: used(at), slots: state.slots, active: [...state.active.values()].map((token) => token.kind), hidden: state.hidden, armed: at >= state.armedAt };
  }

  function emit() {
    const current = snapshot();
    listeners.forEach((listener) => listener(current));
  }

  function reason(kind: EffectKind, at: number, force = false): MotionReason {
    const spec = EFFECTS[kind] || { slots: 1, cooldownMs: 0, priority: 1, ttlMs: 5000 };
    if (state.hidden || state.blocked) return "hidden";
    if (unlimited) return null;
    if (!force && at < state.armedAt) return "warmup";
    if (!force && at < state.resumeAt) return "resume";
    const last = state.lastByKind[kind];
    if (spec.cooldownMs && last !== undefined && at - last < spec.cooldownMs) return "cooldown";
    if (!force && spec.slots > 0 && at - state.lastStartAt < minGapMs) return "gap";
    if (spec.slots > 0 && used(at) + spec.slots > state.slots && !force) return "busy";
    return null;
  }

  function request(kind: EffectKind, { force = false, at = now() }: { force?: boolean; at?: number } = {}): MotionToken | null {
    const spec = EFFECTS[kind] || { slots: 1, cooldownMs: 0, priority: 1, ttlMs: 5000 };
    const why = reason(kind, at, force || Boolean(spec.user));
    state.lastReason = why;
    if (why && !(force || spec.user)) return null;
    if (why === "hidden") return null;
    if (why === "cooldown" && !force) return null;
    const token: MotionToken = { id: state.nextId++, kind, cost: spec.slots, startedAt: at, until: at + spec.ttlMs };
    state.active.set(token.id, token);
    state.lastByKind[kind] = at;
    if (spec.slots > 0) state.lastStartAt = at;
    emit();
    return token;
  }

  function release(token: MotionToken | null | undefined, at = now()) {
    if (!token) return;
    state.active.delete(token.id);
    sweep(at);
    emit();
  }

  function setHidden(hidden: boolean, at = now()) {
    if (hidden === state.hidden) return;
    state.hidden = hidden;
    if (!hidden) state.resumeAt = at + RESUME_GRACE_MS;
    emit();
  }

  const subscription = appState && typeof appState.addEventListener === "function"
    ? appState.addEventListener("change", (status: AppStateStatus) => setHidden(status !== "active"))
    : null;

  return {
    request,
    release,
    lastReason: () => state.lastReason,
    snapshot,
    setHidden,
    setBlocked(blocked) {
      if (blocked === state.blocked) return;
      state.blocked = blocked;
      emit();
    },
    canRun: (kind, at = now()) => reason(kind, at) === null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset(at = now()) {
      state.active.clear();
      state.lastByKind = {};
      state.lastStartAt = 0;
      state.armedAt = at + initialDelayMs;
      state.resumeAt = 0;
      emit();
    },
    dispose() {
      subscription?.remove?.();
      listeners.clear();
    },
  };
}

let shared: MotionScheduler | null = null;

/** Der eine Planer der Bühne. */
export function getMotionScheduler(): MotionScheduler {
  if (!shared) shared = createMotionScheduler();
  return shared;
}

export function resetMotionScheduler(next: MotionScheduler | null = null) {
  shared?.dispose();
  shared = next;
}

export function requestMotion(kind: EffectKind, options?: { force?: boolean; at?: number }): MotionToken | null {
  return getMotionScheduler().request(kind, options);
}

export function releaseMotion(token: MotionToken | null | undefined) {
  getMotionScheduler().release(token);
}
