// Der Turnierbaum als Graph (#1561): welche Linie wohin führt, was mit einem Spiel geschah, dein Weg und welche
// Bewegungen ein neuer Stand auslöst. Reine Funktionen - der Baum (components/tls/BracketTree) zeichnet daraus.
//
// Linien kommen aus den echten Quellen der Plätze („W:A:1“ im Ziel, `advancement` in der Quelle), nicht aus der
// Reihenfolge der Spiele - so stimmen sie auch zwischen Winner und Loser Bracket, ins Grand Final und in den Reset.
import { absoluteRank, finderFor, normalizeSource } from "@/lib/slotSource";

const DONE = new Set(["completed", "finished", "reported", "confirmed", "forfeit"]);
const LIVE = new Set(["running", "in_progress"]);
// Dieselben Namen wie der Server (services/round_labels.LOSER_SECTIONS) - bracketGraph.test.js hält beide gleich.
export const LOSER_SECTIONS = new Set(["lb", "loser", "losers", "lower", "lower_bracket", "loser bracket", "looser"]);
const FINAL_SECTIONS = new Set(["gf", "grand_final"]);

const statusOf = (match) => String(match?.status || "").toLowerCase();
export const isDone = (match) => DONE.has(statusOf(match));
export const isLive = (match) => LIVE.has(statusOf(match));
export const isCancelled = (match) => statusOf(match) === "cancelled";

/** Grobe Lage eines Abschnitts: main, loser, final oder bronze. */
export function sectionGroup(section) {
  const key = String(section || "MAIN").trim().toLowerCase();
  if (LOSER_SECTIONS.has(key)) return "loser";
  if (FINAL_SECTIONS.has(key)) return "final";
  if (key === "bronze" || key === "tp" || key.includes("third") || key.includes("platz 3")) return "bronze";
  return "main";
}

/** Was mit einem Spiel geschah: zusammengelegt, Reset nicht nötig, entfällt - oder `null`. */
export function matchFate(match) {
  if (!isCancelled(match)) return null;
  if (match.merged_into_key) return { kind: "merged", into: match.merged_into_key, label: `zusammengelegt in ${match.merged_into_key}` };
  const source = match.result_meta?.source;
  if (source === "bracket_reset" || match.settings?.bracket_reset) return { kind: "reset", label: "entfällt · nicht nötig" };
  return { kind: "skipped", label: "entfällt" };
}

function isByeSlot(slot) {
  const status = String(slot?.status || "").toLowerCase();
  return status === "bye" || status === "walkover" || normalizeSource(slot?.source)?.type === "bye";
}

/**
 * Ein Freilos-Duell (#1259): ein Platz ist Freilos, der andere kommt kampflos weiter. Liefert `{ slot }` (der Platz,
 * der weiterkommt - mit oder ohne Anmeldung) oder `null`. Durchgänge sind nie eine Freilos-Zeile.
 */
export function soloAdvance(match) {
  if (!match || (match.match_type && match.match_type !== "duel")) return null;
  const slots = match.slots || [];
  if (slots.length !== 2) return null;
  const byes = slots.filter(isByeSlot);
  if (byes.length !== 1) return null;
  const other = slots.find((slot) => !isByeSlot(slot));
  return other ? { slot: other } : null;
}

/** Kampflos entschieden (Nichterscheinen, Aufgabe, Wertung)? */
export function isWalkover(match) {
  if (statusOf(match) === "forfeit") return true;
  const source = String(match?.result_meta?.source || "").toLowerCase();
  if (["walkover", "forfeit", "no_show", "default_win"].includes(source)) return true;
  return (match?.results || []).some((row) => row?.forfeit);
}

/** Wer ausgefallen ist (Aufgabe, nicht erschienen, nicht ins Ziel). */
export function isOut(result) {
  return Boolean(result?.forfeit || result?.dnf || result?.no_show || result?.disqualified);
}

/**
 * Alle Linien: `{ id, from, to, toSlot, flow, rank, cross, void }`. `cross` = über die Grenze eines Abschnitts
 * (Winner → Loser Bracket, → Grand Final), `void` = das Quellspiel oder das Ziel entfällt.
 */
export function bracketEdges(matches = []) {
  const list = (matches || []).filter(Boolean);
  const byId = new Map(list.map((match) => [match.id, match]));
  const find = finderFor(list);
  const edges = new Map();
  const add = (from, to, toSlot, flow, rawRank) => {
    if (!from || !to || from.id === to.id) return;
    const id = `${from.id}>${to.id}:${toSlot}`;
    if (edges.has(id)) return;
    const rank = absoluteRank({ flow, rank: rawRank }, from) || Number(rawRank) || 1;
    edges.set(id, {
      id, from: from.id, to: to.id, toSlot: Number(toSlot) || 0, flow: flow === "L" ? "L" : "W", rank,
      cross: String(from.section || "MAIN").toLowerCase() !== String(to.section || "MAIN").toLowerCase(),
      void: isCancelled(from) || isCancelled(to),
    });
  };
  for (const to of list) {
    for (const slot of to.slots || []) {
      const source = normalizeSource(slot?.source);
      if (source?.type !== "rank" || !source.match_key) continue;
      add(find(to)(source.match_key), to, slot.slot, source.flow, source.rank);
    }
  }
  for (const from of list) {
    for (const entry of from.advancement || []) add(from, byId.get(entry?.to_match_id), entry?.to_slot, entry?.flow, entry?.rank);
  }
  return [...edges.values()];
}

/**
 * Für alte Bäume ohne Herkunft der Plätze: Linien nach der Reihenfolge wie früher (je zwei Spiele speisen eines,
 * bei gleich großen Runden je eines). `rounds` = Spiele je Runde, in Reihenfolge. `toSlot` 0 = Platz unbekannt.
 */
export function orderEdges(rounds = []) {
  const edges = [];
  for (let index = 0; index < rounds.length - 1; index += 1) {
    const from = rounds[index] || [];
    const to = rounds[index + 1] || [];
    if (!from.length || !to.length || to.length > from.length) continue;
    from.forEach((match, position) => {
      const target = to[Math.min(to.length - 1, Math.floor((position * to.length) / from.length))];
      edges.push({ id: `${match.id}>${target.id}:0`, from: match.id, to: target.id, toSlot: 0, flow: "W", rank: 1, cross: false, void: isCancelled(match) || isCancelled(target) });
    });
  }
  return edges;
}

/** Wohin ein Lauf führt (#1178): die Spiele der Weiterkommer und der anderen (Loser Bracket), dazu die Zahl. */
export function heatExits(match, edges = [], matches = []) {
  const byId = new Map((matches || []).map((row) => [row.id, row]));
  const keys = (flow) => [...new Set(edges.filter((edge) => edge.from === match.id && edge.flow === flow && !edge.void).map((edge) => byId.get(edge.to)?.match_key).filter(Boolean))];
  return { advance: keys("W"), drop: keys("L"), qualifiers: Number(match?.settings?.qualifiers_per_match || 0) };
}

const playersOf = (match) => new Set((match?.slots || []).map((slot) => slot?.registration_id).filter(Boolean));

/**
 * Dein Weg (#1177, #1561): die Spiele einer Anmeldung, die Linien zwischen ihnen und - solange ein Spiel offen ist -
 * der nächste Schritt (Linie und Zielspiel mit noch freiem Platz).
 */
export function pathFor(registrationId, matches = [], edges = []) {
  const result = { matches: new Set(), edges: new Set() };
  if (!registrationId) return result;
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  for (const match of matches || []) if (playersOf(match).has(registrationId)) result.matches.add(match.id);
  for (const edge of edges) {
    if (!result.matches.has(edge.from) || edge.void) continue;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!to) continue;
    const slot = edge.toSlot ? (to.slots || []).find((row) => Number(row.slot) === edge.toSlot) : null;
    const arrived = edge.toSlot ? slot?.registration_id === registrationId : playersOf(to).has(registrationId);
    if (arrived) {
      result.edges.add(edge.id);
    } else if (edge.toSlot && !isDone(from) && !isCancelled(from) && !slot?.registration_id) {
      result.edges.add(edge.id);
      result.ahead = result.ahead || new Set();
      result.ahead.add(to.id);
    }
  }
  if (result.ahead) for (const id of result.ahead) result.matches.add(id);
  return result;
}

/** Wurde `row` in `target` zusammengelegt? Per Kennung (Web) oder - am TV, der nur Schlüssel bekommt - per Spiel-Schlüssel. */
function mergedInto(row, target) {
  if (!row || !target) return false;
  if (row.merged_into) return row.merged_into === target.id;
  return Boolean(row.merged_into_key) && row.merged_into_key === target.match_key && (row.stage_id || "") === (target.stage_id || "");
}

const resultSig = (match) => (match?.results || []).map((row) => `${row.registration_id}:${row.rank ?? ""}:${row.score ?? row.points ?? ""}`).sort().join(",");

/**
 * Die Bewegungen zwischen zwei Ständen, in der Reihenfolge, in der sie laufen: `result` (Plätze poppen), `advance`
 * (Weiterkommer gleitet aus dem Quellspiel), `merge` (Name fließt aus dem zusammengelegten Lauf), `draw` (Auslosung,
 * mit laufender Nummer `index`), `walkover` (kampflos), `fate` (entfällt, zusammengelegt). Der erste Stand bewegt
 * nichts. Jede Bewegung hat einen eigenen `key` - so läuft sie genau einmal.
 */
export function diffBracket(previous, next) {
  if (!previous || !next) return [];
  const before = new Map(previous.map((match) => [match.id, match]));
  const nextById = new Map(next.map((match) => [match.id, match]));
  const find = finderFor(next);
  const results = [];
  const moves = [];
  const draws = [];
  const marks = [];
  // Wo jede Anmeldung vorher stand - für die Namen aus einem zusammengelegten Lauf.
  const wasIn = new Map();
  for (const match of previous) for (const id of playersOf(match)) wasIn.set(`${match.id}:${id}`, true);
  for (const match of next) {
    const old = before.get(match.id);
    if (!old) continue;
    if (isDone(match) && (!isDone(old) || resultSig(old) !== resultSig(match)) && (match.results || []).length) {
      results.push({ key: `result:${match.id}:${resultSig(match)}`, type: "result", matchId: match.id });
    }
    if (isWalkover(match) && !isWalkover(old)) marks.push({ key: `walkover:${match.id}`, type: "walkover", matchId: match.id });
    const fate = matchFate(match);
    if (fate && !matchFate(old)) marks.push({ key: `fate:${match.id}:${fate.kind}`, type: "fate", matchId: match.id, fate: fate.kind });
    const oldSlots = new Map((old.slots || []).map((slot) => [slot.slot, slot]));
    for (const slot of match.slots || []) {
      const id = slot?.registration_id;
      if (!id || oldSlots.get(slot.slot)?.registration_id === id || playersOf(old).has(id)) continue;
      const source = normalizeSource(slot.source);
      const mergedFrom = previous.find((row) => row.id !== match.id && mergedInto(nextById.get(row.id), match) && wasIn.get(`${row.id}:${id}`));
      if (mergedFrom) {
        moves.push({ key: `merge:${match.id}:${id}`, type: "merge", matchId: match.id, registrationId: id, from: { matchId: mergedFrom.id } });
      } else if (source?.type === "rank") {
        const from = find(match)(source.match_key);
        if (from) moves.push({ key: `advance:${match.id}:${id}`, type: "advance", matchId: match.id, registrationId: id, from: { matchId: from.id, registrationId: id } });
      } else {
        draws.push({ key: `draw:${match.id}:${id}`, type: "draw", matchId: match.id, registrationId: id });
      }
    }
  }
  draws.forEach((event, index) => { event.index = index; });
  return [...results, ...moves, ...draws, ...marks];
}
