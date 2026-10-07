// Plätze für Fledermäuse in der App (A1, #715 - wie H7 im Web, aber ohne DOM): Karten und Kacheln melden sich als
// Plätze an, wenn sie auf dem Screen sind (`SeasonPerch` in anchors.tsx), die Bühne wählt je Screen aus dem Seed
// ein bis zwei davon und trägt die Belegung ein. Karten, die vom Screen verschwinden, melden sich ab; ihre
// Fledermaus geht dann und kommt an einem anderen freien Platz wieder. Reine Logik mit Abo, ohne React.

export type PerchKind = "card" | "hero" | "tile" | "banner";
export type PerchPose = "sit" | "hang";
export type PerchCorner = "tl" | "tr" | "bottom";
export type PerchRect = { x: number; y: number; width: number; height: number };
export type Perch = {
  id: string;
  screen: string;
  kind: PerchKind;
  /** Misst das Rechteck der Karte in Fensterkoordinaten - null, wenn sie gerade nicht messbar ist. */
  measure: () => Promise<PerchRect | null>;
  /** Schneidet die Karte ab, was über ihren Rand ragt? Dann sitzt dort keine Fledermaus (sie wäre halb weg). */
  clip?: boolean;
};
export type PerchAssignment = { perchId: string; corner: PerchCorner; pose: PerchPose; size: number; temperament: string; /** nach einem Flug gelandet (Einfedern mit Haptik) */ landed?: boolean };
/** Ein kleines Netz in einer oberen Innenecke einer Karte (A4): Seite und Seed je Karte. */
export type WebAssignment = { perchId: string; side: "tl" | "tr"; seed: number; radius: number };
/**
 * Deko einer Saison an einer Karte (Jahreszeiten IV, Variante B, #1091-#1094): Lichterkette, Osterei, Luftschlange oder
 * Wimpelkette - je Karte höchstens eine, `seed` macht sie je Karte und Jahr anders.
 */
export type CardDecoKind = "chain" | "egg" | "streamer" | "garland";
export type CardDecoAssignment = { perchId: string; season: string; kind: CardDecoKind; seed: string; year: number };
export type PerchState = { perches: Perch[]; assignments: Record<string, PerchAssignment>; webs: Record<string, WebAssignment>; deco: Record<string, CardDecoAssignment> };
type Listener = (state: PerchState) => void;

/** Wie oft welche Art drankommt. Der Held (Dashboard-Kopf) etwas seltener, damit er nicht immer besetzt ist. */
export const KIND_WEIGHTS: Record<PerchKind, number> = { card: 0.4, tile: 0.3, banner: 0.2, hero: 0.1 };

const state: PerchState = { perches: [], assignments: {}, webs: {}, deco: {} };
const listeners = new Set<Listener>();

function emit() {
  // Jeder Zuhörer bekommt den aktuellen Stand - ein Zuhörer darf selbst ändern (die Bühne teilt beim Anmelden zu),
  // die Nachfolger sehen dann schon das Ergebnis statt eines veralteten Schnappschusses.
  listeners.forEach((listener) => listener(perchSnapshot()));
}

export function perchSnapshot(): PerchState {
  return { perches: [...state.perches], assignments: { ...state.assignments }, webs: { ...state.webs }, deco: { ...state.deco } };
}

export function registerPerch(perch: Perch) {
  state.perches = [...state.perches.filter((entry) => entry.id !== perch.id), perch];
  emit();
}

export function unregisterPerch(id: string) {
  const before = state.perches.length;
  state.perches = state.perches.filter((entry) => entry.id !== id);
  if (state.assignments[id]) delete state.assignments[id];
  if (state.webs[id]) delete state.webs[id];
  if (state.deco[id]) delete state.deco[id];
  if (state.perches.length !== before) emit();
}

/** Netze je Screen: ersetzt alle - Karten anderer Screens verlieren ihres. */
export function assignWebs(webs: WebAssignment[]) {
  const next: Record<string, WebAssignment> = {};
  webs.forEach((entry) => {
    next[entry.perchId] = entry;
  });
  const same = Object.keys(next).length === Object.keys(state.webs).length && Object.keys(next).every((key) => state.webs[key] && state.webs[key].seed === next[key].seed && state.webs[key].side === next[key].side);
  if (same) return;
  state.webs = next;
  emit();
}

export function websFor(screen: string): WebAssignment[] {
  return Object.values(state.webs).filter((entry) => state.perches.some((perch) => perch.id === entry.perchId && perch.screen === screen));
}

/** Auswahl der Netz-Karten je Screen: gesät aus Screen und Kartenliste, nie eine Karte mit einer Fledermaus, nie zwei Netze an derselben Karte. */
export function chooseWebPerches(candidates: Perch[], count: number, rng: () => number, taken: string[] = []): WebAssignment[] {
  const used = new Set(taken);
  const out: WebAssignment[] = [];
  for (let n = 0; n < count; n += 1) {
    const options = candidates.filter((perch) => !used.has(perch.id) && perch.kind !== "banner");
    if (!options.length) break;
    const pick = options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
    used.add(pick.id);
    out.push({ perchId: pick.id, side: rng() < 0.5 ? "tl" : "tr", seed: rng(), radius: Math.round(22 + rng() * 8) });
  }
  return out;
}

/**
 * Deko an Karten einer Saison: ersetzt alle Einträge dieser Saison (Karten anderer Screens verlieren ihre), lässt die
 * der anderen Saisons stehen.
 */
export function assignCardDeco(season: string, list: CardDecoAssignment[]) {
  const next: Record<string, CardDecoAssignment> = {};
  Object.values(state.deco).forEach((entry) => {
    if (entry.season !== season) next[entry.perchId] = entry;
  });
  list.forEach((entry) => {
    if (!next[entry.perchId]) next[entry.perchId] = entry;
  });
  const keys = Object.keys(next);
  const same = keys.length === Object.keys(state.deco).length && keys.every((key) => state.deco[key] && state.deco[key].season === next[key].season && state.deco[key].seed === next[key].seed && state.deco[key].kind === next[key].kind);
  if (same) return;
  state.deco = next;
  emit();
}

export function cardDecoFor(season: string): CardDecoAssignment[] {
  return Object.values(state.deco).filter((entry) => entry.season === season);
}

export function perchesFor(screen: string): Perch[] {
  return state.perches.filter((perch) => perch.screen === screen);
}

export function assignmentsFor(screen: string): PerchAssignment[] {
  return Object.values(state.assignments).filter((entry) => state.perches.some((perch) => perch.id === entry.perchId && perch.screen === screen));
}

export function assign(assignments: PerchAssignment[]) {
  const next: Record<string, PerchAssignment> = {};
  assignments.forEach((entry) => {
    next[entry.perchId] = entry;
  });
  state.assignments = next;
  emit();
}

export function clearAssignment(perchId: string) {
  if (!state.assignments[perchId]) return;
  delete state.assignments[perchId];
  emit();
}

export function subscribePerches(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Nur für Tests. */
export function resetPerches() {
  state.perches = [];
  state.assignments = {};
  state.webs = {};
  state.deco = {};
  emit();
}

/**
 * Auswahl: erst die Art nach Gewicht, dann ein Platz dieser Art - nie zwei an derselben Karte, gesät je Screen.
 * `taken` sind Plätze, die schon besetzt sind (bleiben besetzt und zählen als belegt).
 */
export function choosePerches(candidates: Perch[], count: number, rng: () => number, taken: string[] = []): Perch[] {
  const chosen: Perch[] = [];
  const used = new Set(taken);
  for (let n = 0; n < count; n += 1) {
    const options = candidates.filter((perch) => !used.has(perch.id));
    if (!options.length) break;
    const kinds = [...new Set(options.map((perch) => perch.kind))];
    let roll = rng() * kinds.reduce((sum, kind) => sum + (KIND_WEIGHTS[kind] || 0.1), 0);
    let kind = kinds[kinds.length - 1];
    for (let i = 0; i < kinds.length; i += 1) {
      roll -= KIND_WEIGHTS[kinds[i]] || 0.1;
      if (roll <= 0) {
        kind = kinds[i];
        break;
      }
    }
    const pool = options.filter((perch) => perch.kind === kind);
    const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    chosen.push(pick);
    used.add(pick.id);
  }
  return chosen;
}

/** Ecke und Haltung je Platz aus dem Seed: Karten oben sitzend (links oder rechts), unten hängend; Banner unten hängend. */
export function placementFor(perch: Perch, rng: () => number): { corner: PerchCorner; pose: PerchPose; size: number } {
  if (perch.kind === "banner") return { corner: "bottom", pose: "hang", size: 22 };
  const roll = rng();
  if (roll < 0.4) return { corner: "tl", pose: "sit", size: 20 };
  if (roll < 0.8) return { corner: "tr", pose: "sit", size: 20 };
  return { corner: "bottom", pose: "hang", size: 22 };
}

/** Der Punkt der Fledermaus in Fensterkoordinaten, aus dem Rechteck der Karte. */
export function perchPoint(rect: PerchRect, corner: PerchCorner, inset = 22): { x: number; y: number } {
  if (corner === "tl") return { x: rect.x + inset, y: rect.y };
  if (corner === "tr") return { x: rect.x + rect.width - inset, y: rect.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}
