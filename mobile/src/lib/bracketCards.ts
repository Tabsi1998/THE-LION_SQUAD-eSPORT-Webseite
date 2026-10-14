// Die Karten im Turnierbaum (#1563): was eine Karte zeigt und wie hoch sie ist. Die Höhen sind fest (kein Messen) -
// so rechnet bracketLayout die Lage und jede Linie endet genau an der Zeile des Platzes, in den der Spieler kommt.
// Ruhig wie im Web (#1561): Duell mit zwei Zeilen, Lauf mit Plätzen und der Linie „2 kommen weiter → E“, Freilos und
// entfallene Spiele als eine Zeile.
import { heatText, isByeSlot, isDone, isOut, isWalkover, matchFate, slotDraw, type BracketEdge, type BracketMatch, type BracketSlot } from "./bracketGraph";
import { describeSlot } from "./slotSource";
import { byeLine } from "./tournamentView";

export const HEAD_H = 30;
export const META_H = 22;
export const ROW_H = 32;
export const ROW_TALL = 46;
export const LINE_H = 24;
export const SINGLE_H = 44;
/** Ab so vielen Zeichen bekommt ein Name zwei Zeilen statt drei Punkte. */
export const LONG_NAME = 20;
const OUT_STATUSES = new Set(["withdrawn", "disqualified", "no_show"]);

export type CardRow = {
  key: string;
  slot: number;
  registrationId: string | null;
  label: string;
  pending: boolean;
  result: string;
  winner: boolean;
  loser: boolean;
  qualified: boolean;
  out: boolean;
  mine: boolean;
};
export type CardContext = {
  nameOf: (id: string) => string;
  statusOf: (id: string) => string;
  finder: (match: BracketMatch) => (key: string) => any;
  edges: BracketEdge[];
  matches: BracketMatch[];
  finalId: string | null;
  mine: string | null;
};
export type CardModel = {
  id: string;
  key: string;
  kind: "duel" | "heat" | "bye" | "fate";
  title: string;
  height: number;
  rowHeight: number;
  rows: CardRow[];
  /** Index der letzten Zeile vor der Trennlinie „2 kommen weiter → E“ (-1: keine). */
  cutAfter: number;
  text: ReturnType<typeof heatText>;
  line: { tag?: string; text: string; registrationId?: string | null } | null;
  walkover: boolean;
  mine: boolean;
  empty: boolean;
  anchor: (slot: number) => number;
};

const scoreText = (value: unknown) => {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? "" : String(Math.round(number * 10) / 10).replace(".", ",");
};

export function cardModel(match: BracketMatch, ctx: CardContext): CardModel {
  const isHeat = match.match_type === "ffa" || (match.slots || []).length > 2;
  const key = String(match.match_key || "");
  const title = isHeat ? `Lauf ${key}`.trim() : key || "Spiel";
  const text = heatText(match, ctx.edges, ctx.matches, ctx.finalId);
  const base = { id: match.id, key, title, text, cutAfter: -1, rows: [] as CardRow[], rowHeight: ROW_H, walkover: false, empty: false };
  const single = (kind: "bye" | "fate", line: CardModel["line"], mine: boolean): CardModel => ({ ...base, kind, height: SINGLE_H, line, mine, anchor: () => SINGLE_H / 2 });

  const fate = matchFate(match);
  if (fate) return single("fate", { text: fate.label }, false);
  const bye = byeLine(match, ctx.nameOf);
  if (bye) return single("bye", bye, Boolean(ctx.mine) && bye.registrationId === ctx.mine);

  const done = isDone(match);
  const walkover = isWalkover(match);
  const results = new Map((match.results || []).map((row) => [row.registration_id, row]));
  const findMatch = ctx.finder(match);
  const qualifiers = Number(match.settings?.qualifiers_per_match || 0);
  let slots: BracketSlot[] = [...(match.slots || [])];
  if (isHeat) {
    slots = slots.filter((slot) => slot.registration_id || !isByeSlot(slot));
    if (results.size) slots.sort((a, b) => (Number(results.get(a.registration_id)?.rank) || 99) - (Number(results.get(b.registration_id)?.rank) || 99));
  } else {
    slots = slots.slice(0, 2);
    while (slots.length < 2) slots.push({ slot: slots.length + 1, registration_id: null, status: "empty" });
  }
  const rows: CardRow[] = slots.map((slot, index) => {
    const id = slot.registration_id || null;
    // Gemischt (#1548): bis zur Auslosung „Platz aus Runde 1“ - wie slotSource ab #1580, auch für ältere Stände.
    const draw = slotDraw(slot);
    const view = draw && !slot.registration_id && !isByeSlot(slot)
      ? { kind: "pending" as const, label: `Platz aus ${draw.label || "der Vorrunde"}` }
      : describeSlot(slot, ctx.nameOf, findMatch);
    const result = id ? results.get(id) : undefined;
    const rank = Number(result?.rank) || 0;
    const winner = done && Boolean(id) && (rank === 1 || match.winner_id === id);
    const qualified = isHeat && done && Boolean(rank) && qualifiers > 0 && rank <= qualifiers;
    const score = scoreText(result?.score ?? result?.points);
    return {
      key: `${slot.slot ?? index}`,
      slot: Number(slot.slot) || index + 1,
      registrationId: id,
      label: view.label || (view.kind === "player" ? "Teilnehmer" : view.kind === "bye" ? "Freilos" : ""),
      pending: view.kind === "pending",
      result: isHeat ? (rank ? `#${rank}` : "") : score,
      winner: isHeat ? qualified || (done && rank === 1) : winner,
      loser: done && Boolean(id) && (isHeat ? !qualified && rank !== 1 : !winner),
      qualified,
      out: Boolean(id) && (isOut(result) || OUT_STATUSES.has(ctx.statusOf(id as string))),
      mine: Boolean(ctx.mine) && id === ctx.mine,
    };
  });
  const rowHeight = rows.some((row) => row.label.length > LONG_NAME) ? ROW_TALL : ROW_H;
  const cutAfter = isHeat && results.size && text.cut && rows.length > qualifiers && qualifiers > 0 ? qualifiers - 1 : -1;
  const empty = isHeat && !rows.some((row) => row.label);
  const top = HEAD_H + (isHeat ? META_H : 0);
  const extra = isHeat ? (cutAfter >= 0 ? LINE_H : 0) + (text.free ? LINE_H : 0) + (cutAfter >= 0 && text.rest ? LINE_H : 0) + (empty ? LINE_H : 0) : 0;
  const height = top + (empty ? 0 : rows.length * rowHeight) + extra;
  const anchor = (slotNumber: number) => {
    const index = empty ? -1 : rows.findIndex((row) => row.slot === slotNumber);
    if (index < 0) return Math.min(height - LINE_H / 2, top + rows.length * rowHeight + LINE_H / 2);
    return top + index * rowHeight + (cutAfter >= 0 && index > cutAfter ? LINE_H : 0) + rowHeight / 2;
  };
  return {
    ...base,
    kind: isHeat ? "heat" : "duel",
    height,
    rowHeight,
    rows: empty ? [] : rows,
    cutAfter,
    line: null,
    walkover,
    mine: rows.some((row) => row.mine),
    empty,
    anchor,
  };
}
