import fixture from "../../e2e/fixtures/tableScheduleGenerated.json";
import { PLACEMENT_LOOKS, markPlacementShown, placementFor, placementShown, podiumPlaces } from "./placementMoment";

// Sieger-Moment und Podest (#1180, #1339): wer aus der echten Rangliste (scripts/make_table_schedule_fixture.py) einen
// Moment bekommt - nur Platz 1 bis 3, nur nach dem Ende, nur die eigene Anmeldung, einmal je Browser.

const { tournament, standings } = fixture.finished;

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
}

test("der Sieger eines beendeten Turniers bekommt den goldenen Moment", () => {
  const placement = placementFor(tournament, standings);
  const mine = standings.find((row) => row.is_mine);
  expect(mine.rank).toBe(1);
  expect(placement).toMatchObject({ rank: 1, metal: "gold", title: "Champion", registrationId: mine.registration_id, name: mine.display_name });
  expect(placement.key).toBe(`${tournament.id}:${mine.registration_id}`);
});

test("Platz 2 und 3 still in Silber und Bronze, Platz 4 bekommt nichts", () => {
  const as = (rank) => standings.map((row) => ({ ...row, is_mine: row.rank === rank }));
  expect(placementFor(tournament, as(2))).toMatchObject({ rank: 2, metal: "silver", title: "Zweiter Platz" });
  expect(placementFor(tournament, as(3))).toMatchObject({ rank: 3, metal: "bronze", title: "Dritter Platz" });
  expect(placementFor(tournament, as(4))).toBeNull();
  expect(Object.keys(PLACEMENT_LOOKS)).toEqual(["1", "2", "3"]);
});

test("vor dem Ende, ohne eigene Zeile oder bei Gruppentabellen gibt es keinen Moment", () => {
  expect(placementFor({ ...tournament, status: "live" }, standings)).toBeNull();
  // „Beendet“ ist noch nicht der bestätigte Endstand - erst „Ergebnisse veröffentlicht“ (Statusvertrag).
  expect(placementFor({ ...tournament, status: "completed" }, standings)).toBeNull();
  expect(placementFor({ ...tournament, status: "results_published" }, standings)).not.toBeNull();
  expect(placementFor({ ...tournament, status: "archived" }, standings)).not.toBeNull();
  expect(placementFor(tournament, standings.map(({ is_mine: _mine, ...row }) => row))).toBeNull();
  expect(placementFor(fixture.groups.tournament, fixture.groups.standings)).toBeNull();
});

test("einmal je Browser: gemerkt wird je Turnier und Anmeldung", () => {
  const storage = memoryStorage();
  const placement = placementFor(tournament, standings);
  expect(placementShown(placement, storage)).toBe(false);
  markPlacementShown(placement, storage);
  expect(placementShown(placement, storage)).toBe(true);
  expect(placementShown({ ...placement, key: "anderes" }, storage)).toBe(false);
  // Ohne Speicher (privates Fenster, gesperrt) lieber kein Moment als einer bei jedem Öffnen.
  const broken = { getItem: () => { throw new Error("gesperrt"); }, setItem: () => { throw new Error("gesperrt"); } };
  expect(placementShown(placement, broken)).toBe(true);
  expect(() => markPlacementShown(placement, broken)).not.toThrow();
});

test("Podest: Platz 2 links, 1 in der Mitte, 3 rechts - Gleichstand nebeneinander, fehlende Plätze leer", () => {
  const places = podiumPlaces(standings);
  expect(places.map((place) => place.rank)).toEqual([2, 1, 3]);
  expect(places.map((place) => place.rows.length)).toEqual([1, 1, 1]);
  // Zwei dritte Plätze (abgeleitet aus der echten Rangliste: der vierte teilt sich Platz 3).
  const tied = podiumPlaces(standings.map((row) => (row.rank === 4 ? { ...row, rank: 3 } : row)));
  expect(tied[2].rows).toHaveLength(2);
  const twoOnly = podiumPlaces(standings.filter((row) => row.rank <= 2));
  expect(twoOnly[2].rows).toEqual([]);
  expect(podiumPlaces([])).toEqual([]);
});
