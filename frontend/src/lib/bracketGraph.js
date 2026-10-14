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

/** Die Auslosung eines Platzes (`source.draw`, #1548) - oder `null` im festen Baum. */
export function slotDraw(slot) {
  const draw = slot?.source?.draw;
  return draw && typeof draw === "object" ? draw : null;
}

export const drawGroupOf = (match) => (match?.settings?.draw_group ? String(match.settings.draw_group) : null);

/**
 * Der eindeutige Schlüssel einer Sammelschiene: Phase und Gruppe (#1561). Gruppen heißen je Phase gleich („WB:2“) - mit
 * mehreren K.-o.-Phasen in einem Turnier dürfen sie sich nie vermischen.
 */
export const railKey = (stageId, group) => `${stageId || "-"}/${group}`;

/**
 * Alle Linien: `{ id, from, to, toSlot, flow, rank, cross, void, rail? }`. `cross` = über die Grenze eines Abschnitts
 * (Winner → Loser Bracket, → Grand Final), `void` = das Quellspiel oder das Ziel entfällt.
 *
 * Gemischte Runden (#1548): keine Linie aus dem Schema in einen Platz, der gelost wird. Erst die Auslosung legt die
 * Herkunft fest - dann eine Linie aus dem echten Quellspiel (`source_result.from_match_key`) mit `rail` = Gruppe; sie
 * läuft über die Sammelschiene (drawRails). Dieselbe Regel wie die App (mobile/src/lib/bracketGraph.ts) - geprüft
 * gegen docs/bracket-cases.json.
 */
export function bracketEdges(matches = []) {
  const list = (matches || []).filter(Boolean);
  const byId = new Map(list.map((match) => [match.id, match]));
  const find = finderFor(list);
  const edges = new Map();
  const add = (from, to, toSlot, flow, rawRank, rail) => {
    if (!from || !to || from.id === to.id) return;
    const id = `${from.id}>${to.id}:${toSlot}`;
    if (edges.has(id)) return;
    const rank = absoluteRank({ flow, rank: rawRank }, from) || Number(rawRank) || 1;
    edges.set(id, {
      id, from: from.id, to: to.id, toSlot: Number(toSlot) || 0, flow: flow === "L" ? "L" : "W", rank,
      cross: String(from.section || "MAIN").toLowerCase() !== String(to.section || "MAIN").toLowerCase(),
      void: isCancelled(from) || isCancelled(to),
      ...(rail ? { rail } : {}),
    });
  };
  for (const to of list) {
    const group = drawGroupOf(to);
    for (const slot of to.slots || []) {
      const draw = slotDraw(slot);
      if (draw || group) {
        const origin = slot?.source_result?.from_match_key;
        if (slot?.registration_id && origin) add(find(to)(origin), to, slot.slot, slot.source_result?.flow || normalizeSource(slot.source)?.flow, slot.source_result?.rank, railKey(to.stage_id, String(draw?.group || group)));
        continue;
      }
      const source = normalizeSource(slot?.source);
      if (source?.type !== "rank" || !source.match_key) continue;
      add(find(to)(source.match_key), to, slot.slot, source.flow, source.rank);
    }
  }
  for (const from of list) {
    for (const entry of from.advancement || []) {
      const to = byId.get(String(entry?.to_match_id || ""));
      if (drawGroupOf(to)) continue;
      add(from, to, entry?.to_slot, entry?.flow, entry?.rank);
    }
  }
  return [...edges.values()];
}

/**
 * Die Sammelschienen der gemischten Runden (#1548): je Auslosungs-Gruppe die Quellspiele (mit Fluss - Sieger oder ins
 * Loser Bracket), die Zielspiele, der Klartext („Runde 1“) und ob schon gelost ist. Quellen wie am Server
 * (advancement_draw.group_sources): alle Spiele, die in ein Zielspiel der Gruppe weiterleiten.
 * `[{ key, stageId, group, label, sources: [{ id, flow }], targets: [id], drawn }]`, nach Gruppe (dann Phase) sortiert -
 * wie die App. Je Phase getrennt: `key` = Phase und Gruppe (railKey).
 */
export function drawRails(matches = []) {
  const list = (matches || []).filter(Boolean);
  const groups = new Map();
  for (const match of list) {
    const group = drawGroupOf(match);
    if (!group) continue;
    const key = railKey(match.stage_id, group);
    if (!groups.has(key)) groups.set(key, { group, stageId: match.stage_id || null, targets: [] });
    groups.get(key).targets.push(match);
  }
  const find = finderFor(list);
  return [...groups.entries()].sort(([keyA, a], [keyB, b]) => a.group.localeCompare(b.group) || keyA.localeCompare(keyB)).map(([key, { group, stageId, targets }]) => {
    const targetIds = new Set(targets.map((match) => match.id));
    const sources = new Map();
    for (const match of list) {
      if (targetIds.has(match.id)) continue;
      for (const entry of match.advancement || []) {
        if (!targetIds.has(String(entry?.to_match_id || ""))) continue;
        const flow = entry?.flow === "L" ? "L" : "W";
        sources.set(`${match.id}:${flow}`, { id: match.id, flow });
      }
    }
    // Ältere Antworten ohne `advancement`: die Quellen aus den Plätzen.
    if (!sources.size) {
      for (const target of targets) {
        for (const slot of target.slots || []) {
          const source = normalizeSource(slot.source);
          const from = source?.match_key ? find(target)(source.match_key) : undefined;
          if (from) sources.set(`${from.id}:${source?.flow === "L" ? "L" : "W"}`, { id: from.id, flow: source?.flow === "L" ? "L" : "W" });
        }
      }
    }
    const label = targets.flatMap((target) => (target.slots || []).map(slotDraw)).find((draw) => draw?.label)?.label || "";
    // Gelost ist, wenn ein Ziel `draw` trägt oder ein Spieler schon einen Platz aus dem Los hat. Ein Freilos-Platz,
    // dessen Quelle der Umbau gestrichen hat (`source_result.skipped`, #1575), zählt nicht - der wartet weiter aufs Los.
    const drawn = targets.some((target) => target.draw || (target.slots || []).some((slot) => slotDraw(slot) && slot.source_result?.from_match_key && !slot.source_result?.skipped));
    return { key, stageId, group, label, sources: [...sources.values()], targets: targets.map((match) => match.id), drawn };
  });
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
export function heatExits(match, edges = [], matches = [], rails = drawRails(matches)) {
  const byId = new Map((matches || []).map((row) => [row.id, row]));
  // Gemischt (#1548): ein Lauf führt in alle Zielspiele seiner Auslosungs-Gruppe.
  const railTargets = (flow) => rails.filter((rail) => rail.sources.some((source) => source.id === match.id && source.flow === flow)).flatMap((rail) => rail.targets);
  const keys = (flow) => [...new Set([
    ...edges.filter((edge) => edge.from === match.id && edge.flow === flow && !edge.void && !edge.rail).map((edge) => edge.to),
    ...railTargets(flow),
  ].filter((id) => !isCancelled(byId.get(id))).map((id) => byId.get(id)?.match_key).filter(Boolean))].sort();
  return { advance: keys("W"), drop: keys("L"), qualifiers: Number(match?.settings?.qualifiers_per_match || 0) };
}

/**
 * Die Wörter einer Lauf-Karte (#1178, #1561): „4 Spieler · 2 kommen weiter“, die Linie „2 kommen weiter → E“, darunter
 * „Die anderen → D“ oder „Die anderen scheiden aus“, freie Plätze als eine Zeile. Der letzte Lauf ohne Folgespiel:
 * „Platz 1 gewinnt“. Dieselben Wörter wie die App (heatText).
 */
export function heatText(match, edges, matches, finalId) {
  const slots = match.slots || [];
  const free = slots.filter((slot) => !slot.registration_id && isByeSlot(slot)).length;
  const seats = slots.filter((slot) => slot.registration_id || !isByeSlot(slot)).length;
  const filled = slots.filter((slot) => slot.registration_id).length;
  const exits = heatExits(match, edges, matches);
  const count = (n) => `${n} ${n === 1 ? "kommt" : "kommen"} weiter`;
  const last = match.id === finalId && !exits.advance.length && !exits.drop.length;
  const field = filled === seats ? `${filled} Spieler` : filled ? `${filled} von ${seats} Spielern` : `${seats} ${seats === 1 ? "Platz" : "Plätze"}`;
  const onward = last ? "Platz 1 gewinnt" : exits.qualifiers ? count(exits.qualifiers) : "";
  return {
    name: match.match_type === "ffa" ? `Lauf ${match.match_key || ""}`.trim() : match.match_key || "Spiel",
    meta: [field, onward].filter(Boolean).join(" · "),
    cut: exits.qualifiers && exits.advance.length ? `${count(exits.qualifiers)} → ${exits.advance.join(", ")}` : "",
    rest: exits.drop.length ? `Die anderen → ${exits.drop.join(", ")}` : exits.advance.length ? "Die anderen scheiden aus" : "",
    free: free ? `${free} ${free === 1 ? "Platz" : "Plätze"} frei` : "",
  };
}

const playersOf = (match) => new Set((match?.slots || []).map((slot) => slot?.registration_id).filter(Boolean));

/**
 * Dein Weg (#1177, #1561): die Spiele einer Anmeldung, die Linien zwischen ihnen und - solange ein Spiel offen ist -
 * der nächste Schritt (Linie und Zielspiel mit noch freiem Platz). Gemischt und noch nicht gelost (#1548): der Weg
 * führt bis zur Sammelschiene (`rails`: „Gruppe:Quellspiel“) - wohin danach, entscheidet das Los.
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
  for (const rail of drawRails(matches)) {
    if (rail.targets.some((id) => result.matches.has(id))) continue;
    for (const source of rail.sources) {
      const from = byId.get(source.id);
      if (!result.matches.has(source.id) || isCancelled(from)) continue;
      if (source.flow === "L" && isDone(from) && winnerOf(from) === registrationId) continue;
      if (source.flow === "W" && isDone(from) && !advancedFrom(from, registrationId)) continue;
      result.rails = result.rails || new Set();
      result.rails.add(`${rail.key}:${source.id}`);
    }
  }
  return result;
}

/** Wurde `row` in `target` zusammengelegt? Per Kennung (Web) oder - am TV, der nur Schlüssel bekommt - per Spiel-Schlüssel. */
function mergedInto(row, target) {
  if (!row || !target) return false;
  if (row.merged_into) return row.merged_into === target.id;
  return Boolean(row.merged_into_key) && row.merged_into_key === target.match_key && (row.stage_id || "") === (target.stage_id || "");
}

/** Der Sieger eines Spiels (Platz 1 bzw. `winner_id`). */
export function winnerOf(match) {
  if (!match) return null;
  if (match.winner_id) return match.winner_id;
  return (match.results || []).find((row) => Number(row.rank) === 1)?.registration_id || null;
}

/** Kommt die Anmeldung aus diesem fertigen Spiel weiter (Platz im Rahmen der Weiterkommer)? */
function advancedFrom(match, registrationId) {
  const row = (match?.results || []).find((result) => result.registration_id === registrationId);
  if (!row) return false;
  const qualifiers = Math.max(1, Number(match?.settings?.qualifiers_per_match || 1));
  return Number(row.rank) > 0 && Number(row.rank) <= qualifiers && !isOut(row);
}

const resultSig = (match) => (match?.results || []).map((row) => `${row.registration_id}:${row.rank ?? ""}:${row.score ?? row.points ?? ""}`).sort().join(",");

/**
 * Die Bewegungen zwischen zwei Ständen, in der Reihenfolge, in der sie laufen: `result` (Plätze poppen), `advance`
 * (Weiterkommer kommt aus dem Quellspiel), `merge` (Name aus dem zusammengelegten Lauf), `draw` (Auslosung - Setzplatz
 * oder gemischte Runde, mit laufender Nummer `index`), `walkover` (kampflos), `fate` (entfällt, zusammengelegt). Der
 * erste Stand bewegt nichts. Jede Bewegung hat einen eigenen `key` - so läuft sie genau einmal. Wie die App.
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
  const wasIn = new Set();
  for (const match of previous) for (const id of playersOf(match)) wasIn.add(`${match.id}:${id}`);
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
      const drawn = Boolean(slotDraw(slot));
      const mergedFrom = previous.find((row) => row.id !== match.id && mergedInto(nextById.get(row.id), match) && wasIn.has(`${row.id}:${id}`));
      if (mergedFrom) {
        moves.push({ key: `merge:${match.id}:${id}`, type: "merge", matchId: match.id, registrationId: id, from: { matchId: mergedFrom.id } });
      } else if (!drawn && source?.type === "rank" && source.match_key) {
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
