// Bewegung im Turnierbaum (#1563): was sich zwischen zwei Ständen bewegt - aus dem Vergleich alter/neuer Stand
// (diffBracket, wie im Web). Sparsam: ein frisches Ergebnis poppt, wer weiterkommt (oder aus einem zusammengelegten
// Lauf kommt), gleitet in seine Zeile, kampflos und entfallene Spiele werden einmal markiert. Kein Nachholen: der erste
// Stand, eine verdeckte Seite und Riesen-Sprünge (nach einer Neuverbindung) springen sofort ans Ende.
// Auslosung als Moment (#1633, wie am TV #1634): die Show-Auslosung wird bereit (die Zielspiele heben sich nacheinander
// sanft an und leuchten gold auf), eine Runde wird ausgelost oder ein Platz sofort zufällig gezogen (die Karte hebt sich,
// die Namen kommen gestaffelt). Jeder Moment genau einmal - `seen` merkt sich die Schlüssel über alle Stände hinweg.
import { isInstantDraw, newlyReady, type ReadyDraw } from "./advancement";
import { diffBracket, finalMatchOf, isDone, winnerOf, type BracketMatch } from "./bracketGraph";

export const MAX_MOVES = 20;
export const STAGGER = 60;
/** Versatz zwischen den Zielspielen, die sich bei „Auslosung bereit“ anheben - ruhiger als die Namen. */
export const LIFT_STAGGER = 90;
const MAX_STEPS = 8;

export type RowMotion = { key: string; type: "advance" | "merge" | "draw"; delay: number };
export type CardLift = { delay: number; tone: "ready" | "draw" };
export type MotionPlan = {
  /** Spiele mit frischem Ergebnis (Plätze poppen). */
  results: Set<string>;
  /** Je Spiel die Zeilen, die ankommen: Anmeldung → Bewegung. */
  rows: Map<string, Map<string, RowMotion>>;
  walkovers: Set<string>;
  fates: Set<string>;
  /** Karten, die sich bei einer Auslosung kurz anheben und aufleuchten (gold: Topf steht, Cyan: Name gezogen). */
  lifts: Map<string, CardLift>;
  /** Show-Auslosungen, die gerade bereit wurden. */
  ready: ReadyDraw[];
  /** Sofort zufällig gezogene Plätze (für den Hinweis „Zufällig gezogen · …“). */
  assigned: Array<{ matchId: string; registrationId: string }>;
  /** Wurde ausgelost, ein Platz gezogen oder ist ein Topf bereit - dann vibriert es einmal leicht. */
  draw: boolean;
  /** Schlüssel des Stands - wechselt er, laufen die Bewegungen neu (genau einmal je Ereignis). */
  key: string;
};

export function motionPlan(
  previous: BracketMatch[] | null | undefined,
  next: BracketMatch[],
  { active, seen }: { active: boolean; seen?: Set<string> },
): MotionPlan | null {
  if (!previous || !active) return null;
  const events = diffBracket(previous, next).filter((event) => !seen?.has(event.key));
  for (const event of events) seen?.add(event.key);
  const ready = newlyReady(previous, next, seen);
  // Riesen-Sprung (nach einer Neuverbindung): die Namen springen ans Ende - ein neuer Topf darf trotzdem aufleuchten.
  const moving = events.length <= MAX_MOVES ? events : [];
  if (!moving.length && !ready.length) return null;
  const plan: MotionPlan = {
    results: new Set(), rows: new Map(), walkovers: new Set(), fates: new Set(), lifts: new Map(), ready, assigned: [], draw: ready.length > 0,
    key: [...moving.map((event) => event.key), ...ready.map((draw) => `draw_ready:${draw.key}:${draw.since}`)].join("|"),
  };
  let step = 0;
  for (const event of moving) {
    if (event.type === "result") plan.results.add(event.matchId);
    else if (event.type === "walkover") plan.walkovers.add(event.matchId);
    else if (event.type === "fate") plan.fates.add(event.matchId);
    else if (event.registrationId) {
      if (!plan.rows.has(event.matchId)) plan.rows.set(event.matchId, new Map());
      const delay = Math.min(step, MAX_STEPS - 1) * STAGGER;
      (plan.rows.get(event.matchId) as Map<string, RowMotion>).set(event.registrationId, { key: event.key, type: event.type, delay });
      step += 1;
      if (event.type === "draw") {
        // Die Karte hebt sich mit dem ersten Namen, der in ihr ankommt.
        if (!plan.lifts.has(event.matchId)) plan.lifts.set(event.matchId, { delay, tone: "draw" });
        plan.draw = true;
        if (isInstantDraw(event, next)) plan.assigned.push({ matchId: event.matchId, registrationId: event.registrationId });
      }
    }
  }
  ready.flatMap((draw) => draw.matchIds).forEach((id, index) => {
    plan.lifts.set(id, { delay: Math.min(index, MAX_STEPS - 1) * LIFT_STAGGER, tone: "ready" });
  });
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
