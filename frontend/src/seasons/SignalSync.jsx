import { useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { pendingSignals, setSignalOwner, settleSignals } from "./signals";

// Meldet gesammelte Signale an den Server (#678): kurz nach jeder Zählung (gebündelt, damit zwanzig Schneeflocken eine
// Meldung sind), beim Laden der Seite und nach dem Login - dann auch das, was ohne Anmeldung gesammelt wurde. Ohne
// Anmeldung passiert nichts; der Ausgang wartet im Browser. Schlägt die Meldung fehl (Netz, Server), bleibt alles im
// Ausgang und geht beim nächsten Anlass mit. Hat der Server dabei eine neue Stufe vergeben, erfährt es die Zeremonie.

export const FLUSH_DELAY_MS = 1500;
export const FIRST_FLUSH_MS = 2500;
export const RETRY_MS = 60000;
export const AWARDED_EVENT = "tls:achievements-awarded";

/** Antworten, bei denen ein zweiter Versuch nichts ändert: die Meldung ist so nicht annehmbar. */
function isFinal(status) {
  return status === 400 || status === 404 || status === 413 || status === 422;
}

/**
 * Eine Meldung: schickt, was für diese Person im Ausgang liegt. Liefert `{ sent, accepted, awarded }` oder `null`,
 * wenn nichts zu melden war; `retry` heißt, dass der Ausgang unverändert wartet.
 */
export async function flushSignals(userId, { post = (body) => api.post("/achievements/signals", body, { skipInvalidation: true }), now = new Date() } = {}) {
  const items = pendingSignals(userId, now);
  if (!items.length) return null;
  try {
    const { data } = await post({ items: items.map(({ name, day, count }) => ({ name, day, count })) });
    // Angenommen oder abgelehnt (Deckel, Saison, zu alt): gemeldet ist gemeldet - es kommt nicht noch einmal.
    settleSignals(items, now);
    return { sent: items.length, accepted: Number(data?.accepted) || 0, awarded: Number(data?.newly_awarded) || 0, retry: false };
  } catch (error) {
    if (isFinal(error?.response?.status)) {
      settleSignals(items, now);
      return { sent: items.length, accepted: 0, awarded: 0, retry: false };
    }
    return { sent: 0, accepted: 0, awarded: 0, retry: true };
  }
}

export function SignalSync() {
  const { user } = useAuth();
  const userId = user?.id || null;

  // Neue Zählungen gehören der angemeldeten Person - auch schon, bevor die erste Meldung hinausgeht.
  useEffect(() => {
    setSignalOwner(userId);
    return () => setSignalOwner(null);
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let timer = 0;
    let busy = false;
    let again = false;
    let gone = false;
    const schedule = (delay) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, delay);
    };
    async function run() {
      if (gone) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      const result = await flushSignals(userId);
      busy = false;
      if (gone) return;
      if (result?.awarded > 0) {
        try {
          window.dispatchEvent(new CustomEvent(AWARDED_EVENT, { detail: { count: result.awarded, source: "signal" } }));
        } catch {
          // Ohne CustomEvent zeigt der nächste Besuch die neue Stufe.
        }
      }
      if (result?.retry) schedule(RETRY_MS);
      else if (again || (result && pendingSignals(userId).length)) schedule(FLUSH_DELAY_MS);
      again = false;
    }
    const onSignal = () => schedule(FLUSH_DELAY_MS);
    // Wer die Seite verlässt, soll nichts verlieren: sofort melden, solange der Tab noch lebt.
    const onHide = () => {
      if (document.hidden) schedule(0);
    };
    window.addEventListener("tls:season-signal", onSignal);
    document.addEventListener("visibilitychange", onHide);
    schedule(FIRST_FLUSH_MS);
    return () => {
      gone = true;
      window.clearTimeout(timer);
      window.removeEventListener("tls:season-signal", onSignal);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [userId]);

  return null;
}
