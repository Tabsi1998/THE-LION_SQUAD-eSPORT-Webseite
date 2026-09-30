import { useEffect } from "react";
import { AppState } from "react-native";
import { api } from "../lib/api";
import { onSignal, pendingSignals, setSignalOwner, settleSignals } from "./signals";

// Meldet gesammelte Signale an den Server (#678) - dieselben Regeln wie im Web (SignalSync.jsx): kurz nach jeder
// Zählung (gebündelt), beim Start der App, wenn sie wieder nach vorne kommt und bevor sie in den Hintergrund geht.
// Ohne Anmeldung (auch als Gast) passiert nichts; der Ausgang wartet am Gerät. Schlägt die Meldung fehl (Netz, Server),
// bleibt alles im Ausgang und geht beim nächsten Anlass mit.

export const FLUSH_DELAY_MS = 1500;
export const FIRST_FLUSH_MS = 2500;
export const RETRY_MS = 60000;

export type FlushResult = { sent: number; accepted: number; awarded: number; retry: boolean };
type Post = (body: { items: Array<{ name: string; day: string; count: number }> }) => Promise<{ data?: { accepted?: number; newly_awarded?: number } }>;

/** Antworten, bei denen ein zweiter Versuch nichts ändert: die Meldung ist so nicht annehmbar. */
function isFinal(status: number | undefined): boolean {
  return status === 400 || status === 404 || status === 413 || status === 422;
}

/**
 * Eine Meldung: schickt, was für diese Person im Ausgang liegt. Liefert `null`, wenn nichts zu melden war; `retry`
 * heißt, dass der Ausgang unverändert wartet.
 */
export async function flushSignals(userId: string | null | undefined, { post = (body) => api.post("/achievements/signals", body), now = new Date() }: { post?: Post; now?: Date } = {}): Promise<FlushResult | null> {
  const items = await pendingSignals(userId, now);
  if (!items.length) return null;
  try {
    const { data } = await post({ items });
    // Angenommen oder abgelehnt (Deckel, Saison, zu alt): gemeldet ist gemeldet - es kommt nicht noch einmal.
    await settleSignals(items, now);
    return { sent: items.length, accepted: Number(data?.accepted) || 0, awarded: Number(data?.newly_awarded) || 0, retry: false };
  } catch (error) {
    const status = (error as { response?: { status?: number } } | null)?.response?.status;
    if (isFinal(status)) {
      await settleSignals(items, now);
      return { sent: items.length, accepted: 0, awarded: 0, retry: false };
    }
    return { sent: 0, accepted: 0, awarded: 0, retry: true };
  }
}

/**
 * Der Abgleich als Hook für den SeasonProvider. `userId` ist leer für niemanden und für Gäste; `onAwarded` bekommt die
 * Zahl der Stufen, die der Server bei der Meldung vergeben hat.
 */
export function useSignalSync(userId: string | null | undefined, onAwarded?: (count: number) => void): void {
  useEffect(() => {
    setSignalOwner(userId || null);
    return () => setSignalOwner(null);
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let again = false;
    let gone = false;
    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delay);
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
      if (result && result.awarded > 0) onAwarded?.(result.awarded);
      if (result?.retry) schedule(RETRY_MS);
      else if (again) schedule(FLUSH_DELAY_MS);
      again = false;
    }
    const stopListening = onSignal(() => schedule(FLUSH_DELAY_MS));
    // Nach vorne: nachmelden. In den Hintergrund: sofort melden, solange die App noch lebt.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") schedule(FIRST_FLUSH_MS);
      else schedule(0);
    });
    schedule(FIRST_FLUSH_MS);
    return () => {
      gone = true;
      if (timer) clearTimeout(timer);
      stopListening();
      subscription.remove();
    };
    // `onAwarded` darf sich ändern, ohne den Abgleich neu zu starten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
