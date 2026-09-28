import { RELEASE_SECONDS, TOP, advanceRappel, createRappel, rappelView } from "./rappel";

// Abseil-Spinne in der App (#665): warten, abseilen bis über die Tab-Leiste, loslassen, weglaufen, der Faden
// schwingt, reißt ab, Pause - dann von der anderen Seite.

test("Ablauf als Zustandsfolge, danach die andere Seite", () => {
  const env = { floorY: 600, width: 400 };
  let state = createRappel({ side: "left", size: 24, speed: 100, first: 1, rest: 5 });
  expect(state.phase).toBe("wait");
  state = advanceRappel(state, 1.01, env);
  expect(state.phase).toBe("descend");
  const phases: string[] = [state.phase];
  for (let n = 0; n < 3000 && state.phase !== "wait"; n += 1) {
    state = advanceRappel(state, 0.05, env);
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
  }
  expect(phases).toEqual(["descend", "release", "run", "sway", "detach", "wait"]);
  expect(state.side).toBe("right");
  expect(state.runDir).toBe(-1);
  expect(state.cycles).toBe(1);
  expect(state.y).toBe(TOP);
});

test("Der Boden liegt über der Tab-Leiste abzüglich der Spinne", () => {
  const start = { ...createRappel({ side: "right", size: 24, speed: 1000, first: 0, rest: 5 }), phase: "descend" as const };
  const state = advanceRappel(start, 1, { floorY: 500, width: 400 });
  expect(state.y).toBe(500 - 24 * 4);
  expect(state.length).toBe(state.y - TOP);
  expect(state.phase).toBe("release");
  expect(state.timer).toBe(RELEASE_SECONDS);
});

test("Ansicht je Phase", () => {
  expect(rappelView({ phase: "wait" }).thread).toBe(false);
  expect(rappelView({ phase: "descend" })).toMatchObject({ thread: true, spiderOnThread: true, running: false });
  expect(rappelView({ phase: "run" })).toMatchObject({ running: true, swaying: true });
  expect(rappelView({ phase: "detach" })).toMatchObject({ thread: true, detaching: true });
});
