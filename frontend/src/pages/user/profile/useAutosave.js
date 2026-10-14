import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatRequestError, keepaliveRequest } from "@/lib/api";
import { createSaveQueue, EXPECTED_USER_HEADER, sameValue } from "@/lib/profileSaveQueue";
import { profileFieldErrors, profileFormPayload, profileToForm } from "./form";

// Pause nach dem letzten Tastendruck, bis ein Textfeld von selbst speichert. Schalter, Auswahlfelder und das Verlassen
// eines Felds speichern sofort.
export const AUTOSAVE_DELAY_MS = 800;
// So lange steht „Gespeichert ✓“, danach wird der Hinweis wieder ruhig.
export const SAVED_VISIBLE_MS = 2500;
const AUTOSAVE_ERROR = "Änderung konnte nicht gespeichert werden.";

// Formularstand und Speichern der Einstellungen (#1048): alles speichert von selbst, einen Knopf „Speichern“ gibt es
// nicht mehr. Textfelder speichern nach einer kurzen Pause oder beim Verlassen des Felds, Schalter und Auswahlfelder
// sofort. Alles läuft über eine Speicher-Warteschlange (lib/profileSaveQueue): es läuft nie mehr als ein PATCH, und eine
// ältere Antwort überschreibt keine neuere Eingabe. Ein anderes Konto (oder abgemeldet) verwirft offene Änderungen; der
// Server prüft das Konto zusätzlich am Header X-Expected-User-Id. Beim Verlassen der Seite geht Offenes sofort, beim
// Schließen des Tabs per keepalive-fetch.
export function useProfileSave({ user, refresh }) {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  // Beim Verlassen des Tabs geht der Lauf per keepalive-fetch, damit der Browser ihn nicht abbricht.
  const keepaliveRef = useRef(false);
  const [queue] = useState(() => {
    const created = createSaveQueue({
      send: (payload, { account }) => {
        const headers = { [EXPECTED_USER_HEADER]: account };
        if (keepaliveRef.current) return keepaliveRequest("PATCH", "/users/me", payload, headers);
        return api.patch("/users/me", payload, { headers }).then(({ data }) => data);
      },
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
  // „Gespeichert ✓“ steht kurz und blendet dann aus.
  const [savedVisible, setSavedVisible] = useState(false);
  const fadeTimer = useRef(null);
  useEffect(() => {
    let previous = queue.getState().status;
    const unsubscribe = queue.subscribe((next) => {
      setState(next);
      if (next.status === "saved" && previous !== "saved") {
        if (fadeTimer.current) clearTimeout(fadeTimer.current);
        setSavedVisible(true);
        fadeTimer.current = setTimeout(() => {
          fadeTimer.current = null;
          setSavedVisible(false);
        }, SAVED_VISIBLE_MS);
      }
      previous = next.status;
    });
    return () => {
      unsubscribe();
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [queue]);
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
  // Sofort speichern (Schalter, Auswahl, Feld verlassen, „Erneut versuchen“): ein wartender Lauf geht im selben mit.
  const saveNow = useCallback(() => {
    cancel();
    return queue.flush();
  }, [cancel, queue]);
  // Nach der Tipp-Pause speichern.
  const saveSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setTimerActive(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setTimerActive(false);
      void queue.flush();
    }, AUTOSAVE_DELAY_MS);
  }, [queue]);

  // Ungültige Eingaben (Hinweis am Feld) bleiben als Entwurf neben der Warteschlange: angezeigt ja, gespeichert nein.
  // Die Warteschlange behält für dieses Feld den Serverstand - so geht nichts Ungültiges hinaus, die übrigen Felder
  // speichern weiter, und eine Antwort des Servers überschreibt die offene Eingabe nicht.
  const draftsRef = useRef({});
  const [drafts, setDrafts] = useState({});

  // Ein anderes Konto: der wartende Lauf und die Entwürfe des alten fallen weg (die Warteschlange setzt selbst zurück).
  const account = user?.id ?? null;
  useEffect(() => {
    cancel();
    draftsRef.current = {};
    setDrafts({});
  }, [account, cancel]);

  // Offen ist, was geändert und weder unterwegs noch gescheitert ist - das geht beim Verlassen noch mit.
  const shouldFlushOnLeave = useCallback(() => {
    if (timer.current) return true;
    const current = queue.getState();
    return current.dirty && !current.busy && !current.error;
  }, [queue]);

  // Seite in der Webseite verlassen (anderer Link): Offenes geht noch ab.
  useEffect(() => () => {
    const wanted = shouldFlushOnLeave();
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (wanted) void queue.flush();
  }, [queue, shouldFlushOnLeave]);

  // Tab verbergen, schließen oder neu laden: Offenes geht sofort, und zwar per keepalive-fetch - einen axios-Aufruf
  // bricht der Browser beim Entladen ab. Die Warteschlange ruft send dabei synchron auf.
  const flushBeforeLeaving = useCallback(() => {
    if (!shouldFlushOnLeave()) return;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      setTimerActive(false);
    }
    keepaliveRef.current = true;
    try {
      void queue.flush();
    } finally {
      keepaliveRef.current = false;
    }
  }, [queue, shouldFlushOnLeave]);

  const form = useMemo(() => ({ ...state.local, ...drafts }), [state.local, drafts]);
  const fieldErrors = useMemo(() => {
    const errors = profileFieldErrors(form);
    return Object.fromEntries(Object.keys(drafts).filter((key) => errors[key]).map((key) => [key, errors[key]]));
  }, [form, drafts]);
  const invalid = Object.keys(fieldErrors).length > 0;
  const invalidRef = useRef(false);
  useEffect(() => {
    invalidRef.current = invalid;
  }, [invalid]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushBeforeLeaving();
    };
    // Bleibt danach noch etwas offen (gescheitert oder ungültig), fragt der Browser nach. Was unterwegs ist, nicht.
    const onBeforeUnload = (event) => {
      flushBeforeLeaving();
      const current = queue.getState();
      if ((current.dirty && !current.busy) || invalidRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("pagehide", flushBeforeLeaving);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushBeforeLeaving);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushBeforeLeaving, queue]);

  const setForm = useCallback((action) => {
    const current = queue.getState();
    const shown = { ...current.local, ...draftsRef.current };
    const next = typeof action === "function" ? action(shown) : action;
    const errors = profileFieldErrors(next);
    const nextDrafts = {};
    const forQueue = { ...next };
    Object.keys(errors).forEach((key) => {
      // Ein ungültiger Stand, den der Server schon so hat (alte Daten), ist keine offene Eingabe.
      if (sameValue(next[key], current.confirmed?.[key])) return;
      nextDrafts[key] = next[key];
      forQueue[key] = current.confirmed?.[key];
    });
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    queue.edit(() => forQueue);
  }, [queue]);

  // Ein Zustand für die Anzeige: speichert > nicht gespeichert > ungültig > wartet > gespeichert > ruhig.
  let status = state.status;
  if (status === "saved" && !savedVisible) status = "idle";
  if (status !== "saving" && status !== "error") {
    if (invalid) status = "invalid";
    else if (timerActive) status = "pending";
  }
  return {
    queue,
    form,
    setForm,
    dirty: state.dirty,
    busy: state.busy,
    error: state.error,
    invalid,
    fieldErrors,
    status,
    message: state.error ? formatRequestError(state.error, AUTOSAVE_ERROR) : "",
    pending: timerActive,
    saveSoon,
    saveNow,
    cancel,
    retry: saveNow,
  };
}
