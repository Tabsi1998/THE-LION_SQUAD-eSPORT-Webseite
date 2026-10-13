import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { createSaveQueue, EXPECTED_USER_HEADER } from "@/lib/profileSaveQueue";
import { profileFormPayload, profileToForm } from "./form";

export const AUTOSAVE_DELAY_MS = 700;
const AUTOSAVE_ERROR = "Änderung konnte nicht gespeichert werden.";

// Formularstand und Speichern der Einstellungen (#1048): alles läuft über eine Speicher-Warteschlange
// (lib/profileSaveQueue). Schalter und Auswahlfelder speichern von selbst, 0,7 s nach dem letzten Klick - wie in der
// App seit #237 (#257). „Speichern“ reiht sich hinter einen laufenden Autosave; es läuft nie mehr als ein PATCH, und
// eine ältere Antwort überschreibt keine neuere Eingabe. Ein anderes Konto (oder abgemeldet) verwirft offene
// Änderungen; der Server prüft das Konto zusätzlich am Header X-Expected-User-Id. Beim Verlassen der Seite wird ein
// wartender Autosave sofort abgeschickt.
export function useProfileSave({ user, refresh }) {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  const [queue] = useState(() => {
    const created = createSaveQueue({
      send: (payload, { account }) => api
        .patch("/users/me", payload, { headers: { [EXPECTED_USER_HEADER]: account } })
        .then(({ data }) => data),
      fromServer: profileToForm,
      toPayload: profileFormPayload,
      onSaved: () => {
        // Die Sitzung (Name oben, Avatar …) nachziehen; ältere Stände verwirft die Warteschlange selbst.
        void Promise.resolve(refreshRef.current?.()).catch(() => {});
      },
    });
    if (user) created.load(user);
    return created;
  });
  const [state, setState] = useState(() => queue.getState());
  useEffect(() => queue.subscribe(setState), [queue]);
  useEffect(() => {
    queue.load(user || null);
  }, [queue, user]);

  const timer = useRef(null);
  const [timerActive, setTimerActive] = useState(false);
  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      setTimerActive(false);
    }
  }, []);
  const runAutosave = useCallback(() => {
    timer.current = null;
    setTimerActive(false);
    void queue.flush().then((result) => {
      if (!result.ok && result.error) toast.error(formatRequestError(result.error, AUTOSAVE_ERROR));
    });
  }, [queue]);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setTimerActive(true);
    timer.current = setTimeout(runAutosave, AUTOSAVE_DELAY_MS);
  }, [runAutosave]);
  // Sofort speichern (Knopf „Speichern“ und „Erneut versuchen“): ein wartender Autosave geht im selben Lauf mit.
  const save = useCallback(() => {
    cancel();
    return queue.flush();
  }, [cancel, queue]);

  // Ein anderes Konto: der wartende Autosave des alten fällt weg (die Warteschlange hat schon zurückgesetzt).
  const account = user?.id ?? null;
  useEffect(() => {
    cancel();
  }, [account, cancel]);

  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void queue.flush();
    }
  }, [queue]);

  const setForm = useCallback((action) => {
    queue.edit(typeof action === "function" ? action : () => action);
  }, [queue]);

  let status = state.status;
  if (status !== "saving" && timerActive) status = "pending";
  return {
    queue,
    form: state.local,
    setForm,
    dirty: state.dirty,
    busy: state.busy,
    error: state.error,
    status,
    message: state.error ? formatRequestError(state.error, AUTOSAVE_ERROR) : "",
    pending: timerActive,
    schedule,
    cancel,
    save,
    retry: save,
  };
}
