// Saisonende-Moment (#1639): Pakete für die Zeremonie-Schlange. Eigenes Modul, das ``RewardWatcher`` erst nachlädt, wenn es wirklich
// einen Moment gibt - der Start der Website bleibt so schlank (check:bundle).

import { claimKey, doneKey, momentVersion, readMark, writeMark } from "@/lib/momentMarks";

// Der Schlüssel dieses Geräts je Person und Moment (``lib/momentMarks``). Er überlebt das Neuladen - geht die Antwort auf das Holen
// verloren, bekommt dasselbe Gerät den Moment beim nächsten Besuch wieder, ein anderes nicht.
function deviceToken(userId, id) {
  const known = readMark(claimKey(userId, id));
  if (known) return known;
  const fresh = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  writeMark(claimKey(userId, id), fresh);
  return fresh;
}

/**
 * Schon geschlossen, aber „fertig“ kam beim Server nicht an: still nachmelden, nicht noch einmal zeigen - nur für diese Person und nur
 * für denselben Stand (``momentVersion``). Nach einer Korrektur ist die Marke veraltet, ebenso eine ältere Marke ohne Stand („1“).
 */
export function finishedHere(userId, moment) {
  return readMark(doneKey(userId, moment.id)) === momentVersion(moment);
}

export function reportDone(userId, moment, client) {
  const id = moment.id;
  writeMark(doneKey(userId, id), momentVersion(moment));
  client.post("/me/league-moments/done", { ids: [id] })
    .then(() => { writeMark(doneKey(userId, id), null); writeMark(claimKey(userId, id), null); })
    // Bewusst still: Die Marke bleibt, der nächste Besuch meldet nach.
    .catch(() => {});
}

/**
 * Ein Paket je Moment. Direkt vor dem Anzeigen holt die Seite ihn für dieses Gerät (``seen`` mit Schlüssel, Antwort ``claimed``) - nur
 * dann wird er gezeigt. Erst nach dem Schließen gilt er als fertig (``done``) - danach kommt er nirgends mehr. Die Prüfung fragt je Paket
 * genau einmal (läuft sie doppelt, etwa durch React im Entwicklungsmodus, gibt es dieselbe Antwort). Der Meister bringt seine
 * Belohnungen mit (Fabian 26.11., A): als zweite Karte, gesehen nur, wenn sie kam - oder als eigener Ablauf, wenn ein anderes Gerät den
 * Moment schon hatte.
 */
export function momentPackage(moment, client, userId) {
  let answer = null;
  let claimed = false;
  let rewardsShown = false;
  const rewards = (moment.rewards || []).filter((award) => award?.reward);
  return {
    id: `moment-${moment.id}`,
    moments: [moment],
    rewards,
    check: () => {
      answer ||= client.post("/me/league-moments/seen", { ids: [moment.id], token: deviceToken(userId, moment.id) })
        .then(({ data }) => {
          claimed = (data?.claimed || []).includes(moment.id);
          return { moments: claimed ? [moment] : [] };
        })
        // Scheitert das Holen, wartet der Moment auf den nächsten Besuch.
        .catch(() => ({ moments: [] }));
      return answer;
    },
    onRewardsShown: () => { rewardsShown = true; },
    onDone: () => {
      if (claimed) reportDone(userId, moment, client);
      // Ohne Moment kamen die Belohnungen als eigener Ablauf - dann sind sie gesehen; mit Moment nur, wenn die zweite Karte kam.
      if (rewards.length && (rewardsShown || !claimed)) {
        // Bewusst still: nur die Gesehen-Marke - schlimmstenfalls kommen die Belohnungen noch einmal.
        client.post("/me/rewards/seen", { ids: rewards.map((award) => award.id) }).catch(() => {});
      }
    },
  };
}

/** Reiht die Momente ein (Meister zuerst, so liefert sie der Server) und merkt sich, was dabei schon mitkommt. */
export function enqueueMoments(rows, { queue, client, queued, userId }) {
  for (const moment of rows) {
    const key = `moment:${moment?.id}`;
    if (!moment?.id || !moment.texts || queued.has(key)) continue;
    queued.add(key);
    if (finishedHere(userId, moment)) {
      reportDone(userId, moment, client);
      continue;
    }
    // Eine Marke eines älteren Stands (oder ohne Stand) gilt nicht - weg damit, der Moment kommt wieder (Nr. 277).
    if (readMark(doneKey(userId, moment.id)) !== null) writeMark(doneKey(userId, moment.id), null);
    const pkg = momentPackage(moment, client, userId);
    pkg.rewards.forEach((award) => queued.add(award.id));
    queue.enqueue(pkg);
  }
}
