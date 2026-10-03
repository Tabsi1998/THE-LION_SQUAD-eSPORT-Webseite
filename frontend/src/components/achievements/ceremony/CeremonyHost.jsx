import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { Ceremony } from "./Ceremony";
import { ceremonyQueue } from "./queue";
import { planCeremony } from "./select";

// Erfolge II (E8, #618): der eine Ort, an dem Zeremonien erscheinen. Liest die Warteschlange, zeigt nie
// zwei zugleich, hält im Adminbereich und auf Anzeige-Seiten still (die Zeremonie wartet dort in der
// Schlange) und beachtet „Zeremonien dezent“ aus dem Profil sowie die Systemeinstellung.
const QUIET_PREFIXES = ["/admin", "/display", "/setup", "/consent"];

// Die Vorschau im Admin (E10) übersteuert Bewegung und Klang: ``reducedOverride`` (an/aus statt Profil und System)
// und ``sound`` („on“, „off“ oder „auto“ = wie im Profil).
export function CeremonyHost({ queue = ceremonyQueue, quietPrefixes = QUIET_PREFIXES, reducedOverride, sound = "auto" }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const current = useSyncExternalStore(queue.subscribe, queue.getCurrent, () => null);
  const systemReduced = useReducedMotion();
  const reduced = typeof reducedOverride === "boolean" ? reducedOverride : systemReduced || user?.ceremony_mode === "subtle";
  const plan = useMemo(() => (current ? planCeremony(current) : null), [current]);
  const close = useCallback(() => queue.advance(), [queue]);
  const quiet = quietPrefixes.some((prefix) => pathname.startsWith(prefix));
  return (
    <AnimatePresence>
      {plan && !quiet ? <Ceremony key={plan.id} plan={plan} onClose={close} user={user} reduced={reduced} sound={sound} /> : null}
    </AnimatePresence>
  );
}
