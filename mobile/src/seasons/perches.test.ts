import { KIND_WEIGHTS, assign, assignmentsFor, choosePerches, clearAssignment, perchPoint, perchSnapshot, perchesFor, placementFor, registerPerch, resetPerches, subscribePerches, unregisterPerch, type Perch } from "./perches";

// Plätze (A1): Karten melden sich je Screen an und ab, die Auswahl ist gesät und nimmt nie zwei an derselben Karte,
// Belegung wird eingetragen und mit der Karte wieder gelöscht; Ecke und Haltung aus dem Seed; Punkt aus dem Rechteck.

function rngOf(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

const perch = (id: string, screen = "Dashboard", kind: Perch["kind"] = "card"): Perch => ({ id, screen, kind, measure: async () => ({ x: 10, y: 100, width: 300, height: 120 }) });

beforeEach(() => resetPerches());

test("an- und abmelden je Screen, Belegung folgt der Karte", () => {
  const seen: number[] = [];
  const stop = subscribePerches((state) => seen.push(state.perches.length));
  registerPerch(perch("a"));
  registerPerch(perch("b", "NewsList"));
  registerPerch(perch("a"));
  expect(perchesFor("Dashboard").map((entry) => entry.id)).toEqual(["a"]);
  expect(perchesFor("NewsList").map((entry) => entry.id)).toEqual(["b"]);
  assign([{ perchId: "a", corner: "tl", pose: "sit", size: 20, temperament: "sleepy" }]);
  expect(assignmentsFor("Dashboard").length).toBe(1);
  expect(assignmentsFor("NewsList").length).toBe(0);
  unregisterPerch("a");
  unregisterPerch("a");
  expect(perchSnapshot().assignments).toEqual({});
  expect(seen).toEqual([1, 2, 2, 2, 1]);
  clearAssignment("zzz");
  stop();
});

test("Auswahl nach Gewicht, nie zwei an derselben Karte, seeded; Belegte bleiben belegt", () => {
  const candidates = [perch("c1"), perch("c2"), perch("t1", "Dashboard", "tile"), perch("h", "Dashboard", "hero")];
  const chosen = choosePerches(candidates, 2, rngOf([0.1, 0.5, 0.9, 0.2]));
  expect(chosen.length).toBe(2);
  expect(new Set(chosen.map((entry) => entry.id)).size).toBe(2);
  expect(choosePerches(candidates, 2, rngOf([0.1, 0.5, 0.9, 0.2]))).toEqual(chosen);
  expect(choosePerches(candidates, 1, rngOf([0.0, 0.0]))[0].kind).toBe("card");
  expect(choosePerches(candidates, 1, rngOf([0.99, 0.0]))[0].kind).toBe("hero");
  expect(choosePerches(candidates, 9, rngOf([0.3])).length).toBe(4);
  expect(choosePerches(candidates, 2, rngOf([0.3]), ["c1", "c2", "t1", "h"])).toEqual([]);
  expect(KIND_WEIGHTS.card).toBeGreaterThan(KIND_WEIGHTS.hero);
});

test("Ecke und Haltung aus dem Seed, Banner immer hängend; der Punkt aus dem Rechteck", () => {
  expect(placementFor(perch("a"), () => 0.1)).toEqual({ corner: "tl", pose: "sit", size: 20 });
  expect(placementFor(perch("a"), () => 0.6)).toEqual({ corner: "tr", pose: "sit", size: 20 });
  expect(placementFor(perch("a"), () => 0.9)).toEqual({ corner: "bottom", pose: "hang", size: 22 });
  expect(placementFor(perch("b", "Dashboard", "banner"), () => 0.1)).toEqual({ corner: "bottom", pose: "hang", size: 22 });
  const rect = { x: 10, y: 100, width: 300, height: 120 };
  expect(perchPoint(rect, "tl")).toEqual({ x: 32, y: 100 });
  expect(perchPoint(rect, "tr")).toEqual({ x: 288, y: 100 });
  expect(perchPoint(rect, "bottom")).toEqual({ x: 160, y: 220 });
});
