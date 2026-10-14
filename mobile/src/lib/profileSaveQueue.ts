// Speicher-Warteschlange für Profil und Einstellungen (#1048, #1061). Dieselbe Logik steht auf der Website
// (frontend/src/lib/profileSaveQueue.js); beide prüfen dieselben Fälle aus frontend/src/lib/profileSaveQueue.cases.json.
//
// Regeln:
// - Höchstens eine Anfrage läuft. Was währenddessen geändert wird, geht gesammelt mit dem nächsten Lauf.
// - Geschickt wird nur, was sich gegenüber dem letzten bestätigten Serverstand geändert hat.
// - Eine Antwort ändert nur Felder, die seit dem Abschicken nicht mehr angefasst wurden - eine ältere Antwort
//   überschreibt nie eine neuere Eingabe. Serverstände von außen (Sitzung neu geladen) mit älterer Revision
//   (updated_at) werden verworfen.
// - „Speichern“ während eines laufenden Autosaves wartet und reiht sich ein; zweimal hintereinander ohne neue
//   Änderung schickt nichts doppelt.
// - Bei einem Fehler bleibt die Eingabe stehen; der Fehler steht im Zustand, bis ein Lauf gelingt (Erneut versuchen).
// - Ein anderes Konto (oder abgemeldet) setzt alles zurück: offene Änderungen sind weg, Antworten aus dem alten
//   Konto werden verworfen, und ohne Konto wird nichts geschickt. Der Server prüft zusätzlich den Header
//   X-Expected-User-Id (siehe EXPECTED_USER_HEADER).

type Data = Record<string, any>;

export const EXPECTED_USER_HEADER = "X-Expected-User-Id";
export const ACCOUNT_CHANGED_MESSAGE = "Du bist inzwischen mit einem anderen Konto angemeldet – die Änderung wurde nicht gespeichert.";

export type SaveResult = { ok: boolean; nothing?: boolean; reason?: "account" | "no-account"; error?: unknown };
export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type SaveState<F extends Data> = {
  account: string | null;
  local: F;
  confirmed: F;
  dirty: boolean;
  busy: boolean;
  status: SaveStatus;
  error: unknown;
};
export type SaveLock = <T>(task: () => Promise<T>) => Promise<T>;

function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.keys(value as Data)
      .sort()
      .reduce<Data>((out, key) => {
        out[key] = normalize((value as Data)[key]);
        return out;
      }, {});
  }
  return value;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function isPlainObject(value: unknown): value is Data {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Felder aus current, die sich gegenüber original unterscheiden (oberste Ebene; Objekte gehen ganz mit). */
export function changedFields(current: Data | null | undefined, original: Data | null | undefined): Data {
  const out: Data = {};
  Object.keys(current || {}).forEach((key) => {
    const value = (current as Data)[key];
    if (value === undefined) return;
    if (!sameValue(value, original ? original[key] : undefined)) out[key] = value;
  });
  return out;
}

function hasKeys(value: Data | null | undefined): boolean {
  return Object.keys(value || {}).length > 0;
}

/**
 * Dreiwege-Abgleich: server ist der neue Stand, base der Stand, auf dem local beruht. Felder, die lokal gegenüber
 * base unverändert sind, kommen vom Server; geänderte bleiben. Verschachtelte Objekte (etwa Benachrichtigungen)
 * werden je Unterschlüssel abgeglichen.
 */
export function rebase<T extends Data>(local: T, base: Data | null | undefined, server: Data | null | undefined): T {
  const out: Data = { ...(server || {}) };
  Object.keys(local || {}).forEach((key) => {
    const mine = local[key];
    const before = base ? base[key] : undefined;
    if (sameValue(mine, before)) return;
    if (isPlainObject(mine) && isPlainObject(out[key])) out[key] = rebase(mine, isPlainObject(before) ? before : {}, out[key]);
    else out[key] = mine;
  });
  return out as T;
}

function compareRevision(a: unknown, b: unknown): number {
  const ta = Date.parse(String(a));
  const tb = Date.parse(String(b));
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Eine Sperre für mehrere Warteschlangen derselben Plattform: Aufgaben laufen nacheinander. */
export function createSerialLock(): SaveLock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(task: () => Promise<T>) => {
    const run = tail.then(task, task);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

const SKIPPED = Symbol("skipped");

export type SaveQueueOptions<F extends Data> = {
  /** Schickt den PATCH und liefert das gespeicherte Konto. */
  send: (payload: Data, ctx: { account: string | null }) => Promise<Data>;
  /** Serverdaten → Formular. */
  fromServer?: (data: Data) => F;
  /** Formular → Daten für Vergleich und PATCH. */
  toPayload?: (form: F) => Data;
  accountOf?: (data: Data) => string | null;
  revisionOf?: (data: Data) => unknown;
  /** Gemeinsame Sperre (createSerialLock), damit auch mehrere Warteschlangen nacheinander schreiben. */
  lock?: SaveLock | null;
  /** Nach jedem gelungenen Lauf. */
  onSaved?: ((data: Data) => void) | null;
};

export type SaveQueue<F extends Data> = {
  load: (data: Data | null | undefined) => void;
  stamp: () => number;
  merge: (patch: Partial<F> | Data, stamp: number) => boolean;
  edit: (change: Partial<F> | Data | ((current: F) => F)) => boolean;
  flush: () => Promise<SaveResult>;
  retry: () => Promise<SaveResult>;
  getState: () => SaveState<F>;
  subscribe: (listener: (state: SaveState<F>) => void) => () => void;
};

type Inflight<F> = { snapshot: F; waiters: Array<(result: SaveResult) => void> };

export function createSaveQueue<F extends Data = Data>({
  send,
  fromServer = (data) => ({ ...(data || {}) }) as F,
  toPayload = (form) => form,
  accountOf = (data) => (data && data.id != null ? String(data.id) : null),
  revisionOf = (data) => (data && data.updated_at != null ? data.updated_at : null),
  lock = null,
  onSaved = null,
}: SaveQueueOptions<F>): SaveQueue<F> {
  let account: string | null = null;
  let confirmed = {} as F;
  let revision: unknown = null;
  let local = {} as F;
  let generation = 0;
  let saves = 0;
  let inflight: Inflight<F> | null = null;
  let nextWaiters: Array<(result: SaveResult) => void> = [];
  let flushWanted = false;
  let error: unknown = null;
  let saved = false;
  const listeners = new Set<(state: SaveState<F>) => void>();
  let state: SaveState<F> | null = null;

  const dirtyPayload = () => changedFields(toPayload(local), toPayload(confirmed));

  function computeState(): SaveState<F> {
    const dirty = hasKeys(dirtyPayload());
    let status: SaveStatus = "idle";
    if (inflight) status = "saving";
    else if (error) status = "error";
    else if (saved && !dirty) status = "saved";
    return { account, local, confirmed, dirty, busy: !!inflight, status, error };
  }

  function emit() {
    const next = computeState();
    state = next;
    listeners.forEach((listener) => listener(next));
  }

  function settle(waiters: Array<(result: SaveResult) => void>, result: SaveResult) {
    waiters.forEach((resolve) => resolve(result));
  }

  function reset(nextAccount: string | null, data: Data | null) {
    generation += 1;
    const dropped = [...(inflight ? inflight.waiters : []), ...nextWaiters];
    inflight = null;
    nextWaiters = [];
    flushWanted = false;
    error = null;
    saved = false;
    account = nextAccount;
    confirmed = data ? fromServer(data) : ({} as F);
    local = confirmed;
    revision = data ? revisionOf(data) : null;
    settle(dropped, { ok: false, reason: "account" });
    emit();
  }

  function fail(err: unknown) {
    const waiters = [...(inflight ? inflight.waiters : []), ...nextWaiters];
    inflight = null;
    nextWaiters = [];
    flushWanted = false;
    error = err || new Error("Speichern fehlgeschlagen.");
    saved = false;
    settle(waiters, { ok: false, error });
    emit();
  }

  function continueAfterSave() {
    if (flushWanted) {
      flushWanted = false;
      const waiters = nextWaiters;
      nextWaiters = [];
      if (hasKeys(dirtyPayload())) {
        start(waiters);
        return;
      }
      settle(waiters, { ok: true, nothing: true });
    }
    emit();
  }

  function start(waiters: Array<(result: SaveResult) => void>) {
    const gen = generation;
    const requestAccount = account;
    const snapshot = local;
    const payload = dirtyPayload();
    inflight = { snapshot, waiters };
    error = null;
    saved = false;
    emit();
    const run = (): Promise<Data | typeof SKIPPED> => (gen === generation ? send(payload, { account: requestAccount }) : Promise.resolve(SKIPPED));
    const pending = lock ? lock(run) : run();
    Promise.resolve(pending).then(
      (data) => {
        if (gen !== generation || data === SKIPPED) return;
        const dataAccount = accountOf(data as Data);
        if (dataAccount != null && dataAccount !== requestAccount) {
          fail(new Error(ACCOUNT_CHANGED_MESSAGE));
          return;
        }
        const serverForm = fromServer(data as Data);
        local = rebase(local, snapshot, serverForm);
        confirmed = serverForm;
        const nextRevision = revisionOf(data as Data);
        if (nextRevision != null) revision = nextRevision;
        saves += 1;
        inflight = null;
        saved = true;
        settle(waiters, { ok: true });
        if (onSaved) onSaved(data as Data);
        continueAfterSave();
      },
      (err) => {
        if (gen !== generation) return;
        fail(err);
      },
    );
  }

  const queue: SaveQueue<F> = {
    load(data) {
      const dataAccount = data ? accountOf(data) : null;
      if (!data || dataAccount !== account) {
        reset(data ? dataAccount : null, data || null);
        return;
      }
      const nextRevision = revisionOf(data);
      if (revision != null && (nextRevision == null || compareRevision(nextRevision, revision) < 0)) return;
      const serverForm = fromServer(data);
      local = rebase(local, confirmed, serverForm);
      confirmed = serverForm;
      if (nextRevision != null) revision = nextRevision;
      emit();
    },
    stamp() {
      return generation * 1000000 + saves;
    },
    merge(patch, stampValue) {
      if (account == null || stampValue !== queue.stamp()) return false;
      const next = { ...confirmed, ...(patch || {}) } as F;
      local = rebase(local, confirmed, next);
      confirmed = next;
      emit();
      return true;
    },
    edit(change) {
      if (account == null) return false;
      local = typeof change === "function" ? change(local) : ({ ...local, ...(change || {}) } as F);
      emit();
      return true;
    },
    flush() {
      if (account == null) return Promise.resolve<SaveResult>({ ok: false, reason: "no-account" });
      return new Promise<SaveResult>((resolve) => {
        if (inflight) {
          if (!hasKeys(changedFields(toPayload(local), toPayload(inflight.snapshot)))) {
            inflight.waiters.push(resolve);
          } else {
            flushWanted = true;
            nextWaiters.push(resolve);
          }
          return;
        }
        if (!hasKeys(dirtyPayload())) {
          resolve({ ok: true, nothing: true });
          return;
        }
        start([resolve]);
      });
    },
    retry() {
      return queue.flush();
    },
    getState() {
      if (!state) state = computeState();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return queue;
}
