import { type CeremonyContext, type CeremonyPackage, type CeremonyTier, type LevelUp, planCeremony } from "./select";

// Erfolge II (E13, #623): die Zeremonie-Warteschlange der App - wie im Web (queue.js). Nie zwei Fenster
// zugleich; Pakete, die kurz nacheinander kommen, werden zu einem zusammengelegt; ein Level-up hängt sich an
// das laufende Paket, statt danach ein zweites Fenster zu öffnen. Ein kleiner Store ohne Abhängigkeiten,
// den React über useSyncExternalStore liest.

export const BUNDLE_WINDOW_MS = 1500;

export type QueueEntry = { id: string; tiers: CeremonyTier[]; context: CeremonyContext; levelUp: LevelUp | null; onDone?: ((entry: QueueEntry) => void) | null };
type EnqueueInput = CeremonyPackage & { onDone?: ((entry: QueueEntry) => void) | null };

export function createCeremonyQueue({ now = () => Date.now(), bundleMs = BUNDLE_WINDOW_MS }: { now?: () => number; bundleMs?: number } = {}) {
  const listeners = new Set<() => void>();
  const state: { current: QueueEntry | null; pending: QueueEntry[]; lastEnqueueAt: number } = { current: null, pending: [], lastEnqueueAt: 0 };

  function emit() {
    for (const listener of listeners) listener();
  }

  function mergeInto(target: QueueEntry, pkg: EnqueueInput): QueueEntry {
    const seen = new Set(target.tiers.map((t) => t.code));
    for (const tier of pkg.tiers || []) {
      if (!seen.has(tier.code)) {
        target.tiers.push(tier);
        seen.add(tier.code);
      }
    }
    target.context = { ...target.context, ...(pkg.context || {}) };
    if (pkg.levelUp) target.levelUp = pkg.levelUp;
    return target;
  }

  function advance(): QueueEntry | null {
    const finished = state.current;
    state.current = null;
    if (finished?.onDone) {
      try { finished.onDone(finished); } catch { /* Aufräumen darf nichts anhalten */ }
    }
    while (state.pending.length) {
      const next = state.pending.shift() as QueueEntry;
      if (planCeremony(next)) {
        state.current = next;
        break;
      }
      if (next.onDone) {
        try { next.onDone(next); } catch { /* wie oben */ }
      }
    }
    emit();
    return state.current;
  }

  function enqueue(pkg?: EnqueueInput | null): QueueEntry | null {
    if (!pkg || (!(pkg.tiers || []).length && !pkg.levelUp)) return null;
    const stamp = now();
    const last = state.pending[state.pending.length - 1];
    let entry: QueueEntry;
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
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type CeremonyQueue = ReturnType<typeof createCeremonyQueue>;

export const ceremonyQueue = createCeremonyQueue();

/** Bequeme Einstiege: Stufen (frisch aus /achievements/me) oder ein Level-up. */
export function enqueueCeremony(tiers: CeremonyTier[], context: CeremonyContext = {}, extra: Partial<EnqueueInput> = {}) {
  return ceremonyQueue.enqueue({ tiers, context, ...extra });
}

export function enqueueLevelUp(levelUp: LevelUp, extra: Partial<EnqueueInput> = {}) {
  return ceremonyQueue.enqueue({ tiers: [], levelUp, ...extra });
}
