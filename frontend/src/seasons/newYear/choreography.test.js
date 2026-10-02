import { COLOR_PAIRS, SALVO_PATTERNS, handwriting, makeLaunch, pickType, planHour, salvoLaunches, salvoTimes } from "./choreography";
import { SHELL_TYPES } from "./fireworks";
import { mulberry32 } from "../rng";

// Choreografie (N2, #740): jedes Jahr eine eigene Handschrift, innerhalb des Jahres stabil (auch nach Neuladen), über
// mehrere Jahreswechsel verschieden; die Startzeiten bleiben die des Servers.

test("Handschrift: stabil im Jahr, anders je Jahr - über mehrere Jahreswechsel", () => {
  const hands = [2026, 2027, 2028, 2029, 2030].map((year) => handwriting(year));
  expect(handwriting(2026)).toEqual(hands[0]);
  expect(new Set(hands.map((hand) => JSON.stringify(hand))).size).toBe(5);
  hands.forEach((hand) => {
    expect(hand.zones.length).toBeGreaterThanOrEqual(4);
    expect(hand.zones.length).toBeLessThanOrEqual(6);
    hand.zones.forEach((zone, index) => {
      expect(zone).toBeGreaterThan(0.05);
      expect(zone).toBeLessThan(0.95);
      if (index) expect(zone).toBeGreaterThan(hand.zones[index - 1]);
    });
    expect(hand.favorite).not.toBe("heart");
    expect(hand.weights[hand.favorite]).toBeGreaterThan(3);
    expect(hand.pairs).toHaveLength(5);
    hand.pairs.forEach((pair) => expect(COLOR_PAIRS).toContainEqual(pair));
    expect(hand.salvos).toHaveLength(3);
    hand.salvos.forEach((pattern, index) => {
      expect(SALVO_PATTERNS).toContain(pattern);
      if (index) expect(pattern).not.toBe(hand.salvos[index - 1]);
    });
  });
});

test("Arten nach den Gewichten: in der Rampe kein Herz, in der Show alle sechs", () => {
  const hand = handwriting(2026);
  const rng = mulberry32(11);
  const ramp = new Set(Array.from({ length: 400 }, () => pickType(hand, rng, "evening_31")));
  expect(ramp.has("heart")).toBe(false);
  const show = new Set(Array.from({ length: 2000 }, () => pickType(hand, rng, "show")));
  expect([...show].sort()).toEqual([...SHELL_TYPES].sort());
});

test("Eine Rakete ist fest aus Jahr und Saat; in der Rampe fern, in der Show auch nah; ferne zerplatzen tiefer", () => {
  const hand = handwriting(2026);
  expect(makeLaunch(hand, "x:1", "ramp_29", 0)).toEqual(makeLaunch(hand, "x:1", "ramp_29", 0));
  const ramp = Array.from({ length: 60 }, (_, i) => makeLaunch(hand, `r:${i}`, "ramp_30", 0));
  expect(ramp.every((launch) => launch.distance >= 0.45)).toBe(true);
  const show = Array.from({ length: 60 }, (_, i) => makeLaunch(hand, `s:${i}`, "show", 0));
  expect(show.some((launch) => launch.distance < 0.3)).toBe(true);
  const far = [...ramp, ...show].filter((launch) => launch.distance > 0.8);
  const near = [...ramp, ...show].filter((launch) => launch.distance < 0.2);
  const mean = (items) => items.reduce((sum, launch) => sum + launch.burstY, 0) / items.length;
  expect(mean(far)).toBeGreaterThan(mean(near));
  // Weiden sind golden, Herzen rot.
  [...ramp, ...show].filter((launch) => launch.type === "willow").forEach((launch) => expect(launch.colors[0]).toBe("gold"));
  show.filter((launch) => launch.type === "heart").forEach((launch) => expect(launch.colors[0]).toBe("red"));
});

test("Stunde: je Startsekunde des Servers eine Rakete zur richtigen Zeit - gleich bei jedem Neuladen", () => {
  const hand = handwriting(2026);
  const hourStart = Date.UTC(2026, 11, 31, 21, 0, 0);
  const plan = planHour(hand, { hourSeed: 2026365 * 1, salvos: [5, 90, 1800], phase: "evening_31", hourStart });
  expect(plan.map((launch) => launch.at)).toEqual([hourStart + 5000, hourStart + 90000, hourStart + 1800000]);
  expect(planHour(hand, { hourSeed: 2026365, salvos: [5, 90, 1800], phase: "evening_31", hourStart })).toEqual(plan);
  expect(new Set(plan.map((launch) => launch.id)).size).toBe(3);
  expect(planHour(hand, { hourSeed: 1, phase: "show" })).toEqual([]);
});

test("Große Salven um 00:00, 00:05, 00:10: je eigenes Muster - Fächer, Welle, Krone, Kaskade", () => {
  const hand = { ...handwriting(2026), salvos: ["fan", "wave", "crown"] };
  const showStart = Date.UTC(2026, 11, 31, 23, 0, 0);
  expect(salvoTimes(showStart)).toEqual([showStart, showStart + 300000, showStart + 600000]);
  const fan = salvoLaunches(hand, 0, showStart);
  expect(fan).toHaveLength(7);
  expect(new Set(fan.map((launch) => launch.x)).size).toBe(1);
  expect(fan.map((launch) => launch.drift)).toEqual([-96, -64, -32, 0, 32, 64, 96]);
  const wave = salvoLaunches(hand, 1, showStart);
  expect(wave).toHaveLength(hand.zones.length * 2 - 1);
  expect(wave[1].at - wave[0].at).toBe(280);
  const crown = salvoLaunches(hand, 2, showStart);
  expect(crown).toHaveLength(hand.zones.length + 1);
  expect(crown[crown.length - 1].type).toBe("willow");
  const cascade = salvoLaunches({ ...hand, salvos: ["cascade"] }, 0, showStart);
  expect(cascade).toHaveLength(hand.zones.length * 3);
  expect(cascade.every((launch) => launch.type === "willow")).toBe(true);
  expect(new Set([...fan, ...wave, ...crown].map((launch) => launch.id)).size).toBe(fan.length + wave.length + crown.length);
});
