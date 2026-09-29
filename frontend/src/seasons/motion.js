// Bewegungsbudget (H11, #699): ein Planer für die großen Bewegungen der Saison. Er begrenzt, was gleichzeitig
// läuft (Plätze), hält Abstand zwischen zwei Starts, kennt je Effektklasse eine Abklingzeit, wartet nach dem
// Laden erst einmal ab, schläft bei verstecktem Tab und holt beim Zurückkehren nichts nach. Kleine
// Dauerbewegungen (Netz im Wind, Pupillen) zählen nicht; Klicks der Person bekommen ihren Platz immer,
// belegen ihn aber. Jumpscares haben ihre eigenen, strengeren Regeln (#680) und fragen hier zusätzlich.

export const DEFAULT_SLOTS = 2;
export const INITIAL_DELAY_MS = 4000;
export const MIN_GAP_MS = 2500;
export const RESUME_GRACE_MS = 1500;

// Klasse → Kosten in Plätzen, Abklingzeit, Priorität (höher gewinnt bei knappen Plätzen).
export const EFFECTS = {
  flock: { slots: 1, cooldownMs: 45000, priority: 2, ttlMs: 14000 },
  bat_flight: { slots: 1, cooldownMs: 6000, priority: 3, ttlMs: 5000 },
  bat_scare: { slots: 1, cooldownMs: 0, priority: 5, ttlMs: 4000, user: true },
  rappel: { slots: 1, cooldownMs: 30000, priority: 2, ttlMs: 60000 },
  crawler: { slots: 1, cooldownMs: 60000, priority: 1, ttlMs: 30000 },
  wisp: { slots: 0, cooldownMs: 90000, priority: 1, ttlMs: 30000 },
  ghost: { slots: 1, cooldownMs: 0, priority: 4, ttlMs: 9000, user: true },
  web_tear: { slots: 1, cooldownMs: 0, priority: 4, ttlMs: 8000, user: true },
  web_spider: { slots: 0, cooldownMs: 25000, priority: 1, ttlMs: 8000 },
  eyes: { slots: 0, cooldownMs: 120000, priority: 1, ttlMs: 9000 },
  rare_edge: { slots: 1, cooldownMs: 240000, priority: 1, ttlMs: 3000 },
  jumpscare: { slots: 2, cooldownMs: 0, priority: 6, ttlMs: 3000 },
};

export function createMotionScheduler({ now = () => Date.now(), slots = DEFAULT_SLOTS, initialDelayMs = INITIAL_DELAY_MS, minGapMs = MIN_GAP_MS, doc = typeof document === "undefined" ? null : document, unlimited = false } = {}) {
  const startedAt = now();
  const state = { slots, armedAt: startedAt + initialDelayMs, lastStartAt: 0, lastByKind: {}, active: new Map(), nextId: 1, hidden: Boolean(doc && doc.hidden), resumeAt: 0 };
  const listeners = new Set();

  function emit() {
    for (const listener of listeners) listener(snapshot());
  }

  function sweep(at) {
    for (const [id, token] of state.active) if (token.until <= at) state.active.delete(id);
  }

  function used(at) {
    sweep(at);
    let sum = 0;
    for (const token of state.active.values()) sum += token.cost;
    return sum;
  }

  function reason(kind, at, { force = false } = {}) {
    const spec = EFFECTS[kind] || { slots: 1, cooldownMs: 0, priority: 1, ttlMs: 5000 };
    if (state.hidden) return "hidden";
    if (unlimited) return null;  // Testschalter: alles darf, Belegung wird trotzdem gezählt
    if (!force && at < state.armedAt) return "warmup";
    if (!force && at < state.resumeAt) return "resume";
    const last = state.lastByKind[kind] || 0;
    if (spec.cooldownMs && at - last < spec.cooldownMs) return "cooldown";
    if (!force && spec.slots > 0 && at - state.lastStartAt < minGapMs) return "gap";
    if (spec.slots > 0 && used(at) + spec.slots > state.slots && !force) return "busy";
    return null;
  }

  /** Einen Platz anfragen: Token oder null (mit `lastReason`, warum nicht). `force` = von der Person ausgelöst. */
  function request(kind, { force = false, at = now() } = {}) {
    const spec = EFFECTS[kind] || { slots: 1, cooldownMs: 0, priority: 1, ttlMs: 5000 };
    const why = reason(kind, at, { force: force || Boolean(spec.user) });
    state.lastReason = why;
    if (why && !(force || spec.user) ) return null;
    if (why === "hidden") return null;
    if (why === "cooldown" && !force) return null;
    const token = { id: state.nextId++, kind, cost: spec.slots, startedAt: at, until: at + spec.ttlMs };
    state.active.set(token.id, token);
    state.lastByKind[kind] = at;
    if (spec.slots > 0) state.lastStartAt = at;
    emit();
    return token;
  }

  function release(token, at = now()) {
    if (!token) return;
    state.active.delete(token.id);
    sweep(at);
    emit();
  }

  /** Warum die letzte Anfrage abgelehnt wurde (Tests, Anzeige). */
  function lastReason() {
    return state.lastReason || null;
  }

  function setHidden(hidden, at = now()) {
    if (hidden === state.hidden) return;
    state.hidden = hidden;
    if (!hidden) state.resumeAt = at + RESUME_GRACE_MS;
    emit();
  }

  function snapshot(at = now()) {
    return { used: used(at), slots: state.slots, active: [...state.active.values()].map((t) => t.kind), hidden: state.hidden, armed: at >= state.armedAt };
  }

  const onVisibility = () => setHidden(Boolean(doc && doc.hidden));
  doc?.addEventListener?.("visibilitychange", onVisibility);

  return {
    request,
    release,
    lastReason,
    snapshot,
    setHidden,
    canRun: (kind, at = now()) => reason(kind, at) === null,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reset(at = now()) { state.active.clear(); state.lastByKind = {}; state.lastStartAt = 0; state.armedAt = at + initialDelayMs; state.resumeAt = 0; emit(); },
    dispose() { doc?.removeEventListener?.("visibilitychange", onVisibility); listeners.clear(); },
  };
}

let shared = null;

/** Der eine Planer der Bühne. */
export function getMotionScheduler() {
  if (!shared) shared = createMotionScheduler();
  return shared;
}

export function resetMotionScheduler(next = null) {
  shared?.dispose?.();
  shared = next;
}

/** Kurzform für Effekte: fragt den gemeinsamen Planer. */
export function requestMotion(kind, options) {
  return getMotionScheduler().request(kind, options);
}

export function releaseMotion(token) {
  getMotionScheduler().release(token);
}
