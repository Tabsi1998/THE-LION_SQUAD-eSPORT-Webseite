import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { PlacementMoment } from "@/components/tls/podium/PlacementMoment";
import { RewardMoment } from "@/components/tls/rewards/RewardMoment";
import { SeasonMoment } from "@/components/tls/league/moment/SeasonMoment";
import { Ceremony } from "./Ceremony";
import { ceremonyQueue } from "./queue";
import { planCeremony } from "./select";

// Erfolge II (E8, #618): der eine Ort, an dem Zeremonien erscheinen. Liest die Warteschlange, zeigt nie
// zwei zugleich, hält im Adminbereich und auf Anzeige-Seiten still (die Zeremonie wartet dort in der
// Schlange) und beachtet „Zeremonien dezent“ aus dem Profil sowie die Systemeinstellung.
const QUIET_PREFIXES = ["/admin", "/display", "/print", "/setup", "/consent"];

// Die Vorschau im Admin (E10) übersteuert Bewegung und Klang: ``reducedOverride`` (an/aus statt Profil und System)
// und ``sound`` („on“, „off“ oder „auto“ = wie im Profil).
export function CeremonyHost({ queue = ceremonyQueue, quietPrefixes = QUIET_PREFIXES, reducedOverride, sound = "auto" }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const current = useSyncExternalStore(queue.subscribe, queue.getCurrent, () => null);
  const systemReduced = useReducedMotion();
  const reduced = typeof reducedOverride === "boolean" ? reducedOverride : systemReduced || user?.ceremony_mode === "subtle";
  const quiet = quietPrefixes.some((prefix) => pathname.startsWith(prefix));
  // Einmal je Konto (#2450): direkt vor dem Anzeigen fragt die Seite den Server noch einmal - hat ein anderes Gerät die
  // Zeremonie inzwischen geschlossen, fällt sie weg. Bis die Antwort da ist, bleibt die Bühne leer.
  const pendingCheck = Boolean(current?.check && !current.checked);
  useEffect(() => {
    if (!current || !pendingCheck || quiet) return undefined;
    let alive = true;
    const { id } = current;
    Promise.resolve()
      .then(() => current.check(current))
      .then((patch) => { if (alive) queue.refine(id, patch || {}); }, () => { if (alive) queue.refine(id, {}); });
    return () => { alive = false; };
  }, [current, pendingCheck, quiet, queue]);
  const plan = useMemo(() => (current && !pendingCheck ? planCeremony(current) : null), [current, pendingCheck]);
  const close = useCallback(() => queue.advance(), [queue]);
  // Die Zurück-Taste (Browser, Handy) schließt die Zeremonie wie X, Tipp daneben oder Escape - und zählt als gesehen.
  const ceremonyOpen = Boolean(plan && !quiet && !["placement", "reward", "season"].includes(plan.sequence));
  useEffect(() => {
    if (!ceremonyOpen) return undefined;
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [ceremonyOpen, close]);
  return (
    <AnimatePresence>
      {plan && !quiet && plan.sequence === "placement" ? <PlacementMoment key={plan.id} plan={plan} onClose={close} reduced={reduced} /> : null}
      {plan && !quiet && plan.sequence === "reward" ? <RewardMoment key={plan.id} plan={plan} onClose={close} reduced={reduced} /> : null}
      {plan && !quiet && plan.sequence === "season" ? <SeasonMoment key={plan.id} plan={plan} onClose={close} reduced={reduced} /> : null}
      {ceremonyOpen ? <Ceremony key={plan.id} plan={plan} onClose={close} user={user} reduced={reduced} sound={sound} /> : null}
    </AnimatePresence>
  );
}
