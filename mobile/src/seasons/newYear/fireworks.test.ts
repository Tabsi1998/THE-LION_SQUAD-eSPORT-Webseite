import { hashString, mulberry32 } from "../rng";
import { CALIBERS, CALIBER_TYPES, SHELLS, SHELL_TYPES, burstPoint, burstStars, caliberOf, hashText, launchDuration, maxStars, rocketAt, seededRandom, smokeAt, starAt, starLight, windDrift, type Launch } from "./fireworks";
import { CALIBER_SHARES, handwriting, makeLaunch, planHour, salvoLaunches, salvoTimes, showLaunches, withCaliber } from "./choreography";
import { countdownState, newYearOf, serverOffset } from "./countdown";
import { DIGIT_STROKES, YEAR_SALVO_DELAY_MS, calmYearDots, glyphCounts, glyphPoints, glyphSpot, isGlyph, yearLaunches, yearStarAt, yearStarCount, yearStarLight, yearStars } from "./yearDigits";

// Silvester in der App (S11 #642, N1–N3; Kaliber und Jahreszahl #853): dieselbe Rechnung wie im Web - die
// Fingerabdrücke stehen gleich in frontend/src/seasons/newYear/fireworks.test.js. Weicht eine Seite ab, wird die andere rot.

export const FIRE_PARITY = 3025438839;
export const CHOREO_PARITY = 1292175831;
export const YEAR_PARITY = 2834516894;

const LAUNCH: Launch = { id: "p", at: 0, type: "peony", x: 0.5, distance: 0.3, colors: ["blue", "gold"], burstY: 0.3, rise: 1.4, drift: 12 };

function fireFingerprint(rng: (seed: number) => () => number): number {
  return hashString(JSON.stringify({
    stars: SHELL_TYPES.map((type, i) => burstStars({ ...LAUNCH, type }, rng(1000 + i), 1, 1.1)),
    calibers: CALIBER_TYPES.map((caliber, i) => burstStars({ ...LAUNCH, type: "chrysanthemum", caliber }, rng(2000 + i), 0.8, 1.1)),
    durations: CALIBER_TYPES.map((caliber) => launchDuration({ ...LAUNCH, caliber })),
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

function yearFingerprint(rng: (seed: number) => () => number): number {
  const desk = { width: 1440, height: 900 };
  const launches = yearLaunches(2027, 1767222000000);
  return hashString(JSON.stringify({
    glyphs: Object.keys(DIGIT_STROKES).map((digit) => glyphPoints(digit, 33)),
    spots: [desk, { width: 390, height: 844 }, { width: 844, height: 390 }].map((size) => [0, 1, 2, 3].map((slot) => glyphSpot(slot, 4, size))),
    launches,
    stars: launches.map((launch, i) => yearStars(launch, rng(77 + i), desk, yearStarCount(200))),
    path: [0, 0.3, 0.7, 2, 3.4, 4.5, 6].map((age) => yearStarAt({ tx: 30, ty: -20, fall: 0.4, vx: 6 }, age, { x: 700, y: 380 }, 7)),
    light: [0, 0.05, 0.5, 1.5, 3.4, 4.5, 6].map((age) => yearStarLight({ fall: 0.4, glitter: 2.1 }, age)),
    calm: calmYearDots(2028, { width: 390, height: 844 }),
    show: showLaunches(handwriting(2026), [1767222000000, 1767222300000], 2027),
    burst: burstPoint(launches[2], desk, 6),
    rocket: rocketAt(launches[1], 0.6, desk, 6),
    duration: launchDuration(launches[0]),
  }));
}

test("Parität mit dem Web: dieselbe Jahreszahl um 00:00 - auch mit dem Zufall des UI-Threads", () => {
  expect(yearFingerprint((seed) => mulberry32(seed))).toBe(YEAR_PARITY);
  expect(yearFingerprint((seed) => seededRandom(seed))).toBe(YEAR_PARITY);
});

test("Kaliber (#853): viele kleine, ab und zu große, selten sehr große - Kugel und Sterne wachsen, die sehr große zerplatzt tiefer", () => {
  expect(caliberOf({})).toBe(CALIBERS.large);
  expect(burstStars(LAUNCH, mulberry32(4))).toEqual(burstStars({ ...LAUNCH, caliber: "large" }, mulberry32(4)));
  expect([maxStars({ type: "peony", caliber: "small" }), maxStars({ type: "peony" }), maxStars({ type: "peony", caliber: "giant" })]).toEqual([50, 80, 112]);
  const hand = handwriting(2026);
  const launches = Array.from({ length: 800 }, (_, i) => makeLaunch(hand, `k:${i}`, "show", 0));
  const share = (caliber: string) => launches.filter((launch) => launch.caliber === caliber).length / launches.length;
  expect(share("small")).toBeGreaterThan(0.5);
  expect(share("giant")).toBeGreaterThan(0.03);
  expect(share("giant")).toBeLessThan(0.14);
  expect(CALIBER_SHARES.small + CALIBER_SHARES.large + CALIBER_SHARES.giant).toBeCloseTo(1, 5);
  launches.filter((launch) => launch.type === "heart").forEach((launch) => expect(launch.caliber).not.toBe("small"));
  const large = launches.find((launch) => launch.caliber === "large") as Launch;
  expect(withCaliber(large, "giant").burstY).toBeCloseTo(large.burstY + CALIBERS.giant.lower, 3);
});

test("Jahreszahl (#853): um 00:00 zuerst die Ziffern, dann die gewohnte erste Salve; Platz mittig unter der Gruß-Karte", () => {
  const hand = handwriting(2026);
  const start = 1767222000000;
  const times = salvoTimes(start);
  const show = showLaunches(hand, times, 2027);
  const digits = show.filter((launch) => isGlyph(launch));
  expect(digits.map((launch) => launch.glyph).join("")).toBe("2027");
  expect(digits[0].at).toBe(start);
  expect(Math.min(...show.filter((launch) => launch.id.startsWith("salvo:0:")).map((launch) => launch.at))).toBe(start + YEAR_SALVO_DELAY_MS);
  expect(showLaunches(hand, times, null)).toEqual(times.flatMap((at, index) => salvoLaunches(hand, index, at)));
  const phone = { width: 390, height: 844 };
  const spots = [0, 1, 2, 3].map((slot) => glyphSpot(slot, 4, phone));
  expect(spots[3].x + spots[3].height * 0.3 - (spots[0].x - spots[0].height * 0.3)).toBeLessThanOrEqual(phone.width * 0.8 + 1);
  expect(spots[0].y - spots[0].height / 2).toBeGreaterThanOrEqual(239.9);
  expect(glyphCounts("2027", yearStarCount(200)).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(148);
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
