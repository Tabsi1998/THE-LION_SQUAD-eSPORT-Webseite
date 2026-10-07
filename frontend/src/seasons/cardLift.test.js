import { CARD_EVENT, LIFT_DELAY_MS, belongsTo, cardKey, cardOf, cardSignal, createLiftOffsets, createLiftTracker, createRest, defaultSignal, endReaction, follow, resetCardSignal, signalsAllowed, startReaction } from "./cardLift";
import { createMotionScheduler, resetMotionScheduler } from "./motion";

// Karten-Signal (#1087): „lift“ genau einmal je Anheben und frühestens nach einer Viertelsekunde, Drüberwischen löst
// nichts aus; die Deko der Karte fährt sofort mit; nur mit Maus und ohne „Bewegung reduzieren“.

function media({ hover = true, reduced = false } = {}) {
  return (query) => ({ matches: query.includes("hover") ? hover : query.includes("reduced") ? reduced : false, addEventListener() {}, removeEventListener() {} });
}

afterEach(() => {
  resetCardSignal();
  resetMotionScheduler();
  document.body.innerHTML = "";
});

test("lift erst nach einer Viertelsekunde, genau einmal; Drüberwischen löst nichts aus", () => {
  const events = [];
  const timers = [];
  const tracker = createLiftTracker({ emit: (detail) => events.push(detail), schedule: (fn, ms) => timers.push({ fn, ms }) && timers.length, cancel: (id) => { if (timers[id - 1]) timers[id - 1].fn = () => {}; } });
  const a = document.createElement("div");
  const b = document.createElement("div");
  tracker.enter(a);
  tracker.enter(a);
  expect(events.map((e) => e.type)).toEqual(["enter"]);
  expect(timers[0].ms).toBe(LIFT_DELAY_MS);
  // Weiter zur nächsten Karte, bevor die Zeit um ist: die erste hebt sich nie.
  tracker.enter(b);
  timers[0].fn();
  expect(events.map((e) => `${e.type}:${e.key}`)).toEqual([`enter:${cardKey(a)}`, `leave:${cardKey(a)}`, `enter:${cardKey(b)}`]);
  expect(events[1].lifted).toBe(false);
  timers[1].fn();
  timers[1].fn();
  expect(events.filter((e) => e.type === "lift")).toHaveLength(1);
  tracker.leave();
  expect(events.at(-1)).toMatchObject({ type: "leave", key: cardKey(b), lifted: true });
  tracker.leave();
  expect(events.filter((e) => e.type === "leave")).toHaveLength(2);
});

test("Schlüssel wie im Anker-Kern; Plätze gehören zu ihrer Karte", () => {
  const card = document.createElement("article");
  const key = cardKey(card);
  expect(key).toMatch(/^card:\d+$/);
  expect(cardKey(card)).toBe(key);
  expect(belongsTo(`${key}:2`, key)).toBe(true);
  expect(belongsTo(`${key}0:2`, key)).toBe(false);
  expect(cardOf(`${key}:2`)).toBe(key);
  expect(cardOf("footer:4:1")).toBeNull();
});

test("Ruhezeit je Karte", () => {
  let now = 1000;
  const rest = createRest(60000, () => now);
  expect(rest.take("card:1")).toBe(true);
  expect(rest.take("card:1")).toBe(false);
  expect(rest.take("card:2")).toBe(true);
  now += 59999;
  expect(rest.left("card:1")).toBe(1);
  expect(rest.take("card:1")).toBe(false);
  now += 1;
  expect(rest.take("card:1")).toBe(true);
});

test("höchstens eine große Reaktion gleichzeitig - auch gleich nach dem Laden", () => {
  resetMotionScheduler(createMotionScheduler({ doc: null }));
  const first = startReaction();
  expect(first).toBeTruthy();
  expect(startReaction()).toBeNull();
  endReaction(first);
  const again = startReaction();
  expect(again).toBeTruthy();
  endReaction(again);
});

test("nur mit Maus und ohne „Bewegung reduzieren“", () => {
  expect(signalsAllowed({ matchMedia: media() })).toBe(true);
  expect(signalsAllowed({ matchMedia: media({ hover: false }) })).toBe(false);
  expect(signalsAllowed({ matchMedia: media({ reduced: true }) })).toBe(false);
  expect(signalsAllowed(null)).toBe(false);
});

test("an der Seite: Deko fährt mit, lift kommt als Ereignis, Touch und Karten ohne Anheben bleiben still", () => {
  vi.useFakeTimers();
  const win = { matchMedia: media(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id), addEventListener() {}, removeEventListener() {}, dispatchEvent: (event) => window.dispatchEvent(event), CustomEvent: window.CustomEvent };
  document.body.innerHTML = `
    <article class="tls-card" data-season-anchor="card"><h3 id="inside">Titel</h3></article>
    <article data-season-anchor="card" id="still">ohne Anheben</article>`;
  const card = document.querySelector(".tls-card");
  const key = cardKey(card);
  const deco = document.createElement("svg");
  deco.setAttribute("data-season-card", key);
  document.body.appendChild(deco);
  const seen = [];
  const onWindow = (event) => seen.push(event.detail.type);
  window.addEventListener(CARD_EVENT, onWindow);
  const details = [];
  const stop = cardSignal(document, win).subscribe((detail) => details.push(detail));

  const over = (target, pointerType = "mouse", relatedTarget = null) => {
    const event = new window.MouseEvent("pointerover", { bubbles: true, relatedTarget });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    target.dispatchEvent(event);
  };
  const out = (target, relatedTarget = null) => {
    const event = new window.MouseEvent("pointerout", { bubbles: true, relatedTarget });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    target.dispatchEvent(event);
  };

  over(document.getElementById("inside"), "touch");
  vi.advanceTimersByTime(400);
  expect(details).toEqual([]);

  over(document.getElementById("inside"));
  expect(deco.hasAttribute("data-season-lifted")).toBe(true);
  vi.advanceTimersByTime(LIFT_DELAY_MS - 1);
  expect(details.map((d) => d.type)).toEqual(["enter"]);
  vi.advanceTimersByTime(1);
  expect(details.map((d) => d.type)).toEqual(["enter", "lift"]);
  expect(details[1].key).toBe(key);
  // Innerhalb der Karte bleibt sie oben.
  out(document.getElementById("inside"), card);
  expect(details.map((d) => d.type)).toEqual(["enter", "lift"]);
  out(card, document.body);
  expect(details.map((d) => d.type)).toEqual(["enter", "lift", "leave"]);
  expect(deco.hasAttribute("data-season-lifted")).toBe(false);
  expect(seen).toEqual(["enter", "lift", "leave"]);

  over(document.getElementById("still"));
  vi.advanceTimersByTime(400);
  expect(details).toHaveLength(3);

  stop();
  over(document.getElementById("inside"));
  vi.advanceTimersByTime(400);
  expect(details).toHaveLength(3);
  window.removeEventListener(CARD_EVENT, onWindow);
  vi.useRealTimers();
});

test("follow setzt und nimmt die Markierung", () => {
  document.body.innerHTML = `<div data-season-card="card:7"></div><div data-season-card="card:7"></div><div data-season-card="card:8"></div>`;
  expect(follow(document, "card:7", true)).toBe(2);
  expect(document.querySelectorAll("[data-season-lifted]")).toHaveLength(2);
  follow(document, "card:7", false);
  expect(document.querySelectorAll("[data-season-lifted]")).toHaveLength(0);
  expect(follow(null, "card:7", true)).toBe(0);
});

test("Versatz gehobener Kanten für gezeichnete Ebenen: hoch in 240 ms, beim Verlassen zurück", () => {
  let now = 0;
  const lifts = createLiftOffsets(() => now, 240);
  expect(lifts.offset("card:1")).toBe(0);
  lifts.onSignal({ type: "enter", key: "card:1" });
  now = 120;
  const half = lifts.offset("card:1");
  expect(half).toBeLessThan(0);
  expect(half).toBeGreaterThan(-5);
  now = 240;
  expect(lifts.offset("card:1")).toBeCloseTo(-5, 5);
  expect(lifts.offset("card:2")).toBe(0);
  lifts.onSignal({ type: "leave", key: "card:2" });
  expect(lifts.offset("card:1")).toBeCloseTo(-5, 5);
  lifts.onSignal({ type: "leave", key: "card:1" });
  now = 360;
  const down = lifts.offset("card:1");
  expect(down).toBeLessThan(0);
  expect(down).toBeGreaterThan(-5);
  now = 480;
  expect(lifts.offset("card:1")).toBe(0);
  expect(lifts.offset(null)).toBe(0);
});

test("ohne echte Seite kein Signal", () => {
  expect(defaultSignal(null)).toBeNull();
  expect(defaultSignal({ document: null })).toBeNull();
});
