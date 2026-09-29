import { EFFECTS, INITIAL_DELAY_MS, MIN_GAP_MS, RESUME_GRACE_MS, createMotionScheduler } from "./motion";

// Bewegungsbudget (A3): zwei Plätze, Aufwärmen, Abstand, Abklingzeit je Klasse, Antippen immer, Hintergrund pausiert
// und holt nichts nach; nie gestartete Klassen haben keine Abklingzeit.

function makeClock(start = 100000) {
  const clock = { now: start };
  return { clock, now: () => clock.now, tick: (ms: number) => { clock.now += ms; } };
}

function fakeAppState(initial = "active") {
  const listeners: Array<(status: string) => void> = [];
  return {
    currentState: initial,
    addEventListener: (_event: string, listener: (status: string) => void) => {
      listeners.push(listener);
      return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
    },
    fire: (status: string) => listeners.forEach((listener) => listener(status)),
  };
}

test("Aufwärmen, Plätze, Abstand und Abklingzeit", () => {
  const { now, tick } = makeClock();
  const scheduler = createMotionScheduler({ now, appState: fakeAppState() as never });
  expect(scheduler.request("rappel")).toBeNull();
  expect(scheduler.lastReason()).toBe("warmup");
  tick(INITIAL_DELAY_MS);
  const rappel = scheduler.request("rappel");
  expect(rappel).not.toBeNull();
  expect(scheduler.request("flock")).toBeNull();
  expect(scheduler.lastReason()).toBe("gap");
  tick(MIN_GAP_MS);
  const flock = scheduler.request("flock");
  expect(flock).not.toBeNull();
  tick(MIN_GAP_MS);
  expect(scheduler.request("crawler")).toBeNull();
  expect(scheduler.lastReason()).toBe("busy");
  scheduler.release(rappel);
  scheduler.release(flock);
  expect(scheduler.request("rappel")).toBeNull();
  expect(scheduler.lastReason()).toBe("cooldown");
  tick(EFFECTS.rappel.cooldownMs);
  expect(scheduler.request("rappel")).not.toBeNull();
  expect(scheduler.snapshot().active).toEqual(["rappel"]);
});

test("Antippen bekommt seinen Platz immer, Klassen ohne Platz nur mit Abstand zu sich selbst; eine kleine Uhr sperrt den ersten Start nicht", () => {
  const { now, tick } = makeClock(10);
  const scheduler = createMotionScheduler({ now, appState: fakeAppState() as never });
  expect(scheduler.request("bat_scare")).not.toBeNull();
  expect(scheduler.request("ghost")).not.toBeNull();
  tick(INITIAL_DELAY_MS + MIN_GAP_MS);
  expect(scheduler.request("web_spider")).not.toBeNull();
  expect(scheduler.request("web_spider")).toBeNull();
  expect(scheduler.lastReason()).toBe("cooldown");
  // Das Antippen (4 s) ist nach 6,5 s abgelaufen, der Geist (9 s) zählt noch.
  expect(scheduler.snapshot().used).toBe(1);
});

test("App im Hintergrund: nichts startet; zurück mit Schonfrist, keine Nachholjagd; Abo meldet jede Änderung", () => {
  const { now, tick } = makeClock();
  const appState = fakeAppState();
  const scheduler = createMotionScheduler({ now, appState: appState as never });
  const seen: string[] = [];
  scheduler.subscribe((snapshot) => seen.push(snapshot.hidden ? "hidden" : "shown"));
  tick(INITIAL_DELAY_MS);
  appState.fire("background");
  expect(scheduler.request("bat_scare")).toBeNull();
  expect(scheduler.lastReason()).toBe("hidden");
  appState.fire("active");
  expect(scheduler.request("rappel")).toBeNull();
  expect(scheduler.lastReason()).toBe("resume");
  tick(RESUME_GRACE_MS);
  expect(scheduler.request("rappel")).not.toBeNull();
  expect(seen).toEqual(["hidden", "shown", "shown"]);
  scheduler.dispose();
});

test("unlimited (Testschalter) lässt alles zu, zählt aber die Belegung", () => {
  const { now } = makeClock();
  const scheduler = createMotionScheduler({ now, unlimited: true, appState: fakeAppState() as never });
  expect(scheduler.request("rappel")).not.toBeNull();
  expect(scheduler.request("flock")).not.toBeNull();
  expect(scheduler.request("crawler")).not.toBeNull();
  expect(scheduler.snapshot().used).toBe(3);
  scheduler.reset();
  expect(scheduler.snapshot().used).toBe(0);
});
