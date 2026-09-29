// Erfolge II (E8, #618): die Zeremonie-Warteschlange. Nie zwei Overlays zugleich; Pakete, die kurz
// nacheinander kommen (E6 bündelt schon serverseitig), werden zu einem zusammengelegt; ein Level-up
// hängt sich an das laufende Paket, statt danach ein zweites Fenster zu öffnen. Ein kleiner Store
// ohne Abhängigkeiten, den React über useSyncExternalStore liest.

import { planCeremony } from "./select";

export const BUNDLE_WINDOW_MS = 1500;

export function createCeremonyQueue({ now = () => Date.now(), bundleMs = BUNDLE_WINDOW_MS } = {}) {
  const listeners = new Set();
  const state = { current: null, pending: [], lastEnqueueAt: 0 };

  function emit() {
    for (const listener of listeners) listener();
  }

  function mergeInto(target, pkg) {
    const seen = new Set((target.tiers || []).map((t) => t.code));
    for (const tier of pkg.tiers || []) if (!seen.has(tier.code)) { target.tiers.push(tier); seen.add(tier.code); }
    target.context = { ...(target.context || {}), ...(pkg.context || {}) };
    if (pkg.levelUp) target.levelUp = pkg.levelUp;
    return target;
  }

  function enqueue(pkg) {
    if (!pkg || (!(pkg.tiers || []).length && !pkg.levelUp)) return null;
    const stamp = now();
    const last = state.pending[state.pending.length - 1];
    let entry;
    if (last && stamp - state.lastEnqueueAt <= bundleMs) {
      entry = mergeInto(last, pkg);
    } else if (!last && state.current && pkg.levelUp && !(pkg.tiers || []).length) {
      // Ein Level-up während einer laufenden Zeremonie wird Teil davon (am Ende gezeigt).
      state.current = { ...state.current, levelUp: pkg.levelUp };
      state.lastEnqueueAt = stamp;
      emit();
      return state.current;
    } else {
      entry = { id: pkg.id || `pkg-${stamp}-${Math.random().toString(36).slice(2, 7)}`, tiers: [...(pkg.tiers || [])], context: { ...(pkg.context || {}) }, levelUp: pkg.levelUp || null, onDone: pkg.onDone || null };
      state.pending.push(entry);
    }
    state.lastEnqueueAt = stamp;
    if (!state.current) advance();
    else emit();
    return entry;
  }

  function advance() {
    const finished = state.current;
    state.current = null;
    if (finished?.onDone) { try { finished.onDone(finished); } catch { /* Aufräumen darf nichts anhalten */ } }
    while (state.pending.length) {
      const next = state.pending.shift();
      if (planCeremony(next)) { state.current = next; break; }
      if (next.onDone) { try { next.onDone(next); } catch { /* wie oben */ } }
    }
    emit();
    return state.current;
  }

  function clear() {
    state.pending = [];
    state.current = null;
    emit();
  }

  return {
    enqueue,
    advance,
    clear,
    getCurrent: () => state.current,
    getPendingCount: () => state.pending.length,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export const ceremonyQueue = createCeremonyQueue();

// Bequeme Einstiege für Seiten: Stufen aus /achievements/me (frisch) oder ein Level-up.
export function enqueueCeremony(tiers, context = {}, extra = {}) {
  return ceremonyQueue.enqueue({ tiers, context, ...extra });
}

export function enqueueLevelUp(levelUp, extra = {}) {
  return ceremonyQueue.enqueue({ tiers: [], levelUp, ...extra });
}
