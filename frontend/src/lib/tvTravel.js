// Weiter über den Strich (#1117) und die Beschriftung nach dem Ergebnis (#1118, #1120): wer aus einem entschiedenen Spiel
// wohin weiterzieht - von Platz zu Platz, aus der Herkunft der Plätze späterer Spiele („W:A:1“ = Sieger aus A, „L:A:1“ =
// der Beste, der in A nicht weiterkommt). Dazu der Fahrplan der Fahrten (versetzt, zusammen höchstens etwa 4 Sekunden) und
// der Weg einer Fahrt entlang der Linie.
import { absoluteRank, normalizeSource } from "@/lib/slotSource";
import { isBronzeMatch, normalizeSection } from "@/lib/bracketPodium";

const LOSER_SECTIONS = new Set(["lb", "loser"]);

/** Die Wertung eines Spiels, nach Platz sortiert (1 = Sieger). Ohne Ergebnis leer. */
export function rankingOf(match) {
  return [...(match?.results || [])]
    .filter((row) => row?.registration_id && Number(row.rank) > 0)
    .sort((a, b) => Number(a.rank) - Number(b.rank));
}

/**
 * Wer wohin weiterzieht: je Anmeldung des entschiedenen Spiels Platz, Punkte und Ziel. `kind`:
 *   „win“   weiter (im selben Strang, ins Finale oder als Weiterkommer in die nächste Phase)
 *   „drop“  ins Loser Bracket (oder ins Spiel um Platz 3)
 *   „out“   raus
 *   „place“ Endplatz - im letzten Spiel des Turniers (Finale, Spiel um Platz 3), `place` sagt welcher
 *   „none“  nichts dazu - Liga, Gruppen und Schweizer System ziehen niemanden weiter, dort zählt die Tabelle
 * `target` ist der Ziel-Platz `{ matchId, matchKey, slot, slotIndex, section, flow }` oder `null`.
 */
export function advancementsOf(match, matches = [], { lastStage = true, table = false } = {}) {
  const ranking = rankingOf(match);
  if (!ranking.length) return [];
  if (table || !match?.match_key) {
    return ranking.map((row) => ({ registrationId: row.registration_id, rank: Number(row.rank), score: row.score ?? row.points ?? null, kind: "none", place: null, target: null }));
  }
  const stage = match.stage_id || "";
  const targets = new Map();
  for (const other of matches || []) {
    if (!other || other.id === match.id || (other.stage_id || "") !== stage) continue;
    (other.slots || []).forEach((slot, slotIndex) => {
      const source = normalizeSource(slot?.source);
      if (source?.type !== "rank" || source.match_key !== match.match_key) return;
      const rank = absoluteRank(source, match);
      const row = ranking.find((entry) => Number(entry.rank) === rank);
      if (!row || targets.has(row.registration_id)) return;
      targets.set(row.registration_id, {
        matchId: other.id,
        matchKey: other.match_key,
        slot: slot?.slot ?? slotIndex + 1,
        slotIndex,
        section: other.section,
        bronze: isBronzeMatch(other),
        flow: source.flow,
      });
    });
  }
  const terminal = targets.size === 0;
  const qualifiers = Number(match?.settings?.qualifiers_per_match || 0);
  const bronze = isBronzeMatch(match);
  return ranking.map((row) => {
    const rank = Number(row.rank);
    const target = targets.get(row.registration_id) || null;
    let kind;
    if (target) kind = target.flow === "L" ? "drop" : "win";
    else if (terminal && lastStage) kind = "place";
    // Ohne Ziel in dieser Phase: Weiterkommer gehen in die nächste Phase, alle anderen sind raus.
    else kind = row.qualified || (terminal && qualifiers && rank <= qualifiers) ? "win" : "out";
    return {
      registrationId: row.registration_id,
      rank,
      score: row.score ?? row.points ?? null,
      kind,
      place: kind === "place" ? (bronze ? rank + 2 : rank) : null,
      target,
    };
  });
}

/** Die Beschriftung nach dem Ergebnis: „weiter“, „→ Loser Bracket“, „→ Spiel um Platz 3“, „raus“ oder „Platz 2“. */
export function outcomeLabel(advancement) {
  if (!advancement || advancement.kind === "none") return "";
  if (advancement.kind === "win") return "weiter";
  if (advancement.kind === "place") return `Platz ${advancement.place}`;
  if (advancement.kind === "drop") {
    if (advancement.target?.bronze) return "→ Spiel um Platz 3";
    return "→ Loser Bracket";
  }
  return "raus";
}

/** Geht die Fahrt ins Loser Bracket (gedämpfte rote Linie) oder bleibt sie im Strang? */
export function isLoserTarget(target) {
  return Boolean(target) && (target.flow === "L" || LOSER_SECTIONS.has(normalizeSection(target.section)));
}

// ---------------------------------------------------------------- Fahrplan

export const TRAVEL = Object.freeze({ maxMs: 4000, landMs: 280, stepMs: 260, dropDelayMs: 420, matchStaggerMs: 350, minRideMs: 600 });

/** Dauer einer Fahrt aus der Länge des Wegs (Bühnen-Punkte): lange Wege etwas schneller, ins Loser Bracket etwas ruhiger. */
export function rideMs(length, kind = "win") {
  const perPoint = kind === "drop" ? 1.05 : 0.75;
  return Math.round(Math.max(950, Math.min(2000, 700 + Math.max(0, length) * perPoint)));
}

/**
 * Wann jede Fahrt losgeht und wie lange sie dauert. `rides` sind `{ id, matchIndex, order, kind, length }` - `matchIndex`
 * zählt die Ergebnisse (mehrere auf einmal starten kurz versetzt), `order` die Fahrten eines Spiels (Weiterkommer zuerst).
 * Zusammen höchstens `maxMs` (mit dem Landen): wird es länger, rückt alles gleichmäßig zusammen.
 */
export function planTravel(rides = [], { maxMs = TRAVEL.maxMs } = {}) {
  const plan = rides.map((ride) => {
    const base = (ride.matchIndex || 0) * TRAVEL.matchStaggerMs;
    const inMatch = ride.kind === "win" ? (ride.order || 0) * TRAVEL.stepMs : TRAVEL.dropDelayMs + (ride.order || 0) * TRAVEL.stepMs;
    return { id: ride.id, delay: base + inMatch, duration: rideMs(ride.length, ride.kind) };
  });
  const total = travelTotal(plan);
  if (total > maxMs) {
    const factor = (maxMs - TRAVEL.landMs) / (total - TRAVEL.landMs);
    for (const entry of plan) {
      entry.delay = Math.round(entry.delay * factor);
      entry.duration = Math.max(Math.round(entry.duration * factor), Math.min(TRAVEL.minRideMs, entry.duration));
    }
    // Die Untergrenze je Fahrt kann das Ende wieder hinausschieben - dann die Starts nach vorn holen.
    const over = travelTotal(plan) - maxMs;
    if (over > 0) for (const entry of plan) entry.delay = Math.max(0, entry.delay - over);
  }
  return plan;
}

/** Bis wann alle gelandet sind (Millisekunden ab dem Start der ersten Fahrt). */
export function travelTotal(plan = []) {
  if (!plan.length) return 0;
  return Math.max(...plan.map((entry) => entry.delay + entry.duration)) + TRAVEL.landMs;
}

// ---------------------------------------------------------------- Weg einer Fahrt

/**
 * Der Weg von Platz zu Platz in Bühnen-Punkten. `from` ist die rechte Kante der Karte auf Höhe der Zeile, `to` die linke
 * Kante der Ziel-Karte auf Höhe des Ziel-Platzes. Im selben Strang fährt man die Linie entlang (waagrecht, senkrecht,
 * waagrecht wie die Verbindungslinien, Knick bei `midX`); ins Loser Bracket oder über Blöcke hinweg in einem ruhigen Bogen.
 */
export function travelRoute(from, to, { curved = false, midX = null } = {}) {
  if (!curved && to.x > from.x) {
    const mid = midX ?? from.x + (to.x - from.x) / 2;
    return { kind: "line", points: [{ ...from }, { x: mid, y: from.y }, { x: mid, y: to.y }, { ...to }] };
  }
  const dx = Math.max(40, Math.abs(to.x - from.x) * 0.5);
  const lead = to.x >= from.x ? 1 : -1;
  return { kind: "curve", points: [{ ...from }, { x: from.x + dx * lead, y: from.y }, { x: to.x - dx * lead, y: to.y }, { ...to }] };
}

/** Der Weg als SVG-Pfad. */
export function routePath(route) {
  const [a, b, c, d] = route.points;
  const f = (value) => Math.round(value * 10) / 10;
  if (route.kind === "curve") return `M${f(a.x)} ${f(a.y)}C${f(b.x)} ${f(b.y)} ${f(c.x)} ${f(c.y)} ${f(d.x)} ${f(d.y)}`;
  return `M${f(a.x)} ${f(a.y)}${route.points.slice(1).map((point) => `L${f(point.x)} ${f(point.y)}`).join("")}`;
}

function bezier(points, t) {
  const [a, b, c, d] = points;
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

/** Der Weg als Folge kurzer Stücke - für Länge und Punkte entlang des Wegs. */
function samples(route) {
  if (route.kind === "curve") return Array.from({ length: 33 }, (_, index) => bezier(route.points, index / 32));
  return route.points;
}

export function routeLength(route) {
  const list = samples(route);
  let length = 0;
  for (let index = 1; index < list.length; index += 1) length += Math.hypot(list[index].x - list[index - 1].x, list[index].y - list[index - 1].y);
  return length;
}

/** Der Punkt nach dem Anteil `t` (0 bis 1) der Weglänge. */
export function pointOnRoute(route, t) {
  const list = samples(route);
  const total = routeLength(route);
  if (!total) return { ...list[0] };
  let left = Math.max(0, Math.min(1, t)) * total;
  for (let index = 1; index < list.length; index += 1) {
    const a = list[index - 1];
    const b = list[index];
    const piece = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= piece || index === list.length - 1) {
      const share = piece ? Math.min(1, left / piece) : 1;
      return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
    }
    left -= piece;
  }
  return { ...list[list.length - 1] };
}
