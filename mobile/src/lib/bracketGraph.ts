// Der Turnierbaum als Graph (#1563): welche Linie wohin führt, was mit einem Spiel geschah, dein Weg, wohin ein Lauf
// führt und welche Bewegungen ein neuer Stand auslöst. Dieselben Regeln wie die Website (frontend/src/lib/bracketGraph.js,
// #1561/#1581) - beide prüfen dieselben Fälle auf echten Bäumen (docs/bracket-cases.json, docs/bracket-trees.json).
//
// Linien kommen aus den echten Quellen der Plätze („W:A:1“ im Ziel, `advancement` in der Quelle), nicht aus der
// Reihenfolge der Spiele - so stimmen sie auch zwischen Winner und Loser Bracket, ins Grand Final und in den Reset.
//
// Gemischte Runden (#1548/#1580, „Gegner der nächsten Runde: zufällig mischen“): die Folgespiele einer Auslosungs-Gruppe
// (`settings.draw_group`, Plätze mit `source.draw`) haben keine festen Einzel-Linien. Stattdessen eine Sammelschiene je
// Gruppe (`drawRails`): alle Quellspiele mit Ast auf die Schiene, von dort je ein Ast in jedes Zielspiel - nur innerhalb
// der Sektion. Nach der Auslosung kommt die Linie eines Platzes aus der echten Herkunft (`source_result.from_match_key`,
// Kante mit `rail`); „Dein Weg“ folgt ihr. Fester Baum: wie bisher nur echte Quellen.
import { absoluteRank, finderFor, normalizeSource, type SlotSource } from "./slotSource";

export type BracketSlot = {
  slot?: number | null;
  registration_id?: string | null;
  status?: string | null;
  source?: SlotSource;
  source_result?: { reason?: string | null; removed_registration_id?: string | null; from_match_key?: string | null; flow?: string | null; rank?: number | null; skipped?: boolean } | null;
};
export type BracketResult = { registration_id?: string | null; rank?: number | null; score?: number | null; points?: number | null; forfeit?: boolean; dnf?: boolean; no_show?: boolean; disqualified?: boolean; qualified?: boolean };
export type BracketMatch = {
  id: string;
  match_key?: string | null;
  stage_id?: string | null;
  section?: string | null;
  bracket?: string | null;
  round?: number | null;
  round_name?: string | null;
  round_label?: string | null;
  matchday_label?: string | null;
  order?: number | null;
  match_type?: string | null;
  status?: string | null;
  winner_id?: string | null;
  started_at?: string | null;
  called_at?: string | null;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  station_text?: string | null;
  group_id?: string | null;
  merged_into?: string | null;
  merged_into_key?: string | null;
  slots?: BracketSlot[] | null;
  results?: BracketResult[] | null;
  advancement?: Array<{ to_match_id?: string | null; to_slot?: number | null; flow?: string | null; rank?: number | null }> | null;
  settings?: Record<string, any> | null;
  result_meta?: { source?: string | null; reason?: string | null } | null;
  draw?: { id?: string; group?: string; drawn_at?: string } | null;
  [key: string]: unknown;
};
export type BracketEdge = { id: string; from: string; to: string; toSlot: number; flow: "W" | "L"; rank: number; cross: boolean; void: boolean; rail?: string };
export type DrawRail = { group: string; label: string; sources: Array<{ id: string; flow: "W" | "L" }>; targets: string[]; drawn: boolean };
export type MatchFate = { kind: "merged"; into: string; label: string } | { kind: "reset" | "skipped"; label: string };
export type BracketEvent = {
  key: string;
  type: "result" | "advance" | "merge" | "draw" | "walkover" | "fate";
  matchId: string;
  registrationId?: string;
  from?: { matchId: string; registrationId?: string };
  fate?: MatchFate["kind"];
  index?: number;
};

const DONE = new Set(["completed", "finished", "reported", "confirmed", "forfeit"]);
const LIVE = new Set(["running", "in_progress"]);
// Dieselben Namen wie der Server (services/round_labels.LOSER_SECTIONS).
export const LOSER_SECTIONS = new Set(["lb", "loser", "losers", "lower", "lower_bracket", "loser bracket", "looser"]);
const FINAL_SECTIONS = new Set(["gf", "grand_final"]);
const MAIN_SECTIONS = new Set(["main", "wb", "winner", "final"]);

const statusOf = (match: Pick<BracketMatch, "status"> | null | undefined) => String(match?.status || "").toLowerCase();
export const isDone = (match: Pick<BracketMatch, "status"> | null | undefined) => DONE.has(statusOf(match));
export const isLive = (match: Pick<BracketMatch, "status"> | null | undefined) => LIVE.has(statusOf(match));
export const isCancelled = (match: Pick<BracketMatch, "status"> | null | undefined) => statusOf(match) === "cancelled";

/** Grobe Lage eines Abschnitts: main, loser, final oder bronze. */
export function sectionGroup(section?: string | null): "main" | "loser" | "final" | "bronze" {
  const key = String(section || "MAIN").trim().toLowerCase();
  if (LOSER_SECTIONS.has(key)) return "loser";
  if (FINAL_SECTIONS.has(key)) return "final";
  if (key === "bronze" || key === "tp" || key.includes("third") || key.includes("platz 3")) return "bronze";
  return "main";
}

/** Was mit einem Spiel geschah: zusammengelegt, Reset nicht nötig, entfällt - oder `null`. */
export function matchFate(match: BracketMatch): MatchFate | null {
  if (!isCancelled(match)) return null;
  if (match.merged_into_key) return { kind: "merged", into: match.merged_into_key, label: `zusammengelegt in ${match.merged_into_key}` };
  if (match.result_meta?.source === "bracket_reset" || match.settings?.bracket_reset) return { kind: "reset", label: "entfällt · nicht nötig" };
  return { kind: "skipped", label: "entfällt" };
}

export function isByeSlot(slot: BracketSlot | null | undefined) {
  const status = String(slot?.status || "").toLowerCase();
  return status === "bye" || status === "walkover" || normalizeSource(slot?.source)?.type === "bye";
}

/**
 * Ein Freilos-Duell (#1259): ein Platz ist Freilos, der andere kommt kampflos weiter. Liefert `{ slot }` (der Platz,
 * der weiterkommt - mit oder ohne Anmeldung) oder `null`. Durchgänge sind nie eine Freilos-Zeile.
 */
export function soloAdvance(match: BracketMatch): { slot: BracketSlot } | null {
  if (!match || (match.match_type && match.match_type !== "duel")) return null;
  const slots = match.slots || [];
  if (slots.length !== 2) return null;
  const byes = slots.filter(isByeSlot);
  if (byes.length !== 1) return null;
  const other = slots.find((slot) => !isByeSlot(slot));
  return other ? { slot: other } : null;
}

/** Kampflos entschieden (Nichterscheinen, Aufgabe, Wertung)? */
export function isWalkover(match: BracketMatch) {
  if (statusOf(match) === "forfeit") return true;
  const source = String(match?.result_meta?.source || "").toLowerCase();
  if (["walkover", "forfeit", "no_show", "default_win"].includes(source)) return true;
  return (match?.results || []).some((row) => row?.forfeit);
}

/** Wer ausgefallen ist (Aufgabe, nicht erschienen, nicht ins Ziel). */
export function isOut(result: BracketResult | null | undefined) {
  return Boolean(result?.forfeit || result?.dnf || result?.no_show || result?.disqualified);
}

/** Die Auslosung eines Platzes (`source.draw`, #1548) - oder `null` im festen Baum. */
export function slotDraw(slot: BracketSlot | null | undefined): { group?: string; label?: string } | null {
  const draw = (slot?.source as { draw?: { group?: string; label?: string } | null } | null | undefined)?.draw;
  return draw && typeof draw === "object" ? draw : null;
}

export const drawGroupOf = (match: BracketMatch | null | undefined) => (match?.settings?.draw_group ? String(match.settings.draw_group) : null);

/**
 * Alle Linien: `{ id, from, to, toSlot, flow, rank, cross, void, rail? }`. `cross` = über die Grenze eines Abschnitts
 * (Winner → Loser Bracket, → Grand Final), `void` = das Quellspiel oder das Ziel entfällt.
 */
export function bracketEdges(matches: BracketMatch[] = [], { schema = false }: { schema?: boolean } = {}): BracketEdge[] {
  const list = (matches || []).filter(Boolean);
  const byId = new Map(list.map((match) => [match.id, match]));
  const find = finderFor(list);
  const edges = new Map<string, BracketEdge>();
  const add = (from: BracketMatch | undefined, to: BracketMatch | undefined, toSlot: unknown, flow: unknown, rawRank: unknown, rail?: string) => {
    if (!from || !to || from.id === to.id) return;
    const id = `${from.id}>${to.id}:${toSlot}`;
    if (edges.has(id)) return;
    const rank = absoluteRank({ flow: String(flow || ""), rank: Number(rawRank) }, from) || Number(rawRank) || 1;
    edges.set(id, {
      id, from: from.id, to: to.id, toSlot: Number(toSlot) || 0, flow: flow === "L" ? "L" : "W", rank,
      cross: String(from.section || "MAIN").toLowerCase() !== String(to.section || "MAIN").toLowerCase(),
      void: isCancelled(from) || isCancelled(to),
      ...(rail ? { rail } : {}),
    });
  };
  for (const to of list) {
    const group = schema ? null : drawGroupOf(to);
    for (const slot of to.slots || []) {
      const draw = schema ? null : slotDraw(slot);
      if (draw || group) {
        // Gemischt: erst die Auslosung legt die Herkunft fest - dann aus dem echten Quellspiel.
        const origin = slot.source_result?.from_match_key;
        if (slot.registration_id && origin) add(find(to)(origin) as BracketMatch | undefined, to, slot.slot, slot.source_result?.flow || normalizeSource(slot.source)?.flow, slot.source_result?.rank, String(draw?.group || group));
        continue;
      }
      const source = normalizeSource(slot?.source);
      if (source?.type !== "rank" || !source.match_key) continue;
      add(find(to)(source.match_key) as BracketMatch | undefined, to, slot.slot, source.flow, source.rank);
    }
  }
  for (const from of list) {
    for (const entry of from.advancement || []) {
      const to = byId.get(String(entry?.to_match_id || ""));
      if (!schema && drawGroupOf(to)) continue;
      add(from, to, entry?.to_slot, entry?.flow, entry?.rank);
    }
  }
  return [...edges.values()];
}

/**
 * Die Sammelschienen der gemischten Runden (#1548): je Auslosungs-Gruppe die Quellspiele (mit Fluss - Sieger oder ins
 * Loser Bracket), die Zielspiele, der Klartext („Runde 1“) und ob schon ausgelost ist. Quellen wie am Server
 * (advancement_draw.group_sources): alle Spiele, die in ein Zielspiel der Gruppe weiterleiten.
 */
export function drawRails(matches: BracketMatch[] = []): DrawRail[] {
  const list = (matches || []).filter(Boolean);
  const groups = new Map<string, BracketMatch[]>();
  for (const match of list) {
    const group = drawGroupOf(match);
    if (group) groups.set(group, [...(groups.get(group) || []), match]);
  }
  const find = finderFor(list);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, targets]) => {
    const targetIds = new Set(targets.map((match) => match.id));
    const sources = new Map<string, { id: string; flow: "W" | "L" }>();
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
          const from = source?.match_key ? (find(target)(source.match_key) as BracketMatch | undefined) : undefined;
          if (from) sources.set(`${from.id}:${source?.flow === "L" ? "L" : "W"}`, { id: from.id, flow: source?.flow === "L" ? "L" : "W" });
        }
      }
    }
    const label = targets.flatMap((target) => (target.slots || []).map(slotDraw)).find((draw) => draw?.label)?.label || "";
    // Gelost ist, wenn ein Ziel `draw` trägt oder ein Platz seine Herkunft aus dem Los hat. Ein Freilos-Platz, dessen
    // Quelle der Lauf-Umbau gestrichen hat (`source_result.skipped`, #1575), zählt nicht - der wartet weiter aufs Los.
    const drawn = targets.some((target) => target.draw || (target.slots || []).some((slot) => slotDraw(slot) && slot.source_result?.from_match_key && !slot.source_result?.skipped));
    return { group, label, sources: [...sources.values()], targets: targets.map((match) => match.id), drawn };
  });
}

/**
 * Für alte Bäume ohne Herkunft der Plätze: Linien nach der Reihenfolge wie früher (je zwei Spiele speisen eines,
 * bei gleich großen Runden je eines). `rounds` = Spiele je Runde, in Reihenfolge. `toSlot` 0 = Platz unbekannt.
 */
export function orderEdges(rounds: BracketMatch[][] = []): BracketEdge[] {
  const edges: BracketEdge[] = [];
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
export function heatExits(match: BracketMatch, edges: BracketEdge[] = [], matches: BracketMatch[] = [], rails: DrawRail[] = drawRails(matches)) {
  const byId = new Map((matches || []).map((row) => [row.id, row]));
  // Gemischt (#1548): ein Lauf führt in alle Zielspiele seiner Auslosungs-Gruppe.
  const railTargets = (flow: "W" | "L") => rails.filter((rail) => rail.sources.some((source) => source.id === match.id && source.flow === flow)).flatMap((rail) => rail.targets);
  const keys = (flow: "W" | "L") => [...new Set([
    ...edges.filter((edge) => edge.from === match.id && edge.flow === flow && !edge.void && !edge.rail).map((edge) => edge.to),
    ...railTargets(flow),
  ].filter((id) => !isCancelled(byId.get(id))).map((id) => byId.get(id)?.match_key).filter(Boolean) as string[])].sort();
  return { advance: keys("W"), drop: keys("L"), qualifiers: Number(match?.settings?.qualifiers_per_match || 0) };
}

/**
 * Die Wörter einer Lauf-Karte (#1178, #1561) - wie die Lauf-Karte der Website (BracketCards.jsx, HeatCard): „4 Spieler
 * · 2 kommen weiter“, die Linie „2 kommen weiter → E“, darunter „Die anderen → D“ oder „Die anderen scheiden aus“, freie
 * Plätze als eine Zeile. Der letzte Lauf ohne Folgespiel: „Platz 1 gewinnt“.
 */
export function heatText(match: BracketMatch, edges: BracketEdge[], matches: BracketMatch[], finalId: string | null) {
  const slots = match.slots || [];
  const free = slots.filter((slot) => !slot.registration_id && isByeSlot(slot)).length;
  const seats = slots.filter((slot) => slot.registration_id || !isByeSlot(slot)).length;
  const filled = slots.filter((slot) => slot.registration_id).length;
  const exits = heatExits(match, edges, matches);
  const count = (n: number) => `${n} ${n === 1 ? "kommt" : "kommen"} weiter`;
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

const playersOf = (match: BracketMatch | null | undefined) => new Set((match?.slots || []).map((slot) => slot?.registration_id).filter(Boolean) as string[]);

export type BracketPath = { matches: Set<string>; edges: Set<string>; ahead?: Set<string>; rails?: Set<string> };

/**
 * Dein Weg (#1177, #1561): die Spiele einer Anmeldung, die Linien zwischen ihnen und - solange ein Spiel offen ist -
 * der nächste Schritt (Linie und Zielspiel mit noch freiem Platz).
 */
export function pathFor(registrationId: string | null | undefined, matches: BracketMatch[] = [], edges: BracketEdge[] = []): BracketPath {
  const result: BracketPath = { matches: new Set(), edges: new Set() };
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
  // Gemischt, noch nicht ausgelost (#1548): der Weg führt bis zur Sammelschiene - wohin danach, entscheidet das Los.
  for (const rail of drawRails(matches)) {
    if (rail.targets.some((id) => result.matches.has(id))) continue;
    for (const source of rail.sources) {
      const from = byId.get(source.id);
      if (!result.matches.has(source.id) || isCancelled(from)) continue;
      if (source.flow === "L" && isDone(from) && winnerOf(from) === registrationId) continue;
      if (source.flow === "W" && isDone(from) && !advancedFrom(from, registrationId)) continue;
      result.rails = result.rails || new Set();
      result.rails.add(`${rail.group}:${source.id}`);
    }
  }
  return result;
}

/** Kommt die Anmeldung aus diesem fertigen Spiel weiter (Platz im Rahmen der Weiterkommer)? */
function advancedFrom(match: BracketMatch | undefined, registrationId: string) {
  const row = (match?.results || []).find((result) => result.registration_id === registrationId);
  if (!row) return false;
  const qualifiers = Math.max(1, Number(match?.settings?.qualifiers_per_match || 1));
  return Number(row.rank) > 0 && Number(row.rank) <= qualifiers && !isOut(row);
}

const resultSig = (match: BracketMatch | undefined) => (match?.results || []).map((row) => `${row.registration_id}:${row.rank ?? ""}:${row.score ?? row.points ?? ""}`).sort().join(",");

/**
 * Die Bewegungen zwischen zwei Ständen, in der Reihenfolge, in der sie laufen: `result` (Plätze poppen), `advance`
 * (Weiterkommer kommt aus dem Quellspiel), `merge` (Name aus dem zusammengelegten Lauf), `draw` (Auslosung, mit
 * laufender Nummer `index`), `walkover` (kampflos), `fate` (entfällt, zusammengelegt). Der erste Stand bewegt nichts.
 * Jede Bewegung hat einen eigenen `key` - so läuft sie genau einmal.
 */
export function diffBracket(previous: BracketMatch[] | null | undefined, next: BracketMatch[] | null | undefined): BracketEvent[] {
  if (!previous || !next) return [];
  const before = new Map(previous.map((match) => [match.id, match]));
  const nextById = new Map(next.map((match) => [match.id, match]));
  const find = finderFor(next);
  const results: BracketEvent[] = [];
  const moves: BracketEvent[] = [];
  const draws: BracketEvent[] = [];
  const marks: BracketEvent[] = [];
  const wasIn = new Set<string>();
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
      const mergedFrom = previous.find((row) => row.id !== match.id && nextById.get(row.id)?.merged_into === match.id && wasIn.has(`${row.id}:${id}`));
      if (mergedFrom) {
        moves.push({ key: `merge:${match.id}:${id}`, type: "merge", matchId: match.id, registrationId: id, from: { matchId: mergedFrom.id } });
      } else if (!drawn && source?.type === "rank" && source.match_key) {
        const from = find(match)(source.match_key) as BracketMatch | undefined;
        if (from) moves.push({ key: `advance:${match.id}:${id}`, type: "advance", matchId: match.id, registrationId: id, from: { matchId: from.id, registrationId: id } });
      } else {
        draws.push({ key: `draw:${match.id}:${id}`, type: "draw", matchId: match.id, registrationId: id });
      }
    }
  }
  draws.forEach((event, index) => { event.index = index; });
  return [...results, ...moves, ...draws, ...marks];
}

/** Spiel um Platz 3 - am Abschnitt, Rundennamen oder Kürzel erkannt (wie frontend/src/lib/bracketPodium.js). */
export function isBronzeMatch(match: BracketMatch) {
  const haystack = [match?.section, match?.bracket, match?.round_name, match?.match_key].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes("bronze") || haystack.includes("platz 3") || haystack.includes("third");
}

function lastStageMatches(matches: BracketMatch[], stages: Array<{ id?: string; number?: number }> = []) {
  const ids = [...new Set(matches.map((match) => match.stage_id || "__default"))];
  if (ids.length <= 1) return matches;
  const numbers = new Map(stages.map((stage) => [stage.id, Number(stage.number) || 0]));
  const last = ids.reduce((best, id) => ((numbers.get(id) || 0) > (numbers.get(best) || 0) ? id : best), ids[0]);
  return matches.filter((match) => (match.stage_id || "__default") === last);
}

/**
 * Das Spiel, das das Turnier entscheidet (wie bracketPodium.finalMatchOf im Web): das Grand Final, das nicht entfallen
 * ist, sonst die letzte Runde des Hauptfelds - nie das Spiel um Platz 3. `null` bei Liga, Gruppen, Swiss.
 */
export function finalMatchOf(matches: BracketMatch[] = [], stages: Array<{ id?: string; number?: number }> = []): BracketMatch | null {
  const pool = lastStageMatches(matches, stages).filter((match) => !isBronzeMatch(match) && !isCancelled(match));
  const grandFinals = pool.filter((match) => FINAL_SECTIONS.has(String(match.section || "").toLowerCase()));
  const candidates = grandFinals.length ? grandFinals : pool.filter((match) => MAIN_SECTIONS.has(String(match.section || "main").toLowerCase()));
  if (!candidates.length) return null;
  const maxRound = Math.max(...candidates.map((match) => Number(match.round || 1)));
  const lastRound = candidates.filter((match) => Number(match.round || 1) === maxRound);
  return lastRound.length === 1 ? lastRound[0] : null;
}

/** Der Sieger eines fertigen Spiels - `winner_id` oder Platz 1. */
export function winnerOf(match: BracketMatch | null | undefined): string | null {
  if (!match || !isDone(match)) return null;
  return match.winner_id || (match.results || []).find((row) => Number(row.rank) === 1)?.registration_id || null;
}
