import { compareRows, lockResultText, minMapsForm, minMapsPayload, minMapsProblem, poolMapChoices } from "./seasonPools";

// Map-Pool einer Season absichern (#2207). Erfundene Maps.
const REQUIREMENTS = [
  { mode: "stellung", label: "Stellung", derived: 2, override: null, needed: 2, have: 1 },
  { mode: "suchen", label: "Suchen", derived: 1, override: 3, needed: 3, have: 3 },
];

test("die Mindestgröße: leer heißt abgeleitet, eigene Zahlen gehen an den Server", () => {
  const form = minMapsForm(REQUIREMENTS);
  expect(form).toEqual({ stellung: "", suchen: "3" });
  expect(minMapsPayload(REQUIREMENTS, { ...form, stellung: " 4 " })).toEqual([{ mode: "stellung", min_maps: 4 }, { mode: "suchen", min_maps: 3 }]);
  expect(minMapsPayload(REQUIREMENTS, { stellung: "", suchen: "" })).toEqual([]);
  expect(minMapsPayload([{ mode: null, label: "Alle Maps" }], { "": "2" })).toEqual([{ mode: null, min_maps: 2 }]);
});

test("eine Mindestgröße außerhalb von 1 bis 50 wird genannt", () => {
  expect(minMapsProblem({ stellung: "0" })).toMatch("zwischen 1 und 50");
  expect(minMapsProblem({ stellung: "2.5" })).toMatch("ganze Zahl");
  expect(minMapsProblem({ stellung: "51" })).not.toBe("");
  expect(minMapsProblem({ stellung: "", suchen: "7" })).toBe("");
});

test("die Maps eines Pools für „Map sperren“ stehen einmal mit ihren Modi da", () => {
  const pool = { modes: [
    { mode: "stellung", label: "Stellung", maps: [{ map_id: "h", name: "Hafenkante" }, { map_id: "t", name: "Turmblick" }] },
    { mode: "suchen", label: "Suchen", maps: [{ map_id: "h", name: "Hafenkante" }] },
  ] };
  expect(poolMapChoices(pool)).toEqual([
    { map_id: "h", name: "Hafenkante", modes: [{ mode: "stellung", label: "Stellung" }, { mode: "suchen", label: "Suchen" }] },
    { map_id: "t", name: "Turmblick", modes: [{ mode: "stellung", label: "Stellung" }] },
  ]);
  expect(poolMapChoices(null)).toEqual([]);
});

test("der Vergleich zeigt je Modus neu, weg und geblieben", () => {
  const rows = compareRows({ modes: [
    { mode: "stellung", label: "Stellung", added: [{ map_id: "g", name: "Glutsenke" }], removed: [], kept: 2, status: "changed" },
    { mode: null, label: "Alle Maps", added: [], removed: [{ map_id: "h", name: "Hafenkante" }], kept: 0, status: "removed" },
  ] });
  expect(rows).toEqual([
    { key: "stellung", label: "Stellung", status: "changed", statusText: "geändert", added: ["Glutsenke"], removed: [], kept: 2 },
    { key: "alle", label: "Alle Maps", status: "removed", statusText: "nicht mehr im Pool", added: [], removed: ["Hafenkante"], kept: 0 },
  ]);
});

test("das Ergebnis je Staffel sagt, ob übertragen wurde und warum nicht", () => {
  expect(lockResultText({ applied: true, notes: [] })).toBe("übertragen");
  expect(lockResultText({ applied: false, notes: ["Es gibt schon ein Ergebnis."] })).toBe("nicht übertragen – Es gibt schon ein Ergebnis.");
});
