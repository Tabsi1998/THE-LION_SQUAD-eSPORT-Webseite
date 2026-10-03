import type { PerchKind, PerchRect } from "../perches";
import type { HuntEgg, HuntPlace } from "./api";

// Wo die Eier eines Screens liegen (#647, wie placement.js im Web): der Server beschreibt ein Versteck als Art (Karte,
// Held, Kopf), Nummer und Ecke; hier wird daraus eine Karte des Screens (die Karten melden sich als Plätze an, wie
// für die Fledermäuse) und eine ihrer Ecken. „Karte N“ zählt von oben nach unten; hat ein Screen heute weniger
// Karten, geht es reihum. Der Held ist die Begrüßungskarte im Dashboard, „Kopf“ die oberste Karte. Je Ecke ein Ei;
// schon verteilte Eier bleiben, wo sie sind, solange ihre Karte da ist - nur Eier ohne Platz werden neu verteilt.

export type Corner = "tl" | "tr" | "bl" | "br";
export const PLACE_CORNERS: Record<HuntPlace, Corner> = { "top-left": "tl", "top-right": "tr", "bottom-left": "bl", "bottom-right": "br" };
const CORNER_ORDER: Corner[] = ["br", "bl", "tr", "tl"];
/** Arten, die als „Karte“ zählen (der Held hat seine eigene Art). */
const CARD_KINDS = new Set<PerchKind>(["card", "tile", "banner"]);

export type PerchInfo = { id: string; kind: PerchKind; rect: PerchRect };
export type EggSpot = { egg: HuntEgg; perchId: string; corner: Corner };

/** Die Ecken in der Reihenfolge, in der sie versucht werden: die gewünschte zuerst. */
export function cornersFor(place?: HuntPlace): Corner[] {
  const first = (place && PLACE_CORNERS[place]) || "br";
  return [first, ...CORNER_ORDER.filter((corner) => corner !== first)];
}

function rotate<T>(list: T[], start: number): T[] {
  if (!list.length) return list;
  const offset = ((start % list.length) + list.length) % list.length;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

/** Die Karten, die ein Ei der Reihe nach versucht. */
function candidates(egg: HuntEgg, sorted: PerchInfo[]): PerchInfo[] {
  const cards = sorted.filter((perch) => CARD_KINDS.has(perch.kind));
  const heroes = sorted.filter((perch) => perch.kind === "hero");
  const kind = egg.spot?.kind || "card";
  if (kind === "hero") return [...heroes, ...cards];
  if (kind === "header") return sorted;
  return [...rotate(cards, Math.max(0, Number(egg.spot?.index) || 0)), ...heroes];
}

/**
 * Verteilt die Eier auf die Karten: Ergebnis je Karte (Kennung) die Eier mit ihrer Ecke. `previous` hält schon
 * verteilte Eier fest - die bleiben, solange ihre Karte noch da ist.
 */
export function assignEggs(eggs: HuntEgg[], perches: PerchInfo[], previous: EggSpot[] = []): EggSpot[] {
  const sorted = [...perches].sort((a, b) => (Math.abs(a.rect.y - b.rect.y) > 4 ? a.rect.y - b.rect.y : a.rect.x - b.rect.x));
  const present = new Set(sorted.map((perch) => perch.id));
  const wanted = new Set(eggs.map((egg) => egg.egg_no));
  const out: EggSpot[] = [];
  const taken = new Set<string>();
  for (const spot of previous) {
    if (!present.has(spot.perchId) || !wanted.has(spot.egg.egg_no)) continue;
    const egg = eggs.find((entry) => entry.egg_no === spot.egg.egg_no) || spot.egg;
    out.push({ ...spot, egg });
    taken.add(`${spot.perchId}:${spot.corner}`);
  }
  const placed = new Set(out.map((spot) => spot.egg.egg_no));
  for (const egg of [...eggs].sort((a, b) => a.egg_no - b.egg_no)) {
    if (placed.has(egg.egg_no)) continue;
    let found: EggSpot | null = null;
    for (const perch of candidates(egg, sorted)) {
      const corner = cornersFor(egg.spot?.place).find((entry) => !taken.has(`${perch.id}:${entry}`));
      if (corner) {
        found = { egg, perchId: perch.id, corner };
        break;
      }
    }
    if (found) {
      out.push(found);
      taken.add(`${found.perchId}:${found.corner}`);
      placed.add(egg.egg_no);
    }
  }
  return out;
}
