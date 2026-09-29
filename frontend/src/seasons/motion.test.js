import { DEFAULT_SLOTS, EFFECTS, INITIAL_DELAY_MS, MIN_GAP_MS, RESUME_GRACE_MS, createMotionScheduler, getMotionScheduler, requestMotion, resetMotionScheduler } from "./motion";

// Bewegungsbudget (H11): Plätze, Abstand zwischen Starts, Abklingzeit je Klasse, Aufwärmen nach dem Laden,
// Pause bei verstecktem Tab ohne Nachholen, Klicks bekommen immer ihren Platz.

function clock(start = 100000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function scheduler(c, extra = {}) {
  return createMotionScheduler({ now: c.now, doc: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} }, ...extra });
}

test("wartet nach dem Laden, hält dann Plätze, Abstand und Abklingzeiten ein", () => {
  const c = clock();
  const s = scheduler(c);
  expect(s.request("flock")).toBeNull();
  expect(s.lastReason()).toBe("warmup");
  c.advance(INITIAL_DELAY_MS);
  const flock = s.request("flock");
  expect(flock).toMatchObject({ kind: "flock", cost: 1 });
  expect(s.snapshot().used).toBe(1);
  expect(s.request("rappel")).toBeNull();
  expect(s.lastReason()).toBe("gap");
  c.advance(MIN_GAP_MS);
  const rappel = s.request("rappel");
  expect(rappel).not.toBeNull();
  expect(s.snapshot().used).toBe(DEFAULT_SLOTS);
  c.advance(MIN_GAP_MS);
  expect(s.request("crawler")).toBeNull();
  expect(s.lastReason()).toBe("busy");
  s.release(rappel);
  expect(s.request("crawler")).not.toBeNull();
  // Dieselbe Klasse erst nach der Abklingzeit wieder - auch wenn Plätze frei sind.
  s.release(flock);
  c.advance(MIN_GAP_MS);
  expect(s.request("flock")).toBeNull();
  expect(s.lastReason()).toBe("cooldown");
  c.advance(EFFECTS.flock.cooldownMs);
  expect(s.request("flock")).not.toBeNull();
});

test("Klicks der Person bekommen immer einen Platz und belegen ihn; Plätze laufen von selbst ab", () => {
  const c = clock();
  const s = scheduler(c);
  const scare = s.request("bat_scare");
  expect(scare).not.toBeNull();
  expect(s.request("ghost", { force: true })).not.toBeNull();
  expect(s.request("web_tear")).not.toBeNull();
  expect(s.snapshot().used).toBe(3);
  c.advance(INITIAL_DELAY_MS + MIN_GAP_MS);
  expect(s.snapshot().used).toBe(2);
  expect(s.request("flock")).toBeNull();
  expect(s.lastReason()).toBe("busy");
  c.advance(EFFECTS.ghost.ttlMs + 1);
  expect(s.snapshot().used).toBe(0);
  expect(s.request("flock")).not.toBeNull();
  expect(s.request("wisp")).not.toBeNull();
  expect(s.snapshot().used).toBe(1);
});

test("versteckter Tab: nichts startet, und nach dem Zurückkehren erst nach einer Schonfrist", () => {
  const c = clock();
  const s = scheduler(c);
  c.advance(INITIAL_DELAY_MS);
  s.setHidden(true);
  expect(s.request("flock")).toBeNull();
  expect(s.lastReason()).toBe("hidden");
  expect(s.request("bat_scare")).toBeNull();
  s.setHidden(false);
  expect(s.request("flock")).toBeNull();
  expect(s.lastReason()).toBe("resume");
  c.advance(RESUME_GRACE_MS);
  expect(s.request("flock")).not.toBeNull();
  const seen = [];
  const stop = s.subscribe((snap) => seen.push(snap.used));
  s.reset();
  expect(seen).toEqual([0]);
  stop();
  expect(s.canRun("flock")).toBe(false);
});

test("der gemeinsame Planer hört auf die Sichtbarkeit der Seite", () => {
  resetMotionScheduler(null);
  const shared = getMotionScheduler();
  expect(shared).toBe(getMotionScheduler());
  expect(requestMotion("flock")).toBeNull();
  expect(requestMotion("bat_scare", { force: true })).not.toBeNull();
  resetMotionScheduler(null);
});

test("unbegrenzt (Testschalter): alles darf, nur versteckt nicht", () => {
  const c = clock();
  const s = scheduler(c, { unlimited: true });
  expect(s.request("flock")).not.toBeNull();
  expect(s.request("flock")).not.toBeNull();
  expect(s.request("rappel")).not.toBeNull();
  expect(s.snapshot().used).toBe(3);
  s.setHidden(true);
  expect(s.request("flock")).toBeNull();
});

test("Plätze zur Laufzeit: ein Platz an Feiertagen sperrt die zweite große Bewegung, danach wieder zwei", () => {
  let clock = 100000;
  const scheduler = createMotionScheduler({ now: () => clock, initialDelayMs: 0, minGapMs: 0, doc: null });
  expect(scheduler.setSlots(1)).toBe(2);
  expect(scheduler.snapshot().slots).toBe(1);
  const first = scheduler.request("flock");
  expect(first).not.toBeNull();
  clock += 3000;
  expect(scheduler.request("rappel")).toBeNull();
  expect(scheduler.lastReason()).toBe("busy");
  expect(scheduler.setSlots(2)).toBe(1);
  expect(scheduler.request("rappel")).not.toBeNull();
  scheduler.release(first);
  scheduler.dispose();
});
