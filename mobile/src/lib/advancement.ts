// Weiterkommen in vier Modi in der App (#1633, Web #1590, TV #1634): welcher Modus gilt, was gerade passiert („wartet
// auf Auslosung“, „Auslosung bereit · 8 Namen“, „das Los entscheidet“) und welche Momente ein neuer Stand auslöst.
// Texte und Regeln wie im Web: Modus-Namen aus den Einstellungen (pages/admin/tournament/shared.js), Erklärung wie im
// Handbuch für Spieler, der Topf wie am TV (lib/tvMoments.readyDraws/drawReadyText), der Zustand eines Spiels wie im
// Matchplan (lib/matchTimeline.drawStateOf). Reine Funktionen.
import { advancementModeOf, drawGroupOf, drawRails, sectionGroup, slotDraw, slotDrawn, type AdvancementMode, type BracketEvent, type BracketMatch } from "./bracketGraph";

const MODES: AdvancementMode[] = ["fixed", "draw_round", "draw_show", "instant"];

/** Die Namen der vier Modi - wie in den Einstellungen der Website. */
export const ADVANCEMENT_MODE_LABELS: Record<AdvancementMode, string> = {
  fixed: "Fester Baum",
  draw_round: "Auslosung nach der Runde",
  draw_show: "Show-Auslosung",
  instant: "Sofort zufällig",
};

/** Was der Modus für Spieler und Zuschauer heißt - aus den Erklärtexten der Website, ohne die Knöpfe der Leitung. */
export const ADVANCEMENT_MODE_TEXTS: Record<AdvancementMode, string> = {
  fixed: "Die Zuordnung steht im Turnierbaum: Sieger aus A trifft Sieger aus B.",
  draw_round: "Erst wenn alle Spiele einer Runde fertig sind, kommen alle Weiterkommer in einen Topf und werden gleichmäßig auf die nächsten Spiele verteilt – auch zwei aus demselben Spiel können sich wiedersehen.",
  draw_show: "Wie die Auslosung nach der Runde, nur lost erst die Turnierleitung. Bis dahin steht im Baum „Auslosung bereit“.",
  instant: "Ist ein Spiel fertig, kommt jeder Weiterkommer sofort auf einen zufälligen freien Platz der nächsten Runde. Ein Spiel kann starten, sobald es voll ist – alles kann passieren.",
};

/** Der Modus eines Turniers oder einer Phase - auch aus älteren Daten, die nur den Schalter kennen (wie im Web). */
export function modeOfSettings(source: { advancement_mode?: unknown; randomize_advancement_rounds?: unknown } | null | undefined): AdvancementMode {
  const value = source?.advancement_mode;
  if (MODES.includes(value as AdvancementMode)) return value as AdvancementMode;
  return source?.randomize_advancement_rounds === true ? "draw_round" : "fixed";
}

/**
 * Die Modi, in denen dieser Baum gespielt wird: aus den gemischten Runden (der Modus steht am Spiel), sonst der des
 * Turniers. Mehrere Phasen können verschiedene Modi haben - dann alle, in der Reihenfolge der Modi.
 */
export function treeModes(matches: BracketMatch[] = [], tournament?: { advancement_mode?: unknown; randomize_advancement_rounds?: unknown } | null): AdvancementMode[] {
  // Eine gemischte Runde ohne Modus am Spiel stammt aus der Zeit vor den vier Modi: „Auslosung nach der Runde“.
  const fromRails = new Set<AdvancementMode>(drawRails(matches).map((rail) => (rail.mode === "fixed" ? "draw_round" : rail.mode)));
  if (!fromRails.size) return [modeOfSettings(tournament)];
  return MODES.filter((mode) => fromRails.has(mode));
}

export type ReadyDraw = { key: string; group: string; label: string; matchIds: string[]; names: number; since: string };

const readyMarker = (match: BracketMatch | undefined) => (match?.draw_ready && typeof match.draw_ready === "object" ? match.draw_ready : null);

/**
 * Die Show-Auslosungen, die gerade auf das Los warten: je Gruppe `{ key, group, label, matchIds, names, since }` -
 * `names` aus dem Topf am Server (`draw_ready.pot_size`), sonst die offenen Plätze. Wie am TV (lib/tvMoments.readyDraws).
 */
export function readyDraws(matches: BracketMatch[] = []): ReadyDraw[] {
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  return drawRails(matches || []).filter((rail) => rail.ready).map((rail) => {
    const marker = rail.targets.map((id) => readyMarker(byId.get(id))).find(Boolean) || {};
    const pot = Number(marker.pot_size);
    return { key: rail.key, group: rail.group, label: rail.label, matchIds: rail.targets, names: pot > 0 ? pot : rail.open, since: String(marker.since || "") };
  });
}

/** „Auslosung bereit · 8 Namen“; warten mehrere Runden zugleich: „Auslosung bereit · 2 Runden · 16 Namen“ (wie am TV). */
export function drawReadyText(draws: Array<{ names?: number }> = []) {
  const list = draws || [];
  const names = list.reduce((sum, draw) => sum + (Number(draw.names) || 0), 0);
  const parts = ["Auslosung bereit", list.length > 1 ? `${list.length} Runden` : "", names ? `${names} ${names === 1 ? "Name" : "Namen"}` : ""];
  return parts.filter(Boolean).join(" · ");
}

export type DrawState = "ready" | "waiting" | "instant";

/**
 * Wartet das Spiel auf ein Los (wie lib/matchTimeline.drawStateOf im Web)? `ready` - Show, der Topf steht; `waiting` -
 * die Runde ist noch nicht ausgelost; `instant` - Plätze füllen sich einzeln, das Los entscheidet; sonst `null`.
 */
export function drawStateOf(match: BracketMatch | null | undefined): DrawState | null {
  if (!match || !drawGroupOf(match)) return null;
  const mode = advancementModeOf(match);
  if (mode === "instant") return (match.slots || []).some((slot) => String(slot?.status || "") === "pending" && slotDraw(slot) && !slotDrawn(slot)) ? "instant" : null;
  if (match.draw && typeof match.draw === "object") return null;
  if ((match.slots || []).some(slotDrawn)) return null;
  return mode === "draw_show" && match.draw_ready && typeof match.draw_ready === "object" ? "ready" : "waiting";
}

/** Der Zustand in Worten - wie im Baum und im Matchplan der Website. */
export const DRAW_STATE_TEXT: Record<DrawState, string> = {
  ready: "Auslosung bereit",
  waiting: "wartet auf Auslosung",
  instant: "das Los entscheidet",
};

export type DrawStatus = { key: string; round: string; text: string; tone: DrawState };

/**
 * Was gerade passiert, je Abschnitt die nächste gemischte Runde (Winner und Loser Bracket getrennt): „Halbfinale ·
 * wartet auf Auslosung“, „… · Auslosung bereit · 4 Namen“, sofort zufällig „das Los entscheidet“ bzw. „3 von 8
 * zufällig gezogen“. Fertig geloste Runden sagen nichts mehr. `labels`: die Rundennamen, wie der Baum sie zeigt.
 */
export function drawStatusLines(matches: BracketMatch[] = [], labels: Map<string, string> = new Map()): DrawStatus[] {
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  const next = new Map<string, { round: number; status: DrawStatus }>();
  for (const rail of drawRails(matches)) {
    const first = byId.get(rail.targets[0]);
    if (!first) continue;
    let tone: DrawState | null = null;
    let text = "";
    if (rail.mode === "instant") {
      if (rail.open > 0) {
        tone = "instant";
        text = rail.assigned ? `${rail.assigned} von ${rail.assigned + rail.open} zufällig gezogen` : DRAW_STATE_TEXT.instant;
      }
    } else if (!rail.drawn) {
      tone = rail.ready ? "ready" : "waiting";
      text = rail.ready ? drawReadyText(readyDraws(matches).filter((draw) => draw.key === rail.key)) : DRAW_STATE_TEXT.waiting;
    }
    if (!tone) continue;
    const where = `${rail.stageId || "-"}|${sectionGroup(first.section)}`;
    const round = Number(first.round) || 0;
    const current = next.get(where);
    if (current && current.round <= round) continue;
    next.set(where, { round, status: { key: rail.key, round: labels.get(first.id) || first.round_label || "", text, tone } });
  }
  return [...next.values()].map((entry) => entry.status);
}

/** Ist dieser neue Platz sofort zufällig gezogen (Modus des Zielspiels und Los am Platz) - wie am TV? */
export function isInstantDraw(event: BracketEvent, matches: BracketMatch[]) {
  if (event.type !== "draw" || !event.registrationId) return false;
  const match = matches.find((row) => row.id === event.matchId);
  if (advancementModeOf(match) !== "instant") return false;
  return Boolean(slotDraw((match?.slots || []).find((slot) => slot.registration_id === event.registrationId)));
}

/**
 * Show-Auslosungen, die mit diesem Stand bereit wurden - genau einmal je Gruppe und Topf (`seen` merkt
 * `draw_ready:<Schiene>:<seit>`). Beim ersten Stand nichts: dann steht der Hinweis gleich aus den Daten da.
 */
export function newlyReady(previous: BracketMatch[] | null | undefined, next: BracketMatch[], seen?: Set<string>): ReadyDraw[] {
  if (!previous) return [];
  const was = new Set(readyDraws(previous).map((draw) => draw.key));
  const ready = readyDraws(next).filter((draw) => !was.has(draw.key) && !seen?.has(`draw_ready:${draw.key}:${draw.since}`));
  for (const draw of ready) seen?.add(`draw_ready:${draw.key}:${draw.since}`);
  return ready;
}
