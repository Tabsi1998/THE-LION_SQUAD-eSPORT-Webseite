import { hashString, mulberry32 } from "../rng";
import { SHELLS, SHELL_TYPES, burstStars, hashText, rocketAt, seededRandom, smokeAt, starAt, starLight, windDrift, type Launch } from "./fireworks";
import { handwriting, planHour, salvoLaunches } from "./choreography";
import { countdownState, newYearOf, serverOffset } from "./countdown";

// Silvester in der App (S11 #642, N1–N3): dieselbe Rechnung wie im Web - die Fingerabdrücke stehen gleich in
// frontend/src/seasons/newYear/fireworks.test.js. Weicht eine Seite ab, wird die andere rot.

export const FIRE_PARITY = 2787607397;
export const CHOREO_PARITY = 681797588;

const LAUNCH: Launch = { id: "p", at: 0, type: "peony", x: 0.5, distance: 0.3, colors: ["blue", "gold"], burstY: 0.3, rise: 1.4, drift: 12 };

function fireFingerprint(rng: (seed: number) => () => number): number {
  return hashString(JSON.stringify({
    stars: SHELL_TYPES.map((type, i) => burstStars({ ...LAUNCH, type }, rng(1000 + i), 1, 1.1)),
    path: [0, 0.4, 1.2, 2.5].map((age) => starAt({ vx: 120, vy: -80 }, age, SHELLS.willow, { x: 300, y: 200 }, 8, 0.4)),
    light: [0, 0.3, 1.1, 1.9].map((age) => starLight({ life: 2, glitter: 1.1, crackleAt: null }, age)),
    smoke: [0.5, 4, 8.9].map((age) => smokeAt({ x: 100, y: 200 }, age, 6, 0.3)),
    rocket: [0, 0.7, 1.4].map((t) => rocketAt(LAUNCH, t, { width: 1000, height: 800 }, 5)),
  }));
}

test("Parität mit dem Web: dieselbe Feuerwerksrechnung", () => {
  expect(fireFingerprint((seed) => mulberry32(seed))).toBe(FIRE_PARITY);
  // Der Zufall auf dem UI-Thread ist derselbe Strom wie in rng.ts.
  expect(fireFingerprint((seed) => seededRandom(seed))).toBe(FIRE_PARITY);
  expect(hashText("new_year:2026:show")).toBe(hashString("new_year:2026:show"));
});

test("Parität mit dem Web: dieselbe Handschrift, dieselben Raketen, dieselben Salven", () => {
  const fingerprint = hashString(JSON.stringify({
    hands: [2026, 2027, 2031].map((year) => handwriting(year)),
    plan: planHour(handwriting(2026), { hourSeed: 2026365023, salvos: [5, 90, 1800], phase: "evening_31", hourStart: 1767218400000 }),
    salvos: [0, 1, 2].map((index) => salvoLaunches(handwriting(2027), index, 1767222000000)),
  }));
  expect(fingerprint).toBe(CHOREO_PARITY);
});

test("Countdown und Serveruhr wie im Web", () => {
  const show = Date.parse("2027-01-01T00:00:00+01:00");
  expect(countdownState(Date.parse("2026-12-31T23:18:30+01:00"), show)).toMatchObject({ stage: "hint", minutes: 42 });
  expect(countdownState(Date.parse("2026-12-31T23:59:00+01:00"), show)).toMatchObject({ stage: "calm", seconds: 60 });
  expect(countdownState(Date.parse("2026-12-31T23:59:50.200+01:00"), show)).toMatchObject({ stage: "pulse", seconds: 10 });
  expect(countdownState(show + 1000, show).stage).toBe("zero");
  expect(countdownState(show + 9000, show).stage).toBe("done");
  expect(newYearOf("2027-01-01T00:00:00+01:00")).toBe(2027);
  expect(serverOffset(new Date(1_000_200 + 90_000).toISOString(), 1_000_000, 1_000_400)).toBe(90_000);
  expect(windDrift({ wind_factor: 1, wind_dir: 270 })).toBeGreaterThan(0);
});
