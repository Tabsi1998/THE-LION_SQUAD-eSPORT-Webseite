import React, { useCallback, useMemo, useSyncExternalStore } from "react";
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
  const plan = useMemo(() => (current ? planCeremony(current) : null), [current]);
  const close = useCallback(() => { queue.advance(); }, [queue]);
  if (!plan) return null;
  return <Ceremony key={plan.id} plan={plan} onClose={close} reduced={reduced} />;
}
