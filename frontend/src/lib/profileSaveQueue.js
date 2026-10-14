// Speicher-Warteschlange für Profil und Einstellungen (#1048, #1061). Dieselbe Logik steht in der App
// (mobile/src/lib/profileSaveQueue.ts); beide prüfen dieselben Fälle aus profileSaveQueue.cases.json.
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

export const EXPECTED_USER_HEADER = "X-Expected-User-Id";
export const ACCOUNT_CHANGED_MESSAGE = "Du bist inzwischen mit einem anderen Konto angemeldet – die Änderung wurde nicht gespeichert.";

function normalize(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        out[key] = normalize(value[key]);
        return out;
      }, {});
  }
  return value;
}

export function sameValue(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Felder aus current, die sich gegenüber original unterscheiden (oberste Ebene; Objekte gehen ganz mit). */
export function changedFields(current, original) {
  const out = {};
  Object.keys(current || {}).forEach((key) => {
    const value = current[key];
    if (value === undefined) return;
    if (!sameValue(value, original ? original[key] : undefined)) out[key] = value;
  });
  return out;
}

function hasKeys(value) {
  return Object.keys(value || {}).length > 0;
}

/**
 * Dreiwege-Abgleich: server ist der neue Stand, base der Stand, auf dem local beruht. Felder, die lokal gegenüber
 * base unverändert sind, kommen vom Server; geänderte bleiben. Verschachtelte Objekte (etwa Benachrichtigungen)
 * werden je Unterschlüssel abgeglichen.
 */
export function rebase(local, base, server) {
  const out = { ...(server || {}) };
  Object.keys(local || {}).forEach((key) => {
    const mine = local[key];
    const before = base ? base[key] : undefined;
    if (sameValue(mine, before)) return;
    if (isPlainObject(mine) && isPlainObject(out[key])) out[key] = rebase(mine, isPlainObject(before) ? before : {}, out[key]);
    else out[key] = mine;
  });
  return out;
}

function compareRevision(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Eine Sperre für mehrere Warteschlangen derselben Plattform: Aufgaben laufen nacheinander. */
export function createSerialLock() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

const SKIPPED = Symbol("skipped");

/**
 * @param {object} options
 * @param {(payload: object, ctx: { account: string }) => Promise<object>} options.send schickt den PATCH, liefert das Konto
 * @param {(data: object) => object} [options.fromServer] Serverdaten → Formular
 * @param {(form: object) => object} [options.toPayload] Formular → Daten für Vergleich und PATCH
 * @param {(data: object) => string|null} [options.accountOf]
 * @param {(data: object) => string|null} [options.revisionOf]
 * @param {(task: () => Promise<any>) => Promise<any>} [options.lock] gemeinsame Sperre (createSerialLock)
 * @param {(data: object) => void} [options.onSaved] nach jedem gelungenen Lauf
 */
export function createSaveQueue({
  send,
  fromServer = (data) => ({ ...(data || {}) }),
  toPayload = (form) => form,
  accountOf = (data) => (data && data.id != null ? String(data.id) : null),
  revisionOf = (data) => (data && data.updated_at != null ? data.updated_at : null),
  lock = null,
  onSaved = null,
}) {
  let account = null;
  let confirmed = {};
  let revision = null;
  let local = {};
  let generation = 0;
  let saves = 0;
  let inflight = null;
  let nextWaiters = [];
  let flushWanted = false;
  let error = null;
  let saved = false;
  const listeners = new Set();
  let state = null;

  const dirtyPayload = () => changedFields(toPayload(local), toPayload(confirmed));

  function computeState() {
    const dirty = hasKeys(dirtyPayload());
    let status = "idle";
    if (inflight) status = "saving";
    else if (error) status = "error";
    else if (saved && !dirty) status = "saved";
    return { account, local, confirmed, dirty, busy: !!inflight, status, error };
  }

  function emit() {
    state = computeState();
    listeners.forEach((listener) => listener(state));
  }

  function settle(waiters, result) {
    waiters.forEach((resolve) => resolve(result));
  }

  function reset(nextAccount, data) {
    generation += 1;
    const dropped = [...(inflight ? inflight.waiters : []), ...nextWaiters];
    inflight = null;
    nextWaiters = [];
    flushWanted = false;
    error = null;
    saved = false;
    account = nextAccount;
    confirmed = data ? fromServer(data) : {};
    local = confirmed;
    revision = data ? revisionOf(data) : null;
    settle(dropped, { ok: false, reason: "account" });
    emit();
  }

  function start(waiters) {
    const gen = generation;
    const requestAccount = account;
    const snapshot = local;
    const payload = dirtyPayload();
    inflight = { snapshot, waiters };
    error = null;
    saved = false;
    emit();
    const run = () => (gen === generation ? send(payload, { account: requestAccount }) : Promise.resolve(SKIPPED));
    const pending = lock ? lock(run) : run();
    Promise.resolve(pending).then(
      (data) => {
        if (gen !== generation || data === SKIPPED) return;
        const dataAccount = accountOf(data);
        if (dataAccount != null && dataAccount !== requestAccount) {
          fail(new Error(ACCOUNT_CHANGED_MESSAGE));
          return;
        }
        const serverForm = fromServer(data);
        local = rebase(local, snapshot, serverForm);
        confirmed = serverForm;
        const nextRevision = revisionOf(data);
        if (nextRevision != null) revision = nextRevision;
        saves += 1;
        inflight = null;
        saved = true;
        settle(waiters, { ok: true });
        if (onSaved) onSaved(data);
        continueAfterSave();
      },
      (err) => {
        if (gen !== generation) return;
        fail(err);
      },
    );
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

  function fail(err) {
    const waiters = [...(inflight ? inflight.waiters : []), ...nextWaiters];
    inflight = null;
    nextWaiters = [];
    flushWanted = false;
    error = err || new Error("Speichern fehlgeschlagen.");
    saved = false;
    settle(waiters, { ok: false, error });
    emit();
  }

  const queue = {
    /** Serverstand (Konto) von außen - ein anderes Konto oder null setzt alles zurück. */
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
    /** Merkt den Stand vor einer eigenen Leseanfrage (für merge). */
    stamp() {
      return generation * 1000000 + saves;
    },
    /** Teilstand vom Server (etwa Benachrichtigungen); verworfen, wenn seit dem Stempel gespeichert wurde. */
    merge(patch, stampValue) {
      if (account == null || stampValue !== queue.stamp()) return false;
      const next = { ...confirmed, ...(patch || {}) };
      local = rebase(local, confirmed, next);
      confirmed = next;
      emit();
      return true;
    },
    /** Lokale Änderung: Objekt wird eingemischt, eine Funktion bekommt den Stand und liefert den neuen. */
    edit(change) {
      if (account == null) return false;
      local = typeof change === "function" ? change(local) : { ...local, ...(change || {}) };
      emit();
      return true;
    },
    /** Speichern: schickt sofort oder reiht sich hinter den laufenden Lauf. */
    flush() {
      if (account == null) return Promise.resolve({ ok: false, reason: "no-account" });
      return new Promise((resolve) => {
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
      return () => listeners.delete(listener);
    },
  };
  return queue;
}
