import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { profileFormPayload, profileToForm } from "./form";

export const AUTOSAVE_DELAY_MS = 700;

// Schalter und Auswahlfelder speichern von selbst, 0,7 s nach dem letzten
// Klick - wie in der App seit #237 (#257). Mehrere Klicks in Folge ergeben
// genau einen PATCH mit allen Änderungen. Was während des Speicherns noch
// umgeschaltet wird, bleibt stehen und geht mit dem nächsten Lauf. Beim
// Verlassen der Seite wird ein wartender Lauf sofort abgeschickt.
export function useAutosave({ form, setForm, initialFormRef, initialUserIdRef, refresh }) {
  const formRef = useRef(form);
  const timer = useRef(null);
  const runRef = useRef(() => {});
  const scheduleRef = useRef(() => {});
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    formRef.current = form;
  });

  const run = useCallback(async () => {
    timer.current = null;
    if (!initialFormRef.current) return;
    const snapshot = formRef.current;
    const payload = buildDirtyPayload(
      profileFormPayload(snapshot),
      profileFormPayload(initialFormRef.current),
    );
    if (!hasPayloadChanges(payload)) {
      setStatus("idle");
      return;
    }
    setStatus("saving");
    try {
      const { data } = await api.patch("/users/me", payload);
      const saved = profileToForm(data);
      initialFormRef.current = saved;
      initialUserIdRef.current = data.id;
      // Änderungen seit dem Abschicken bleiben erhalten und werden gleich
      // noch einmal gespeichert.
      const later = buildDirtyPayload(formRef.current, snapshot);
      setForm({ ...saved, ...later });
      setStatus("saved");
      setMessage("");
      if (refresh) await refresh();
      if (hasPayloadChanges(later)) scheduleRef.current();
    } catch (err) {
      const text = formatRequestError(err, "Änderung konnte nicht gespeichert werden.");
      setStatus("error");
      setMessage(text);
      toast.error(text);
    }
  }, [initialFormRef, initialUserIdRef, refresh, setForm]);
  runRef.current = run;

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setStatus("pending");
    timer.current = setTimeout(() => {
      void runRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, []);
  scheduleRef.current = schedule;

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void runRef.current();
    }
  }, []);

  return { schedule, cancel, status, message };
}
