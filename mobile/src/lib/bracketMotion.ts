// Bewegung im Turnierbaum (#1563): was sich zwischen zwei Ständen bewegt - aus dem Vergleich alter/neuer Stand
// (diffBracket, wie im Web). Sparsam: ein frisches Ergebnis poppt, wer weiterkommt (oder aus einem zusammengelegten
// Lauf kommt), gleitet in seine Zeile, kampflos und entfallene Spiele werden einmal markiert. Kein Nachholen: der erste
// Stand, eine verdeckte Seite und Riesen-Sprünge (nach einer Neuverbindung) springen sofort ans Ende.
import { diffBracket, finalMatchOf, isDone, winnerOf, type BracketMatch } from "./bracketGraph";

export const MAX_MOVES = 20;
export const STAGGER = 60;
const MAX_STEPS = 8;

export type RowMotion = { key: string; type: "advance" | "merge" | "draw"; delay: number };
export type MotionPlan = {
  /** Spiele mit frischem Ergebnis (Plätze poppen). */
  results: Set<string>;
  /** Je Spiel die Zeilen, die ankommen: Anmeldung → Bewegung. */
  rows: Map<string, Map<string, RowMotion>>;
  walkovers: Set<string>;
  fates: Set<string>;
  /** Schlüssel des Stands - wechselt er, laufen die Bewegungen neu (genau einmal je Ereignis). */
  key: string;
};

export function motionPlan(previous: BracketMatch[] | null | undefined, next: BracketMatch[], { active }: { active: boolean }): MotionPlan | null {
  if (!previous || !active) return null;
  const events = diffBracket(previous, next);
  if (!events.length || events.length > MAX_MOVES) return null;
  const plan: MotionPlan = { results: new Set(), rows: new Map(), walkovers: new Set(), fates: new Set(), key: events.map((event) => event.key).join("|") };
  let step = 0;
  for (const event of events) {
    if (event.type === "result") plan.results.add(event.matchId);
    else if (event.type === "walkover") plan.walkovers.add(event.matchId);
    else if (event.type === "fate") plan.fates.add(event.matchId);
    else if (event.registrationId) {
      if (!plan.rows.has(event.matchId)) plan.rows.set(event.matchId, new Map());
      (plan.rows.get(event.matchId) as Map<string, RowMotion>).set(event.registrationId, { key: event.key, type: event.type, delay: Math.min(step, MAX_STEPS - 1) * STAGGER });
      step += 1;
    }
  }
  return plan;
}

/** Wurde das Finale gerade entschieden - mit dir als Sieger? Dann vibriert „Turniersieg“ und der Pokal glänzt einmal. */
export function wonJustNow(previous: BracketMatch[] | null | undefined, next: BracketMatch[], mine: string | null | undefined, stages: Array<{ id?: string; number?: number }> = []) {
  if (!previous || !mine) return false;
  const final = finalMatchOf(next, stages);
  if (!final || winnerOf(final) !== mine) return false;
  const before = previous.find((match) => match.id === final.id);
  return !isDone(before);
}
