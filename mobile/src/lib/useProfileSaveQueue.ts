import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { createSaveQueue, createSerialLock, EXPECTED_USER_HEADER, type SaveQueue, type SaveResult, type SaveState } from "./profileSaveQueue";

// Speicher-Warteschlange in der App (#1061): Einstellungen und „Profil bearbeiten“ schreiben über dieselbe Sperre auf
// /users/me - es läuft nie mehr als ein PATCH, auch wenn beide Seiten offen sind (die Einstellungen liegen im Stapel
// unter „Profil bearbeiten“). Die Regeln stehen in profileSaveQueue.ts.

type Data = Record<string, any>;

/** Eine Sperre für die ganze App. */
export const profileWriteLock = createSerialLock();

export const AUTOSAVE_DELAY_MS = 700;

export type ProfileSaveQueue<F extends Data> = {
  queue: SaveQueue<F>;
  state: SaveState<F>;
  form: F;
  /** Wie setState: eine Funktion bekommt den Stand, ein Objekt ersetzt ihn. */
  setForm: (action: F | ((current: F) => F)) => void;
  edit: (patch: Partial<F>) => void;
  /** Autosave: speichert 0,7 s nach dem letzten Aufruf. */
  schedule: () => void;
  /** Sofort speichern - ein wartender Autosave geht im selben Lauf mit. */
  save: () => Promise<SaveResult>;
  cancel: () => void;
  /** Ein Autosave wartet auf seinen Zeitpunkt. */
  pending: boolean;
};

export function useProfileSaveQueue<F extends Data>({
  user,
  fromServer,
  toPayload,
  onSaved,
  delayMs = AUTOSAVE_DELAY_MS,
}: {
  user: Data | null | undefined;
  fromServer: (data: Data) => F;
  toPayload?: (form: F) => Data;
  onSaved?: (data: Data) => void;
  delayMs?: number;
}): ProfileSaveQueue<F> {
  const fromServerRef = useRef(fromServer);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    fromServerRef.current = fromServer;
    onSavedRef.current = onSaved;
  });
  const [queue] = useState(() => {
    const created = createSaveQueue<F>({
      send: (payload, { account }) => api
        .patch<Data>("/users/me", payload, { headers: { [EXPECTED_USER_HEADER]: account ?? "" } })
        .then(({ data }) => data),
      fromServer: (data) => fromServerRef.current(data),
      toPayload,
      lock: profileWriteLock,
      onSaved: (data) => onSavedRef.current?.(data),
    });
    if (user) created.load(user);
    return created;
  });
  const [state, setState] = useState<SaveState<F>>(() => queue.getState());
  useEffect(() => queue.subscribe(setState), [queue]);
  useEffect(() => {
    queue.load(user ?? null);
  }, [queue, user]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState(false);
  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      setPending(false);
    }
  }, []);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setPending(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPending(false);
      void queue.flush();
    }, delayMs);
  }, [delayMs, queue]);
  const save = useCallback(() => {
    cancel();
    return queue.flush();
  }, [cancel, queue]);

  // Ein anderes Konto: der wartende Autosave des alten fällt weg (die Warteschlange hat schon zurückgesetzt).
  const account = user?.id ?? null;
  useEffect(() => {
    cancel();
  }, [account, cancel]);

  // Seite verlassen: ein wartender Autosave geht sofort - ins Konto, für das er gedacht war (der Server prüft das).
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void queue.flush();
    }
  }, [queue]);

  const setForm = useCallback((action: F | ((current: F) => F)) => {
    queue.edit(typeof action === "function" ? (action as (current: F) => F) : () => action);
  }, [queue]);
  const edit = useCallback((patch: Partial<F>) => {
    queue.edit(patch);
  }, [queue]);

  return { queue, state, form: state.local, setForm, edit, schedule, save, cancel, pending };
}
