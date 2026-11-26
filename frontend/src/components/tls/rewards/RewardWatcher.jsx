import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ceremonyQueue } from "@/components/achievements/ceremony/queue";

/** Je Staffel ein Paket: Belohnungen aus demselben Abschluss feiern zusammen. */
export function rewardPackages(rewards) {
  const groups = new Map();
  for (const award of rewards || []) {
    const key = award.tournament?.id || award.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(award);
  }
  return [...groups.values()];
}

/**
 * Still (F.4, #2214, Nr. 165): Nach dem Anmelden fragt die Seite einmal, welche Belohnungen noch nicht gefeiert wurden, und reiht je
 * Staffel eine Zeremonie ein. Erst wenn sie vorbei ist, gilt sie als gesehen - im Adminbereich wartet sie in der Schlange.
 * Dazu der Saisonende-Moment (#1639): zuerst der Ausgang der Season (Meister, Aufstieg, Abstieg), dann die Belohnungen. Die Pakete für
 * den Moment (``moment/momentPackage``) lädt die Seite erst nach, wenn es einen gibt - der Start bleibt schlank.
 */
export function RewardWatcher({ queue = ceremonyQueue, client = api }) {
  const { user } = useAuth();
  const queued = useRef(new Set());
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    // Bewusst still: Feiern sind eine Zugabe - die nächste Anmeldung fragt wieder.
    const moments = client.get("/me/league-moments/unseen").then(({ data }) => data?.moments || [], () => []);
    const rewards = client.get("/me/rewards/unseen").then(({ data }) => data?.rewards || [], () => []);
    const enqueueRewards = (rewardRows) => {
      const fresh = rewardRows.filter((award) => award?.reward && !queued.current.has(award.id));
      for (const group of rewardPackages(fresh)) {
        group.forEach((award) => queued.current.add(award.id));
        queue.enqueue({
          rewards: group,
          // Bewusst still: nur die Gesehen-Marke - schlimmstenfalls kommt die Feier noch einmal.
          onDone: () => { client.post("/me/rewards/seen", { ids: group.map((award) => award.id) }).catch(() => {}); },
        });
      }
    };
    Promise.all([moments, rewards]).then(([momentRows, rewardRows]) => {
      if (!alive) return;
      if (!momentRows.length) {
        enqueueRewards(rewardRows);
        return;
      }
      import("@/components/tls/league/moment/momentPackage")
        .then(({ enqueueMoments }) => { if (alive) enqueueMoments(momentRows, { queue, client, queued: queued.current }); })
        // Bewusst still: Der Moment kommt beim nächsten Besuch - die Belohnungen kommen trotzdem.
        .catch(() => {})
        .finally(() => { if (alive) enqueueRewards(rewardRows); });
    });
    return () => { alive = false; };
  }, [userId, queue, client]);
  return null;
}
