// Momente am TV (#1110, #1116, #1118, #1119): Immer nur ein Moment gleichzeitig. Champion und Ergebnis gehen vor, der
// Zoom beim Start eines Spiels kommt danach, Sponsor- und Zahlen-Momente (Meilenstein 60, #1124, #1125) warten, bis
// nichts Wichtigeres ansteht. Kommt ein Ergebnis, während ein Sponsor oder die Zahlen stehen, macht der leise Moment
// Platz und kommt danach noch einmal ganz. Die neue Bestzeit am Fast-Lap-TV (#1127) zählt wie ein Ergebnis. Mehr als drei
// Ergebnisse auf einmal werden eine Sammelkarte. Ein kleiner Speicher ohne Abhängigkeiten, den React über
// useSyncExternalStore liest - wie die Zeremonie-Warteschlange der Erfolge.

export const MOMENT_PRIORITY = Object.freeze({ champion: 30, result: 20, best: 20, live: 10, sponsor: 5, stats: 5 });
// Leise Momente: sie weichen, sobald etwas Wichtigeres kommt.
export const YIELDING_MOMENTS = Object.freeze(new Set(["sponsor", "stats"]));
// Wie lange ein Moment höchstens warten darf, bevor er nichts mehr bedeutet (ein Zoom auf ein Spiel, das schon eine
// Weile läuft). Ohne Eintrag wartet er, bis er dran ist.
export const MOMENT_MAX_WAIT_MS = Object.freeze({ live: 15000 });
export const COLLECT_AFTER = 3;
// Wie lange die Karten stehen: ein Ergebnis etwa 3 Sekunden, die Sammelkarte etwas länger, der Start-Zoom etwa 4, die
// neue Bestzeit etwa 3. Sponsor und Zahlen bringen ihre Dauer selbst mit (aus der Wiedergabeliste).
export const MOMENT_MS = Object.freeze({ result: 3000, collective: 4500, live: 4000, championCard: 4400, best: 3200, sponsor: 6000, stats: 8000 });

export function createMomentQueue({ now = () => Date.now() } = {}) {
  const listeners = new Set();
  let current = null;
  let pending = [];
  let sequence = 0;
  let version = 0;

  function emit() {
    version += 1;
    for (const listener of listeners) listener();
  }

  function priorityOf(type) {
    return MOMENT_PRIORITY[type] ?? 0;
  }

  /** Mehr als drei wartende Ergebnisse werden eine Sammelkarte - in der Reihenfolge, in der sie kamen. */
  function collectResults() {
    const results = pending.filter((entry) => entry.type === "result");
    const count = results.reduce((sum, entry) => sum + entry.items.length, 0);
    if (count <= COLLECT_AFTER || results.length < 2) return;
    const merged = { ...results[0], items: results.flatMap((entry) => entry.items) };
    pending = [merged, ...pending.filter((entry) => entry.type !== "result")];
  }

  function enqueue(moment) {
    if (!moment?.type) return null;
    const stamp = now();
    if (moment.type === "live") {
      // Starten weitere Spiele, solange der Zoom noch wartet: ein Zoom für alle.
      const waiting = pending.find((entry) => entry.type === "live");
      if (waiting) {
        waiting.matchIds = [...new Set([...(waiting.matchIds || []), ...(moment.matchIds || [])])];
        emit();
        return waiting;
      }
    }
    sequence += 1;
    const entry = { ...moment, id: moment.id || `${moment.type}-${sequence}`, priority: priorityOf(moment.type), at: stamp, seq: sequence };
    if (entry.type === "result") entry.items = [...(moment.items || [])];
    pending.push(entry);
    if (entry.type === "result") collectResults();
    // Ein Sponsor oder die Zahlen stehen gerade, und es kommt etwas Wichtigeres: der leise Moment macht Platz und wartet -
    // danach kommt er noch einmal ganz.
    if (current && YIELDING_MOMENTS.has(current.type) && entry.priority > current.priority) {
      pending.push({ ...current, yielded: (current.yielded || 0) + 1 });
      current = null;
    }
    emit();
    return entry;
  }

  /** Der Moment, der jetzt dran ist: der laufende, sonst der wichtigste wartende (bei Gleichstand der älteste). */
  function next() {
    if (current) return current;
    const stamp = now();
    pending = pending.filter((entry) => {
      const maxWait = MOMENT_MAX_WAIT_MS[entry.type];
      return !maxWait || stamp - entry.at <= maxWait;
    });
    if (!pending.length) return null;
    const best = pending.reduce((winner, entry) => (entry.priority > winner.priority || (entry.priority === winner.priority && entry.seq < winner.seq) ? entry : winner));
    pending = pending.filter((entry) => entry !== best);
    current = best;
    emit();
    return current;
  }

  function finish(id) {
    if (!current || (id && current.id !== id)) return false;
    current = null;
    emit();
    return true;
  }

  /** Wartende Momente entfernen, auf die `test` zutrifft (z. B. ein Zoom auf ein Spiel, das nicht mehr läuft). */
  function drop(test) {
    const before = pending.length;
    pending = pending.filter((entry) => !test(entry));
    if (pending.length !== before) emit();
  }

  function clear() {
    current = null;
    pending = [];
    emit();
  }

  return {
    enqueue,
    next,
    finish,
    drop,
    clear,
    getCurrent: () => current,
    getPending: () => [...pending],
    getVersion: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
