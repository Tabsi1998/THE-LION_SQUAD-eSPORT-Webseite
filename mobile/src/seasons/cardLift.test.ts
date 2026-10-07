import { CLAIM_MS, LIFT_DELAY_MS, REST_MS, TAP_SLOP_PX, cardLiftListening, cardLiftTouch, claimCardTouch, createCardPress, createRest, emitCardLift, endReaction, resetCardLift, startReaction, subscribeCardLift } from "./cardLift";
import { createMotionScheduler, resetMotionScheduler } from "./motion";

// Karten-Signal in der App (#1087): ein Tippen oder ruhiges Halten auf einer Karte meldet „lift“ mit ihrem Schlüssel -
// genau einmal je Berührung, nie beim Scrollen, nie für Deko, die die Berührung für sich beansprucht; Ruhezeit je Karte
// und höchstens eine große Reaktion gleichzeitig wie im Web (frontend/src/seasons/cardLift.test.js).

function clock() {
  let now = 1000;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    cancel: (id: unknown) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    advance(ms: number) {
      now += ms;
      timers.filter((timer) => timer.at <= now).forEach((timer) => {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      });
    },
    pending: () => timers.length,
  };
}

function setup(listening = true) {
  const time = clock();
  const lifts: string[] = [];
  const press = createCardPress({ emit: (key) => lifts.push(key), now: time.now, schedule: time.schedule, cancel: time.cancel, listening: () => listening });
  return { time, lifts, press };
}

afterEach(() => {
  resetCardLift();
  resetMotionScheduler(null);
});

test("Tippen: beim Loslassen genau ein „lift“ für genau diese Karte", () => {
  const { time, lifts, press } = setup();
  press.start("news-1", 100, 200);
  time.advance(90);
  expect(lifts).toEqual([]);
  press.end("news-1", 103, 198);
  expect(lifts).toEqual(["news-1"]);
  time.advance(LIFT_DELAY_MS);
  expect(lifts).toEqual(["news-1"]);
  expect(time.pending()).toBe(0);
});

test("Halten: nach einer Viertelsekunde ruhig ein „lift“, beim Loslassen kein zweites", () => {
  const { time, lifts, press } = setup();
  press.start("hero", 50, 60);
  time.advance(LIFT_DELAY_MS - 1);
  expect(lifts).toEqual([]);
  time.advance(1);
  expect(lifts).toEqual(["hero"]);
  press.move("hero", 51, 61);
  press.end("hero", 51, 61);
  expect(lifts).toEqual(["hero"]);
});

test("Scrollen und Wischen lösen nichts aus - weder beim Loslassen noch nach der Viertelsekunde", () => {
  const { time, lifts, press } = setup();
  press.start("news-1", 100, 200);
  press.move("news-1", 100, 200 - TAP_SLOP_PX - 1);
  time.advance(LIFT_DELAY_MS * 2);
  press.end("news-1", 100, 150);
  // Abgebrochen (die Liste übernimmt die Berührung).
  press.start("news-2", 100, 300);
  press.cancel("news-2");
  time.advance(LIFT_DELAY_MS * 2);
  // Losgelassen, aber weit weg vom Anfang.
  press.start("news-3", 100, 300);
  press.end("news-3", 140, 300);
  // Zwei Finger.
  press.start("news-4", 100, 300, 2);
  press.end("news-4", 100, 300);
  time.advance(LIFT_DELAY_MS * 2);
  expect(lifts).toEqual([]);
});

test("Deko beansprucht die Berührung (vorher oder währenddessen) - dann schweigt die Karte; eine alte Beanspruchung zählt nicht", () => {
  const { time, lifts, press } = setup();
  // Die Fledermaus hört die Berührung zuerst (das Ereignis steigt vom Kind zur Karte auf).
  press.claim("hero");
  press.start("hero", 10, 10);
  press.end("hero", 10, 10);
  // Das Ei meldet sich erst, wenn die Karte schon mitliest.
  press.start("card-2", 10, 10);
  time.advance(30);
  press.claim("card-2");
  time.advance(LIFT_DELAY_MS);
  expect(lifts).toEqual([]);
  // Viel später ist es wieder die Karte.
  time.advance(CLAIM_MS + 1);
  press.start("hero", 10, 10);
  press.end("hero", 10, 10);
  expect(lifts).toEqual(["hero"]);
});

test("ohne Zuhörer (keine Saison oder „Bewegung reduzieren“) wird nichts verfolgt", () => {
  const { time, lifts, press } = setup(false);
  press.start("hero", 10, 10);
  expect(time.pending()).toBe(0);
  press.end("hero", 10, 10);
  expect(lifts).toEqual([]);
});

test("das gemeinsame Signal: Touch-Ereignisse der Karte, Zuhören und Abmelden", () => {
  jest.useFakeTimers();
  try {
    const heard: string[] = [];
    const touch = cardLiftTouch("profile-status");
    expect(cardLiftTouch(undefined)).toBeUndefined();
    expect(cardLiftTouch("profile-status")).toBe(touch);
    const at = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y, touches: [{}] } }) as never;
    // Niemand hört zu: nichts.
    touch?.onTouchStart(at(5, 5));
    touch?.onTouchEnd(at(5, 5));
    expect(cardLiftListening()).toBe(false);
    const stop = subscribeCardLift((detail) => heard.push(`${detail.type}:${detail.key}`));
    expect(cardLiftListening()).toBe(true);
    touch?.onTouchStart(at(5, 5));
    touch?.onTouchEnd(at(6, 6));
    claimCardTouch("profile-status");
    touch?.onTouchStart(at(5, 5));
    touch?.onTouchEnd(at(5, 5));
    jest.advanceTimersByTime(CLAIM_MS + 10);
    touch?.onTouchStart(at(5, 5));
    touch?.onTouchMove(at(5, 40));
    touch?.onTouchEnd(at(5, 40));
    stop();
    touch?.onTouchStart(at(5, 5));
    touch?.onTouchEnd(at(5, 5));
    expect(heard).toEqual(["lift:profile-status"]);
    // Ein kaputter Zuhörer hält die anderen nicht auf.
    const second: string[] = [];
    const stopBroken = subscribeCardLift(() => {
      throw new Error("kaputt");
    });
    const stopSecond = subscribeCardLift((detail) => second.push(detail.key));
    emitCardLift("x");
    stopBroken();
    stopSecond();
    expect(second).toEqual(["x"]);
  } finally {
    jest.useRealTimers();
  }
});

test("Ruhezeit je Karte: Schnee und Netz eine Minute, kleine zehn Sekunden; Nachbarkarten unberührt", () => {
  let now = 0;
  const rest = createRest(REST_MS.big, () => now);
  expect(REST_MS).toEqual({ big: 60000, small: 10000 });
  expect(rest.take("a")).toBe(true);
  expect(rest.take("b")).toBe(true);
  expect(rest.take("a")).toBe(false);
  now = 59999;
  expect(rest.left("a")).toBe(1);
  expect(rest.take("a")).toBe(false);
  now = 60000;
  expect(rest.left("a")).toBe(0);
  expect(rest.take("a")).toBe(true);
  rest.clear();
  expect(rest.left("a")).toBe(0);
});

test("höchstens eine große Reaktion gleichzeitig - ohne Aufwärmzeit, nie unter einem offenen Dialog", () => {
  const scheduler = createMotionScheduler({ appState: null });
  resetMotionScheduler(scheduler);
  // Gleich nach dem Start (Aufwärmzeit) darf die Person trotzdem: das Antippen kommt von ihr.
  const first = startReaction();
  expect(first).not.toBeNull();
  expect(startReaction()).toBeNull();
  endReaction(first);
  const second = startReaction();
  expect(second).not.toBeNull();
  endReaction(second);
  scheduler.setBlocked(true);
  expect(startReaction()).toBeNull();
});
