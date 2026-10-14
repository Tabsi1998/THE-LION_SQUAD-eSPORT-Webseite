// Baum mit Linien (#1563): wo jede Karte steht und wie jede Linie läuft - reine Rechnung, ohne Messen. Runden sind
// Spalten (die Rundennummer des Generators zählt über Winner und Loser Bracket hinweg, so laufen Linien nach rechts).
// Oben das Hauptfeld, darunter das Loser Bracket, Grand Final und Pokal rechts auf Höhe ihrer Quellen. Ein Spiel der
// nächsten Runde steht mittig zwischen seinen Quellen; nichts überdeckt sich. Linien sind rechtwinklig, knicken in der
// Gasse vor dem Ziel und enden an der Zeile des Platzes, in den der Spieler kommt (`anchorY`).
import { isCancelled, sectionGroup, type BracketEdge, type BracketMatch } from "./bracketGraph";

export const TROPHY_ID = "__trophy";
export const CARD_W = 204;
export const COL_GAP = 44;
export const ROW_GAP = 14;
export const HEADER_H = 28;
export const BAND_GAP = 34;
export const TROPHY_H = 92;
/** Platz für „Winner Bracket“ / „Loser Bracket“ über den Spaltenköpfen. */
export const BAND_LABEL_H = 18;

export type LayoutNode = { id: string; x: number; y: number; w: number; h: number; col: number; band: Band };
export type LayoutLine = { id: string; from: string; to: string; toSlot: number; flow: "W" | "L"; cross: boolean; void: boolean; d: string };
export type BracketLayout = {
  width: number;
  height: number;
  nodes: Map<string, LayoutNode>;
  lines: LayoutLine[];
  headers: Array<{ key: string; x: number; y: number; w: number; matchIds: string[] }>;
  bands: Array<{ label: string; y: number }>;
};
type Band = "main" | "loser" | "final" | "trophy";
type Options = {
  heightOf: (match: BracketMatch) => number;
  /** Höhe der Zeile eines Platzes in der Karte (vom oberen Rand der Karte). */
  anchorY: (match: BracketMatch, slot: number) => number;
  finalId: string | null;
  cardWidth?: number;
};

const bandOf = (match: BracketMatch): Band => {
  const group = sectionGroup(match.section);
  return group === "loser" ? "loser" : group === "final" ? "final" : "main";
};
const round1 = (value: number) => Math.round(value * 10) / 10;

export function layoutBracket(matches: BracketMatch[], edges: BracketEdge[], { heightOf, anchorY, finalId, cardWidth = CARD_W }: Options): BracketLayout {
  const nodes = new Map<string, LayoutNode>();
  const headers: BracketLayout["headers"] = [];
  const bands: BracketLayout["bands"] = [];
  if (!matches.length) return { width: 0, height: 0, nodes, lines: [], headers, bands };

  const rounds = [...new Set(matches.map((match) => Number(match.round) || 1))].sort((a, b) => a - b);
  const colOf = new Map(rounds.map((round, index) => [round, index]));
  const columnOf = (match: BracketMatch) => colOf.get(Number(match.round) || 1) || 0;
  const xOf = (col: number) => col * (cardWidth + COL_GAP);
  const byId = new Map(matches.map((match) => [match.id, match]));
  const sourcesOf = new Map<string, string[]>();
  for (const edge of edges) sourcesOf.set(edge.to, [...(sourcesOf.get(edge.to) || []), edge.from]);
  const colBottom = new Map<number, number>();

  const center = (id: string) => {
    const node = nodes.get(id);
    return node ? node.y + node.h / 2 : null;
  };
  const desiredOf = (id: string, height: number) => {
    const centers = [...new Set(sourcesOf.get(id) || [])].map(center).filter((value): value is number => value !== null);
    return centers.length ? centers.reduce((sum, value) => sum + value, 0) / centers.length - height / 2 : -Infinity;
  };
  const place = (id: string, col: number, band: Band, height: number, desired: number, minY: number) => {
    const below = colBottom.has(col) ? (colBottom.get(col) as number) + ROW_GAP : -Infinity;
    const y = Math.max(desired, minY, below);
    nodes.set(id, { id, x: xOf(col), y, w: cardWidth, h: height, col, band });
    colBottom.set(col, y + height);
  };

  const finalMatch = finalId ? byId.get(finalId) : undefined;
  const trophyCol = finalMatch ? columnOf(finalMatch) + 1 : -1;
  let trophyPlaced = false;
  const placeTrophy = () => {
    if (!finalMatch || trophyPlaced) return;
    trophyPlaced = true;
    const finalCenter = center(finalMatch.id) ?? HEADER_H;
    place(TROPHY_ID, trophyCol, "trophy", TROPHY_H, finalCenter - TROPHY_H / 2, labelH + HEADER_H);
  };

  const hasLoser = matches.some((match) => bandOf(match) === "loser");
  const labelH = hasLoser ? BAND_LABEL_H : 0;
  const placeBand = (band: Band, top: number) => {
    const members = matches.filter((match) => bandOf(match) === band);
    if (!members.length) return top;
    const cols = [...new Set(members.map(columnOf))].sort((a, b) => a - b);
    for (const col of cols) {
      if (band === "final" && col >= trophyCol) placeTrophy();
      const inCol = members.filter((match) => columnOf(match) === col);
      headers.push({ key: `${band}:${col}`, x: xOf(col), y: top + labelH, w: cardWidth, matchIds: [...inCol].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).map((match) => match.id) });
      const ranked = inCol.map((match) => ({ match, height: heightOf(match), desired: desiredOf(match.id, heightOf(match)) }))
        .sort((a, b) => (a.desired === b.desired ? (Number(a.match.order) || 0) - (Number(b.match.order) || 0) : a.desired - b.desired));
      for (const row of ranked) place(row.match.id, col, band, row.height, row.desired, top + labelH + HEADER_H);
    }
    return Math.max(...members.map((match) => (nodes.get(match.id) as LayoutNode).y + (nodes.get(match.id) as LayoutNode).h));
  };

  const mainBottom = placeBand("main", 0);
  if (hasLoser) {
    bands.push({ label: "Winner Bracket", y: 0 });
    const loserTop = mainBottom + BAND_GAP;
    bands.push({ label: "Loser Bracket", y: loserTop });
    placeBand("loser", loserTop);
  }
  placeBand("final", 0);
  placeTrophy();

  // Linien: rechtwinklig, Knick in der Gasse vor dem Ziel; nach links oder in derselben Spalte über eine freie Bahn
  // unter den betroffenen Spalten.
  const lines: LayoutLine[] = [];
  const draw = (from: LayoutNode, to: LayoutNode, toY: number) => {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    if (to.col > from.col) {
      const xm = x2 - COL_GAP / 2;
      return y1 === toY ? `M${round1(x1)} ${round1(y1)} L${round1(x2)} ${round1(toY)}` : `M${round1(x1)} ${round1(y1)} L${round1(xm)} ${round1(y1)} L${round1(xm)} ${round1(toY)} L${round1(x2)} ${round1(toY)}`;
    }
    const lo = Math.min(from.col, to.col);
    const hi = Math.max(from.col, to.col);
    const lane = Math.max(...[...nodes.values()].filter((node) => node.col >= lo && node.col <= hi + 1).map((node) => node.y + node.h)) + ROW_GAP / 2;
    const xo = x1 + COL_GAP / 2;
    const xi = x2 - COL_GAP / 2;
    return [`M${round1(x1)} ${round1(y1)}`, `L${round1(xo)} ${round1(y1)}`, `L${round1(xo)} ${round1(lane)}`, `L${round1(xi)} ${round1(lane)}`, `L${round1(xi)} ${round1(toY)}`, `L${round1(x2)} ${round1(toY)}`].join(" ");
  };
  for (const edge of edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    const target = byId.get(edge.to);
    if (!from || !to || !target) continue;
    const toY = to.y + (edge.toSlot ? anchorY(target, edge.toSlot) : to.h / 2);
    lines.push({ id: edge.id, from: edge.from, to: edge.to, toSlot: edge.toSlot, flow: edge.flow, cross: edge.cross, void: edge.void, d: draw(from, to, toY) });
  }
  const trophy = nodes.get(TROPHY_ID);
  const final = finalMatch ? nodes.get(finalMatch.id) : undefined;
  if (trophy && final && finalMatch) {
    lines.push({ id: `${finalMatch.id}>${TROPHY_ID}`, from: finalMatch.id, to: TROPHY_ID, toSlot: 0, flow: "W", cross: false, void: isCancelled(finalMatch), d: draw(final, trophy, trophy.y + trophy.h / 2) });
  }

  const all = [...nodes.values()];
  return {
    width: Math.max(...all.map((node) => node.x + node.w)),
    height: Math.max(...all.map((node) => node.y + node.h)) + ROW_GAP,
    nodes,
    lines,
    headers,
    bands,
  };
}
