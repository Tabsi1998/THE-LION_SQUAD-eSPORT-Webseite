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
 */
export function RewardWatcher({ queue = ceremonyQueue, client = api }) {
  const { user } = useAuth();
  const queued = useRef(new Set());
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    client.get("/me/rewards/unseen").then(({ data }) => {
      if (!alive) return;
      const fresh = (data?.rewards || []).filter((award) => award?.reward && !queued.current.has(award.id));
      for (const rewards of rewardPackages(fresh)) {
        rewards.forEach((award) => queued.current.add(award.id));
        queue.enqueue({
          rewards,
          onDone: () => { client.post("/me/rewards/seen", { ids: rewards.map((award) => award.id) }).catch(() => {}); },
        });
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [userId, queue, client]);
  return null;
}
