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
 * Saisonende-Moment (#1639): ein Paket je Moment. Direkt vor dem Anzeigen holt die Seite ihn sich beim Server (``seen`` mit ``claimed``) -
 * nur was dieses Gerät bekommt, wird gezeigt. Neu laden, ein zweiter Tab, ein anderes Gerät: kein zweites Mal. Scheitert die Anfrage,
 * wartet der Moment auf den nächsten Besuch. Die Prüfung fragt je Paket genau einmal - läuft sie doppelt (React im Entwicklungsmodus,
 * ein neu gezeichneter Host), bekommt der zweite Aufruf dieselbe Antwort statt eines leeren „schon gesehen“.
 */
export function momentPackage(moment, client = api) {
  let answer = null;
  return {
    id: `moment-${moment.id}`,
    moments: [moment],
    check: () => {
      answer ||= client.post("/me/league-moments/seen", { ids: [moment.id] })
        .then(({ data }) => ({ moments: (data?.claimed || []).includes(moment.id) ? [moment] : [] }))
        .catch(() => ({ moments: [] }));
      return answer;
    },
  };
}

/**
 * Still (F.4, #2214, Nr. 165): Nach dem Anmelden fragt die Seite einmal, welche Belohnungen noch nicht gefeiert wurden, und reiht je
 * Staffel eine Zeremonie ein. Erst wenn sie vorbei ist, gilt sie als gesehen - im Adminbereich wartet sie in der Schlange.
 * Dazu der Saisonende-Moment (#1639): zuerst der Ausgang der Season (Meister, Aufstieg, Abstieg), dann die Belohnungen dazu.
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
    Promise.all([moments, rewards]).then(([momentRows, rewardRows]) => {
      if (!alive) return;
      for (const moment of momentRows) {
        const key = `moment:${moment?.id}`;
        if (!moment?.id || !moment.texts || queued.current.has(key)) continue;
        queued.current.add(key);
        queue.enqueue(momentPackage(moment, client));
      }
      const fresh = rewardRows.filter((award) => award?.reward && !queued.current.has(award.id));
      for (const group of rewardPackages(fresh)) {
        group.forEach((award) => queued.current.add(award.id));
        queue.enqueue({
          rewards: group,
          // Bewusst still: nur die Gesehen-Marke - schlimmstenfalls kommt die Feier noch einmal.
          onDone: () => { client.post("/me/rewards/seen", { ids: group.map((award) => award.id) }).catch(() => {}); },
        });
      }
    });
    return () => { alive = false; };
  }, [userId, queue, client]);
  return null;
}
