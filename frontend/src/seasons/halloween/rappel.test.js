import { RELEASE_SECONDS, TOP, advanceRappel, createRappel, rappelView } from "./rappel";

// Abseil-Spinne (#663): warten, abseilen bis zum Strich, loslassen, weglaufen, der Faden schwingt, reißt ab,
// Pause - dann von der anderen Seite.

test("Ablauf als Zustandsfolge, danach die andere Seite", () => {
  const env = { floorY: 600, width: 800 };
  let state = createRappel({ side: "left", size: 24, speed: 100, first: 1, rest: 5 });
  expect(state.phase).toBe("wait");
  expect(state.runDir).toBe(1);
  state = advanceRappel(state, 1.01, env);
  expect(state.phase).toBe("descend");
  const phases = [state.phase];
  for (let n = 0; n < 3000 && state.phase !== "wait"; n += 1) {
    state = advanceRappel(state, 0.05, env);
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
  }
  expect(phases).toEqual(["descend", "release", "run", "sway", "detach", "wait"]);
  expect(state.side).toBe("right");
  expect(state.runDir).toBe(-1);
  expect(state.cycles).toBe(1);
  expect(state.timer).toBe(5);
  expect(state.y).toBe(TOP);
});

test("Der Boden liegt beim Strich abzüglich der Spinne; der Faden ist so lang wie der Weg", () => {
  const start = { ...createRappel({ side: "right", size: 24, speed: 1000, first: 0, rest: 5 }), phase: "descend" };
  const state = advanceRappel(start, 1, { floorY: 500, width: 800 });
  expect(state.y).toBe(500 - 24 * 4);
  expect(state.length).toBe(state.y - TOP);
  expect(state.phase).toBe("release");
  expect(state.timer).toBe(RELEASE_SECONDS);
  const short = advanceRappel(start, 1, { floorY: 100, width: 800 });
  expect(short.y).toBe(TOP + 120);
});

test("Laufen: nach links oder rechts, bis aus dem Bild", () => {
  let state = { ...createRappel({ side: "right", size: 24, speed: 100, first: 0, rest: 5 }), phase: "run", x: 0 };
  state = advanceRappel(state, 1, { floorY: 500, width: 800 });
  expect(state.x).toBeLessThan(0);
  for (let n = 0; n < 20 && state.phase === "run"; n += 1) state = advanceRappel(state, 1, { floorY: 500, width: 800 });
  expect(state.phase).toBe("sway");
});

test("Ansicht je Phase", () => {
  expect(rappelView({ phase: "wait" }).thread).toBe(false);
  expect(rappelView({ phase: "descend" })).toMatchObject({ thread: true, spiderOnThread: true, running: false, swaying: false });
  expect(rappelView({ phase: "run" })).toMatchObject({ thread: true, spiderOnThread: false, running: true, swaying: true });
  expect(rappelView({ phase: "sway" })).toMatchObject({ swaying: true, detaching: false });
  expect(rappelView({ phase: "detach" })).toMatchObject({ thread: true, detaching: true });
});
