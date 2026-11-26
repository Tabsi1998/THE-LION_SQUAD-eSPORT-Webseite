// Saisonende-Moment (#1639): Pakete für die Zeremonie-Schlange. Eigenes Modul, das ``RewardWatcher`` erst nachlädt, wenn es wirklich
// einen Moment gibt - der Start der Website bleibt so schlank (check:bundle).

// Der Schlüssel dieses Geräts je Moment. Er überlebt das Neuladen - geht die Antwort auf das Holen verloren, bekommt dasselbe Gerät den
// Moment beim nächsten Besuch wieder, ein anderes nicht. Ohne Speicher (privates Fenster) gilt er je Sitzung.
const memory = new Map();
const claimKey = (id) => `tls_moment_claim:${id}`;
const doneKey = (id) => `tls_moment_done:${id}`;

function stored(key) {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function store(key, value) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Kein Speicher - der Schlüssel gilt dann je Sitzung.
  }
}

function deviceToken(id) {
  const known = stored(claimKey(id));
  if (known) return known;
  const fresh = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  store(claimKey(id), fresh);
  return fresh;
}

/** Schon geschlossen, aber „fertig“ kam beim Server nicht an: still nachmelden, nicht noch einmal zeigen. */
export function finishedHere(id) {
  return stored(doneKey(id)) === "1";
}

export function reportDone(id, client) {
  store(doneKey(id), "1");
  client.post("/me/league-moments/done", { ids: [id] })
    .then(() => { store(doneKey(id), null); store(claimKey(id), null); })
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
export function momentPackage(moment, client) {
  let answer = null;
  let claimed = false;
  let rewardsShown = false;
  const rewards = (moment.rewards || []).filter((award) => award?.reward);
  return {
    id: `moment-${moment.id}`,
    moments: [moment],
    rewards,
    check: () => {
      answer ||= client.post("/me/league-moments/seen", { ids: [moment.id], token: deviceToken(moment.id) })
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
      if (claimed) reportDone(moment.id, client);
      // Ohne Moment kamen die Belohnungen als eigener Ablauf - dann sind sie gesehen; mit Moment nur, wenn die zweite Karte kam.
      if (rewards.length && (rewardsShown || !claimed)) {
        // Bewusst still: nur die Gesehen-Marke - schlimmstenfalls kommen die Belohnungen noch einmal.
        client.post("/me/rewards/seen", { ids: rewards.map((award) => award.id) }).catch(() => {});
      }
    },
  };
}

/** Reiht die Momente ein (Meister zuerst, so liefert sie der Server) und merkt sich, was dabei schon mitkommt. */
export function enqueueMoments(rows, { queue, client, queued }) {
  for (const moment of rows) {
    const key = `moment:${moment?.id}`;
    if (!moment?.id || !moment.texts || queued.has(key)) continue;
    queued.add(key);
    if (finishedHere(moment.id)) {
      reportDone(moment.id, client);
      continue;
    }
    const pkg = momentPackage(moment, client);
    pkg.rewards.forEach((award) => queued.add(award.id));
    queue.enqueue(pkg);
  }
}
