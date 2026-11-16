import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useReduceMotion } from "../../components/FadeIn";
import { Ceremony } from "./Ceremony";
import { type CeremonyQueue, ceremonyQueue } from "./queue";
import { planCeremony } from "./select";

// Erfolge II (E13, #623): der eine Ort, an dem Zeremonien in der App erscheinen. Liest die Warteschlange, zeigt
// nie zwei zugleich und beachtet „Bewegung reduzieren“ am Gerät sowie „Zeremonien dezent“ aus dem Profil.

export function CeremonyHost({ queue = ceremonyQueue }: { queue?: CeremonyQueue }) {
  const { user } = useAuth();
  const current = useSyncExternalStore(queue.subscribe, queue.getCurrent, () => null);
  const systemReduced = useReduceMotion();
  const reduced = systemReduced || (user as { ceremony_mode?: string } | null)?.ceremony_mode === "subtle";
  // Einmal je Konto (#2450): direkt vor dem Anzeigen fragt die App den Server noch einmal - hat ein anderes Gerät die
  // Zeremonie inzwischen geschlossen, fällt sie weg. Bis die Antwort da ist, bleibt die Bühne leer.
  const pendingCheck = Boolean(current?.check && !current.checked);
  useEffect(() => {
    if (!current || !pendingCheck || !current.check) return undefined;
    let alive = true;
    const { id, check } = current;
    Promise.resolve()
      .then(() => check(current))
      .then((patch) => { if (alive) queue.refine(id, patch || {}); }, () => { if (alive) queue.refine(id, {}); });
    return () => { alive = false; };
  }, [current, pendingCheck, queue]);
  const plan = useMemo(() => (current && !pendingCheck ? planCeremony(current) : null), [current, pendingCheck]);
  const close = useCallback(() => { queue.advance(); }, [queue]);
  if (!plan) return null;
  return <Ceremony key={plan.id} plan={plan} onClose={close} reduced={reduced} user={user as { ceremony_sound?: boolean | null; ceremony_volume?: number | null; avatar_url?: string | null } | null} />;
}
