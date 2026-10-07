import type { GestureResponderEvent } from "react-native";
import { getMotionScheduler, releaseMotion, requestMotion, type EffectKind, type MotionToken } from "./motion";

// Karten-Signal in der App (Jahreszeiten IV, #1087 - wie frontend/src/seasons/cardLift.js): Im Web hebt sich eine Karte
// beim Drüberfahren, in der App wird sie angetippt. Die Deko einer Saison, die an genau dieser Karte hängt
// (Schneehaube, Eck-Netz, Fledermaus, Osterei der Suche), reagiert - jede Saison auf ihre Art. Hier liegt nur das
// gemeinsame Signal:
//
// - „lift“ mit dem Schlüssel der Karte (ihre Platz-Kennung, `Card perch="..."`), sobald klar ist, dass der Finger die
//   Karte meint: beim Loslassen eines Tippens oder nach einer Viertelsekunde ruhigem Halten. Wer über die Karte
//   wischt oder scrollt, löst nichts aus (wie Drüberwischen im Web). Genau einmal je Berührung.
// - Tippt der Finger auf Deko mit eigener Reaktion (Fledermaus, Ei, das Widget im Kopf), meint er die Deko und nicht
//   die Karte (`claimCardTouch`).
// - Kein Zuhörer, kein Signal: die Module hören nur ohne „Bewegung reduzieren“ zu (useCardLift.ts).
//
// Die Module entscheiden selbst und kennen ihre Ruhezeit je Karte (createRest); höchstens eine große Reaktion
// gleichzeitig (startReaction über das Bewegungsbudget). Das Antippen der Karte selbst bleibt, wie es ist: die
// Berührung wird nur mitgelesen, die Karte öffnet weiter ihren Inhalt.

/** So lange muss ein Finger ruhig auf der Karte bleiben, damit es ohne Loslassen zählt (wie die Viertelsekunde im Web). */
export const LIFT_DELAY_MS = 250;
/** Weiter bewegt ist es Scrollen, kein Tippen (px). */
export const TAP_SLOP_PX = 10;
/** So lange vor dem Antippen der Karte darf Deko die Berührung für sich beanspruchen (ms). */
export const CLAIM_MS = 150;
/** Ruhezeit je Karte: große Reaktionen (Schnee, Netz) etwa eine Minute, kleine zehn Sekunden - wie im Web. */
export const REST_MS = { big: 60000, small: 10000 };

export type CardLift = { type: "lift"; key: string };
type Handler = (detail: CardLift) => void;

const handlers = new Set<Handler>();

/** Zuhören; gibt das Abmelden zurück. */
export function subscribeCardLift(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** Hört gerade eine Saison zu? Sonst wird eine Berührung gar nicht erst verfolgt. */
export function cardLiftListening(): boolean {
  return handlers.size > 0;
}

export function emitCardLift(key: string): void {
  if (!key) return;
  const detail: CardLift = { type: "lift", key };
  [...handlers].forEach((handler) => {
    try {
      handler(detail);
    } catch {
      // eine Saison darf das Signal der anderen nicht anhalten
    }
  });
}

export type Rest = { take: (key: string) => boolean; left: (key: string) => number; clear: () => void };

/** Ruhezeit je Karte: `take(key)` ist true, wenn die Reaktion jetzt darf (und merkt sich den Zeitpunkt). */
export function createRest(ms: number, now: () => number = () => Date.now()): Rest {
  const last = new Map<string, number>();
  return {
    take(key) {
      const at = now();
      const previous = last.get(key);
      if (previous !== undefined && at - previous < ms) return false;
      last.set(key, at);
      return true;
    },
    left(key) {
      const previous = last.get(key);
      return previous === undefined ? 0 : Math.max(0, ms - (now() - previous));
    },
    clear() {
      last.clear();
    },
  };
}

/**
 * Eine große Reaktion starten (Schnee abschütteln, Netz reißen): höchstens eine gleichzeitig. Kommt von der Person,
 * darum ohne Aufwärmzeit - aber nie neben einer anderen großen und nie unter einem offenen Dialog. Liefert das Token
 * oder null.
 */
export function startReaction(kind: EffectKind = "card_big"): MotionToken | null {
  const scheduler = getMotionScheduler();
  if (scheduler.snapshot().active.includes(kind)) return null;
  return requestMotion(kind, { force: true });
}

export function endReaction(token: MotionToken | null | undefined): void {
  if (token) releaseMotion(token);
}

type Gesture = { x: number; y: number; at: number; timer: unknown; done: boolean };

export type CardPressOptions = {
  emit?: (key: string) => void;
  delayMs?: number;
  slop?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (id: unknown) => void;
  listening?: () => boolean;
};

export type CardPress = {
  start: (key: string, x: number, y: number, touches?: number) => void;
  move: (key: string, x: number, y: number) => void;
  end: (key: string, x: number, y: number) => void;
  cancel: (key: string) => void;
  claim: (key: string) => void;
  reset: () => void;
};

/**
 * Die Rechnung des Signals ohne Ereignisse der Plattform (Tests): je Karte eine Berührung - „lift“ beim Loslassen
 * eines Tippens oder nach `delayMs` ruhigem Halten, nie nach mehr als `slop` Bewegung, nie bei zwei Fingern, nie,
 * wenn Deko die Berührung beansprucht hat.
 */
export function createCardPress({
  emit = emitCardLift,
  delayMs = LIFT_DELAY_MS,
  slop = TAP_SLOP_PX,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  listening = cardLiftListening,
}: CardPressOptions = {}): CardPress {
  const gestures = new Map<string, Gesture>();
  const claims = new Map<string, number>();
  const stop = (gesture: Gesture) => {
    gesture.done = true;
    if (gesture.timer !== null) cancel(gesture.timer);
    gesture.timer = null;
  };
  const drop = (key: string) => {
    const gesture = gestures.get(key);
    if (!gesture) return;
    gestures.delete(key);
    stop(gesture);
  };
  const fire = (key: string, gesture: Gesture) => {
    if (gesture.done) return;
    stop(gesture);
    const claimedAt = claims.get(key);
    if (claimedAt !== undefined && claimedAt >= gesture.at - CLAIM_MS) return;
    emit(key);
  };
  const moved = (gesture: Gesture, x: number, y: number) => Math.hypot(x - gesture.x, y - gesture.y) > slop;
  return {
    start(key, x, y, touches = 1) {
      drop(key);
      if (!key || touches > 1 || !listening()) return;
      const gesture: Gesture = { x, y, at: now(), timer: null, done: false };
      gestures.set(key, gesture);
      gesture.timer = schedule(() => {
        gesture.timer = null;
        if (gestures.get(key) === gesture) fire(key, gesture);
      }, delayMs);
    },
    move(key, x, y) {
      const gesture = gestures.get(key);
      if (gesture && !gesture.done && moved(gesture, x, y)) drop(key);
    },
    end(key, x, y) {
      const gesture = gestures.get(key);
      if (!gesture) return;
      gestures.delete(key);
      if (moved(gesture, x, y)) stop(gesture);
      else fire(key, gesture);
    },
    cancel(key) {
      drop(key);
    },
    claim(key) {
      if (key) claims.set(key, now());
    },
    reset() {
      [...gestures.keys()].forEach(drop);
      claims.clear();
    },
  };
}

let shared = createCardPress();

/** Deko mit eigener Reaktion meldet beim Antippen: diese Berührung gilt ihr, nicht der Karte `key`. */
export function claimCardTouch(key: string | null | undefined): void {
  if (key) shared.claim(key);
}

export type CardTouchHandlers = {
  onTouchStart: (event: GestureResponderEvent) => void;
  onTouchMove: (event: GestureResponderEvent) => void;
  onTouchEnd: (event: GestureResponderEvent) => void;
  onTouchCancel: () => void;
};

function pointOf(event: GestureResponderEvent | undefined): { x: number; y: number; touches: number } {
  const native = event && event.nativeEvent;
  const touches = native && Array.isArray(native.touches) ? native.touches.length : 1;
  return { x: Number(native && native.pageX) || 0, y: Number(native && native.pageY) || 0, touches };
}

const touchHandlers = new Map<string, CardTouchHandlers>();

/**
 * Die Berührungen einer Karte mitlesen (`<View {...cardLiftTouch(perch)}>`): reine Touch-Ereignisse, die nichts
 * beanspruchen - Tippen, Navigation und Scrollen bleiben, wie sie sind. Ohne Schlüssel nichts.
 */
export function cardLiftTouch(key: string | null | undefined): CardTouchHandlers | undefined {
  if (!key) return undefined;
  let entry = touchHandlers.get(key);
  if (!entry) {
    entry = {
      onTouchStart: (event) => {
        const point = pointOf(event);
        shared.start(key, point.x, point.y, point.touches);
      },
      onTouchMove: (event) => {
        const point = pointOf(event);
        shared.move(key, point.x, point.y);
      },
      onTouchEnd: (event) => {
        const point = pointOf(event);
        shared.end(key, point.x, point.y);
      },
      onTouchCancel: () => shared.cancel(key),
    };
    touchHandlers.set(key, entry);
  }
  return entry;
}

/** Nur für Tests: laufende Berührungen und Ansprüche vergessen. */
export function resetCardLift(): void {
  shared.reset();
  shared = createCardPress();
}
