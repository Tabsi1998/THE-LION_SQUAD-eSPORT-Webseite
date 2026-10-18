// Momente am TV (#1110, #1116, #1118, #1119): Immer nur ein Moment gleichzeitig. Champion und Ergebnis gehen vor, der
// Zoom beim Start eines Spiels kommt danach, Sponsor- und Zahlen-Momente (Meilenstein 60, #1124, #1125) warten, bis
// nichts Wichtigeres ansteht. Kommt ein Ergebnis, während ein Sponsor oder die Zahlen stehen, macht der leise Moment
// Platz und kommt danach noch einmal ganz. Die neue Bestzeit am Fast-Lap-TV (#1127) zählt wie ein Ergebnis. Mehr als drei
// Ergebnisse auf einmal werden eine Sammelkarte. Ein kleiner Speicher ohne Abhängigkeiten, den React über
// useSyncExternalStore liest - wie die Zeremonie-Warteschlange der Erfolge.
import { advancementModeOf, diffBracket, drawRails, isDone, matchFate, slotDraw } from "@/lib/bracketGraph";
import { withDrawOrigins } from "@/components/tls/bracket/bracketMotion";
import { matchName, stationName } from "@/lib/tvLive";
import { matchRoundLabel } from "@/lib/tournamentLabels";

// Seit #1564 je Turnier-Ereignis ein eigener Moment: Auslosung und Zusammenlegen nach den Ergebnissen, „entfällt“ danach,
// alle vor dem Start-Zoom.
// Seit #1634 auch die Show-Auslosung („bereit“) und der sofort gezogene Platz - wie die Auslosung.
export const MOMENT_PRIORITY = Object.freeze({ champion: 30, result: 20, best: 20, draw: 18, draw_ready: 18, draw_assigned: 18, merge: 18, mark: 15, live: 10, sponsor: 5, stats: 5 });
// Leise Momente: sie weichen, sobald etwas Wichtigeres kommt.
export const YIELDING_MOMENTS = Object.freeze(new Set(["sponsor", "stats"]));
// Wie lange ein Moment höchstens warten darf, bevor er nichts mehr bedeutet (ein Zoom auf ein Spiel, das schon eine
// Weile läuft). Ohne Eintrag wartet er, bis er dran ist.
export const MOMENT_MAX_WAIT_MS = Object.freeze({ live: 15000 });
export const COLLECT_AFTER = 3;
// Wie lange die Karten stehen: ein Ergebnis etwa 3 Sekunden, die Sammelkarte etwas länger, der Start-Zoom etwa 4, die
// neue Bestzeit etwa 3. Sponsor und Zahlen bringen ihre Dauer selbst mit (aus der Wiedergabeliste).
export const MOMENT_MS = Object.freeze({ result: 3000, collective: 4500, live: 4000, championCard: 4400, best: 3200, sponsor: 6000, stats: 8000, draw: 2400, merge: 3200, mark: 3200,
  // Show-Auslosung bereit: so lange steht der Baum mit den leuchtenden Zielspielen, danach bleibt der Hinweis stehen.
  // Ein sofort gezogener Platz: kurz - wie eine Zeile der Auslosung (#1634).
  draw_ready: 2800, draw_assigned: 1600 });

export function createMomentQueue({ now = () => Date.now() } = {}) {
  const listeners = new Set();
  let current = null;
  let pending = [];
  let sequence = 0;
  let version = 0;

  function emit() {
    version += 1;
    for (const listener of listeners) listener();
  }

  function priorityOf(type) {
    return MOMENT_PRIORITY[type] ?? 0;
  }

  /** Mehr als drei wartende Ergebnisse werden eine Sammelkarte - in der Reihenfolge, in der sie kamen. */
  function collectResults() {
    const results = pending.filter((entry) => entry.type === "result");
    const count = results.reduce((sum, entry) => sum + entry.items.length, 0);
    if (count <= COLLECT_AFTER || results.length < 2) return;
    const merged = { ...results[0], items: results.flatMap((entry) => entry.items) };
    pending = [merged, ...pending.filter((entry) => entry.type !== "result")];
  }

  function enqueue(moment) {
    if (!moment?.type) return null;
    const stamp = now();
    if (moment.type === "live") {
      // Starten weitere Spiele, solange der Zoom noch wartet: ein Zoom für alle.
      const waiting = pending.find((entry) => entry.type === "live");
      if (waiting) {
        waiting.matchIds = [...new Set([...(waiting.matchIds || []), ...(moment.matchIds || [])])];
        emit();
        return waiting;
      }
    }
    sequence += 1;
    const entry = { ...moment, id: moment.id || `${moment.type}-${sequence}`, priority: priorityOf(moment.type), at: stamp, seq: sequence };
    if (entry.type === "result") entry.items = [...(moment.items || [])];
    pending.push(entry);
    if (entry.type === "result") collectResults();
    // Ein Sponsor oder die Zahlen stehen gerade, und es kommt etwas Wichtigeres: der leise Moment macht Platz und wartet -
    // danach kommt er noch einmal ganz.
    if (current && YIELDING_MOMENTS.has(current.type) && entry.priority > current.priority) {
      pending.push({ ...current, yielded: (current.yielded || 0) + 1 });
      current = null;
    }
    emit();
    return entry;
  }

  /** Der Moment, der jetzt dran ist: der laufende, sonst der wichtigste wartende (bei Gleichstand der älteste). */
  function next() {
    if (current) return current;
    const stamp = now();
    pending = pending.filter((entry) => {
      const maxWait = MOMENT_MAX_WAIT_MS[entry.type];
      return !maxWait || stamp - entry.at <= maxWait;
    });
    if (!pending.length) return null;
    const best = pending.reduce((winner, entry) => (entry.priority > winner.priority || (entry.priority === winner.priority && entry.seq < winner.seq) ? entry : winner));
    pending = pending.filter((entry) => entry !== best);
    current = best;
    emit();
    return current;
  }

  function finish(id) {
    if (!current || (id && current.id !== id)) return false;
    current = null;
    emit();
    return true;
  }

  /** Wartende Momente entfernen, auf die `test` zutrifft (z. B. ein Zoom auf ein Spiel, das nicht mehr läuft). */
  function drop(test) {
    const before = pending.length;
    pending = pending.filter((entry) => !test(entry));
    if (pending.length !== before) emit();
  }

  function clear() {
    current = null;
    pending = [];
    emit();
  }

  return {
    enqueue,
    next,
    finish,
    drop,
    clear,
    getCurrent: () => current,
    getPending: () => [...pending],
    getVersion: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const readyMarker = (match) => (match?.draw_ready && typeof match.draw_ready === "object" ? match.draw_ready : null);

/**
 * Die Show-Auslosungen, die gerade auf das Los warten (#1590, am TV #1634): je Gruppe `{ key, group, label, matchIds,
 * names, since }` - `names` aus dem Topf am Server (`draw_ready.pot_size`), sonst die offenen Plätze. Dieselbe Regel wie
 * im Web-Baum (lib/bracketGraph.drawRails `ready`): nur im Modus Show und nur, solange noch nicht gelost ist.
 */
export function readyDraws(matches = []) {
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  return drawRails(matches || []).filter((rail) => rail.ready).map((rail) => {
    const marker = rail.targets.map((id) => readyMarker(byId.get(id))).find(Boolean) || {};
    const pot = Number(marker.pot_size);
    return { key: rail.key, group: rail.group, label: rail.label, matchIds: rail.targets, names: pot > 0 ? pot : rail.open, since: String(marker.since || "") };
  });
}

/** „Auslosung bereit · 8 Namen“ - wie die Karte der Turnierleitung; mehrere Gruppen zählen zusammen. */
export function drawReadyText(draws = []) {
  const names = (draws || []).reduce((sum, draw) => sum + (Number(draw.names) || 0), 0);
  return names ? `Auslosung bereit · ${names} ${names === 1 ? "Name" : "Namen"}` : "Auslosung bereit";
}

const slotIndexOf = (match, registrationId) => (match?.slots || []).findIndex((slot) => slot?.registration_id === registrationId);

/**
 * Was ein neuer Stand am TV auslöst (#1564) - aus lib/bracketGraph.diffBracket, derselben Regel wie im Web-Baum:
 *   `draw`  Auslosung: neue Namen ohne Herkunft, als ein Moment, `rows` mit laufender Nummer `index`
 *   `merge` Läufe zusammengelegt: `moves` (aus welcher Zeile des alten Laufs in welchen Platz), `merged` (die alten
 *           Läufe) und `freed` - die Stationen, die danach kein offenes Spiel mehr braucht
 *   `mark`  entfällt (Reset nicht nötig, gestrichen): `items` mit Grund
 *   `draw_ready`    Show-Auslosung bereit (#1634): `draws` (readyDraws) und `matchIds` - die Zielspiele leuchten
 *   `draw_assigned` sofort zufällig (#1634): ein Name auf seinem gezogenen Platz, `rows` wie bei der Auslosung
 * Dazu `walkovers` und `corrected` (Spiel-Kennungen): die Ergebnis-Momente sagen „kampflos“ bzw. „korrigiert“.
 * Weiterkommen läuft wie bisher über den Ergebnis-Moment (Fahrt entlang der Linie). `seen` merkt sich jede Bewegung
 * (Schlüssel aus diffBracket) - so läuft sie genau einmal, auch wenn derselbe Stand noch einmal kommt.
 */
export function momentsFromChange(previous, next, { seen = new Set() } = {}) {
  // Gemischte Runden (#1548): die Auslosung kennt die echte Herkunft je Platz - wie im Web-Baum (withDrawOrigins).
  const events = withDrawOrigins(diffBracket(previous || null, next || null), next || []).filter((event) => !seen.has(event.key));
  for (const event of events) seen.add(event.key);
  const before = new Map((previous || []).map((match) => [match.id, match]));
  const after = new Map((next || []).map((match) => [match.id, match]));
  const moments = [];
  const walkovers = new Set();
  const corrected = new Set();

  // Sofort zufällig (#1590, am TV #1634): ein gezogener Platz ist keine Auslosung der Runde, sondern ein kurzer eigener
  // Moment - erkannt am Modus des Zielspiels und am Los des Platzes (Setzplätze der ersten Runde haben keins).
  const instant = (event) => {
    const match = after.get(event.matchId);
    return advancementModeOf(match) === "instant" && Boolean(slotDraw((match?.slots || [])[slotIndexOf(match, event.registrationId)]));
  };
  const rowOf = (event, index) => ({
    matchId: event.matchId, registrationId: event.registrationId, slotIndex: slotIndexOf(after.get(event.matchId), event.registrationId), index,
    ...(event.from ? { from: { matchId: event.from.matchId }, rail: event.rail || null } : null),
  });
  const assigned = events.filter((event) => event.type === "draw" && instant(event));
  const draws = events.filter((event) => event.type === "draw" && !instant(event));
  if (draws.length) {
    const rail = draws.find((event) => event.rail)?.rail || null;
    moments.push({
      type: "draw",
      rail,
      rows: draws.map(rowOf),
    });
  }
  if (assigned.length) moments.push({ type: "draw_assigned", rows: assigned.map(rowOf) });

  // Show-Auslosung bereit (#1634): eine Gruppe, die eben bereit wurde - genau einmal je Gruppe und Topf. Beim ersten Stand
  // nichts (dann steht der Hinweis gleich aus den Daten da).
  let ready = [];
  if (previous && next) {
    const was = new Set(readyDraws(previous).map((draw) => draw.key));
    ready = readyDraws(next).filter((draw) => !was.has(draw.key) && !seen.has(`draw_ready:${draw.key}:${draw.since}`));
    for (const draw of ready) seen.add(`draw_ready:${draw.key}:${draw.since}`);
    if (ready.length) moments.push({ type: "draw_ready", draws: ready, matchIds: ready.flatMap((draw) => draw.matchIds) });
  }

  const merged = events.filter((event) => event.type === "fate" && event.fate === "merged").map((event) => event.matchId);
  const moves = events.filter((event) => event.type === "merge").map((event) => ({
    matchId: event.matchId,
    registrationId: event.registrationId,
    slotIndex: slotIndexOf(after.get(event.matchId), event.registrationId),
    from: { matchId: event.from.matchId, slotIndex: slotIndexOf(before.get(event.from.matchId), event.registrationId) },
  }));
  if (merged.length || moves.length) {
    const open = [...after.values()].filter((match) => !isDone(match) && !matchFate(match) && String(match.status || "") !== "cancelled");
    const used = new Set(open.map((match) => match.station_id).filter(Boolean));
    const freed = [...new Set(merged.map((id) => before.get(id)).filter((match) => match?.station_id && !used.has(match.station_id)).map(stationName).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
    // Was derselbe Umbau streicht (abgekürzt, #1575), tritt im selben Moment zurück - kein eigenes „entfällt“.
    const dropped = events.filter((event) => event.type === "fate" && event.fate !== "merged" && after.get(event.matchId)?.result_meta?.source === "heat_rebuild").map((event) => event.matchId);
    moments.push({ type: "merge", moves, merged, freed, dropped });
  }
  const inMerge = new Set(moments.find((moment) => moment.type === "merge")?.dropped || []);

  const fates = events.filter((event) => event.type === "fate" && event.fate !== "merged" && !inMerge.has(event.matchId)).map((event) => {
    const match = after.get(event.matchId);
    const fate = matchFate(match);
    return fate ? { matchId: event.matchId, label: fate.label, name: fate.kind === "reset" ? matchRoundLabel(match) : matchName(match) } : null;
  }).filter(Boolean);
  if (fates.length) moments.push({ type: "mark", kind: "fate", items: fates });

  for (const event of events) {
    if (event.type === "walkover") walkovers.add(event.matchId);
    if (event.type === "result" && isDone(before.get(event.matchId))) corrected.add(event.matchId);
  }
  return { moments, walkovers, corrected, count: events.length + ready.length };
}
