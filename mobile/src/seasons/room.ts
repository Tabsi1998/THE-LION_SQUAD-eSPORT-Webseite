// Platz für Deko (#1295): Die App hat kein `elementsFromPoint` wie das Web (cardDeco.js `boxFree`, `bandGaps`) - darum
// melden sich Schrift, Knöpfe und Karten selbst an (`useRoomProbe`), solange eine Saison mit Deko läuft. Deko an einer
// Karte prüft nach dem Zuteilen, ob ihr Kasten frei ist (`useRoomCheck`): Kette und Wimpel im Band an der Unterkante,
// Ei und Luftschlange über der Oberkante, das Netz in der oberen Innenecke, die Fledermaus auf der Ecke oder unter der
// Kante. Ist er belegt, merkt sich der Laden das (`markBlocked`), und die Saison nimmt eine andere Ecke oder Karte.
// Ohne Messung (Tests, abgebaute Ansicht) gilt der Platz als frei - wie im Web ohne Sonde. Reine Logik mit Abo, ohne
// React; die Haken stehen in useRoom.ts.

export type RoomRect = { x: number; y: number; width: number; height: number };
/** text: jede Zeile Schrift (auch Überschriften und Augenbrauen); control: Knöpfe; card: der Kasten einer Karte. */
export type RoomKind = "text" | "control" | "card";
export type RoomEntry = {
  id: string;
  screen: string;
  /** Die Karte, in der der Inhalt liegt (ihr Platz-Schlüssel) - bei `card` die Karte selbst; null außerhalb. */
  card: string | null;
  kind: RoomKind;
  /** Die Rechtecke in Fensterkoordinaten (Schrift: je Zeile) - null, wenn gerade nicht messbar. */
  measure: () => Promise<RoomRect[] | null>;
};
type Listener = () => void;

/** Abstand, den Deko zu Schrift, Knöpfen und fremden Karten hält (Punkte). */
export const ROOM_PAD = 2;
/** So lange wartet eine Prüfung nach dem Zuteilen - erst dann stehen Karte und Schrift (ms). */
export const ROOM_SETTLE_MS = 120;
/**
 * Das Band für Kette und Wimpel in der App (#1295): es beginnt 10 Punkte über der Unterkante - unter den 14 Punkten
 * Innenabstand der Karten, mit Luft zur letzten Zeile - und hängt über die Kante hinaus. Im Web beginnt es 16 px
 * darüber (dort haben Karten mehr Innenabstand).
 */
export const HANG_BAND = 10;

const entries = new Map<string, RoomEntry>();
/** Messungen eines Screens für kurze Zeit merken: beim Betreten prüfen mehrere Deko-Teile fast gleichzeitig. */
const MEASURE_REUSE_MS = 200;
const measured = new Map<string, { at: number; promise: Promise<Array<{ entry: RoomEntry; rects: RoomRect[] }>> }>();
const blocked = new Map<string, Set<string>>();
const listeners = new Set<Listener>();
let probe = false;
const probeListeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Sollen sich Schrift, Knöpfe und Karten melden? Nur solange eine Saison Deko an Inhalt hängt. */
export function setRoomProbe(on: boolean) {
  if (probe === on) return;
  probe = on;
  probeListeners.forEach((listener) => listener());
}

export function roomProbeOn(): boolean {
  return probe;
}

export function subscribeRoomProbe(listener: Listener): () => void {
  probeListeners.add(listener);
  return () => {
    probeListeners.delete(listener);
  };
}

export function registerRoom(entry: RoomEntry) {
  entries.set(entry.id, entry);
  measured.delete(entry.screen);
}

export function unregisterRoom(id: string) {
  const entry = entries.get(id);
  entries.delete(id);
  if (entry) measured.delete(entry.screen);
}

export function roomEntries(screen: string): RoomEntry[] {
  return [...entries.values()].filter((entry) => entry.screen === screen);
}

/** Eine Deko (`use`, etwa „chain“ oder „bat:tl“) passt an dieser Karte nicht hin - die Saison wählt neu. */
export function markBlocked(perchId: string, use: string) {
  const set = blocked.get(perchId) || new Set<string>();
  if (set.has(use)) return;
  set.add(use);
  blocked.set(perchId, set);
  emit();
}

export function isBlocked(perchId: string, use: string): boolean {
  return Boolean(blocked.get(perchId)?.has(use));
}

/** Eine Karte verlässt den Screen: ihr Urteil gilt beim nächsten Mal nicht mehr (der Inhalt kann anders sein). */
export function forgetBlocked(perchId: string) {
  if (blocked.delete(perchId)) emit();
}

export function subscribeRoom(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Nur für Tests. */
export function resetRoom() {
  entries.clear();
  measured.clear();
  blocked.clear();
  probe = false;
  probeListeners.forEach((listener) => listener());
  emit();
}

// ------------------------------------------------------------------ Geometrie

/** Überschneiden sich zwei Rechtecke (mit Rand `pad`)? Berühren ist kein Überschneiden. */
export function overlaps(a: RoomRect, b: RoomRect, pad = 0): boolean {
  return a.x < b.x + b.width + pad && a.x + a.width > b.x - pad && a.y < b.y + b.height + pad && a.y + a.height > b.y - pad;
}

/** Ist der Kasten frei von allen Rechtecken (mit Rand)? Leere Rechtecke zählen nicht. */
export function boxFree(box: RoomRect, rects: RoomRect[], pad = ROOM_PAD): boolean {
  return !rects.some((rect) => rect.width > 0 && rect.height > 0 && overlaps(box, rect, pad));
}

/** Liegt `inner` ganz in `outer`? (Eine Karte in einer anderen Karte: die äußere sperrt die innere nicht.) */
export function contains(outer: RoomRect, inner: RoomRect): boolean {
  return inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
}

/** Das Band an der Unterkante: beginnt `fromBottom` Punkte über der Kante und ist `height` hoch (ragt also hinaus). */
export function bandBox(card: RoomRect, fromBottom: number, height: number): RoomRect {
  return { x: card.x, y: card.y + card.height - fromBottom, width: card.width, height };
}

/** Der Streifen über der Oberkante (Ei, Schlaufen der Luftschlange), `rise` Punkte hoch. */
export function topBox(card: RoomRect, rise: number): RoomRect {
  return { x: card.x, y: card.y - rise, width: card.width, height: rise };
}

/** Der Kasten eines Netzes in einer oberen Innenecke. */
export function cornerBox(card: RoomRect, side: "tl" | "tr", width: number, height: number): RoomRect {
  return { x: side === "tl" ? card.x : card.x + card.width - width, y: card.y, width, height };
}

/** Der Kasten einer Fledermaus: sitzend über einer oberen Ecke (Einzug `inset`), hängend unter der Mitte der Unterkante. */
export function batBox(card: RoomRect, corner: "tl" | "tr" | "bottom", size: number, shapeHeight: number, inset = 22): RoomRect {
  if (corner === "bottom") return { x: card.x + card.width / 2 - size / 2, y: card.y + card.height - 1, width: size, height: shapeHeight };
  const x = corner === "tl" ? card.x + inset - size / 2 : card.x + card.width - inset - size / 2;
  return { x, y: card.y - shapeHeight + 1, width: size, height: shapeHeight };
}

/**
 * Was Deko an der Karte `perchId` sperrt: Schrift und Knöpfe überall auf dem Screen (auch in der Karte selbst) und
 * fremde Karten - nicht die eigene Karte und keine, die sie umschließt.
 */
function measureScreen(screen: string): Promise<Array<{ entry: RoomEntry; rects: RoomRect[] }>> {
  const now = Date.now();
  const hit = measured.get(screen);
  if (hit && now - hit.at < MEASURE_REUSE_MS) return hit.promise;
  const promise = Promise.all(roomEntries(screen).map(async (entry) => ({ entry, rects: (await entry.measure()) || [] })));
  measured.set(screen, { at: now, promise });
  return promise;
}

export async function blockersFor(screen: string, perchId: string, card: RoomRect): Promise<RoomRect[]> {
  const list = await measureScreen(screen);
  return list.flatMap(({ entry, rects }) => {
    if (entry.kind !== "card") return rects;
    if (entry.card === perchId) return [];
    return rects.filter((rect) => !contains(rect, card));
  });
}

/**
 * Passt Deko mit diesen Kästen an die Karte? `measureCard` misst die Karte (Fensterkoordinaten). Ergebnis: true (frei),
 * false (belegt) oder null (nicht messbar - dann entscheidet niemand, die Deko bleibt).
 */
export async function checkRoom(screen: string, perchId: string, measureCard: () => Promise<RoomRect | null>, boxesOf: (card: RoomRect) => RoomRect[], pad = ROOM_PAD): Promise<boolean | null> {
  const card = await measureCard();
  if (!card) return null;
  const boxes = boxesOf(card);
  if (!boxes.length) return true;
  const rects = await blockersFor(screen, perchId, card);
  return boxes.every((box) => boxFree(box, rects, pad));
}
