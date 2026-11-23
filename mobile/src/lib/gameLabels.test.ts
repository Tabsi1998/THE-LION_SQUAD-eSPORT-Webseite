import { gameLabel, gameOptionLabel, isArchivedGame, selectableGames } from "./gameLabels";

// Spiele zur Auswahl (Nachzug #2128 TM3, #2173): dieselben Regeln wie frontend/src/lib/gameLabels.js.

const ACTIVE = { id: "a", name: "Probe Shooter" };
const OLD = { id: "b", name: "Altspiel", status: "archived" };
const LEGACY = { id: "c", name: "Ohne Stand" };

test("ohne Stand ist ein Spiel aktiv", () => {
  expect(isArchivedGame(LEGACY)).toBe(false);
  expect(isArchivedGame({ status: "active" })).toBe(false);
  expect(isArchivedGame(OLD)).toBe(true);
  expect(isArchivedGame(null)).toBe(false);
});

test("archivierte Spiele stehen nur zur Wahl, wenn sie schon gewählt sind", () => {
  expect(selectableGames([ACTIVE, OLD, LEGACY]).map((game) => game.id)).toEqual(["a", "c"]);
  expect(selectableGames([ACTIVE, OLD, LEGACY], "b").map((game) => game.id)).toEqual(["a", "b", "c"]);
  expect(selectableGames(null)).toEqual([]);
});

test("Name mit Hauptspiel und Kurzname wie im Web", () => {
  expect(gameLabel({ id: "e", name: "Season 3", kind: "edition", parent_game: { name: "Probe Shooter" } })).toBe("Probe Shooter: Season 3");
  expect(gameLabel({ id: "f", name: "Probe Shooter: S3", kind: "edition", parent_game: { name: "Probe Shooter" } })).toBe("Probe Shooter: S3");
  expect(gameLabel({ id: "g", name: "x", display_name: "Anzeige" })).toBe("Anzeige");
  expect(gameOptionLabel(OLD)).toBe("Altspiel – archiviert");
  expect(gameOptionLabel({ ...OLD, kind: "edition", short_name: "AS1" })).toBe("Altspiel (AS1) – archiviert");
  expect(gameOptionLabel(ACTIVE)).toBe("Probe Shooter");
});
