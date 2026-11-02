import { gameLabel, gameOptionLabel, isArchivedGame, selectableGames } from "./gameLabels";

const ACTIVE = { id: "a", name: "Probe Shooter" };
const OLD = { id: "b", name: "Altspiel", status: "archived" };
const LEGACY = { id: "c", name: "Ohne Stand" };

test("ohne Stand ist ein Spiel aktiv", () => {
  expect(isArchivedGame(LEGACY)).toBe(false);
  expect(isArchivedGame({ status: "active" })).toBe(false);
  expect(isArchivedGame(OLD)).toBe(true);
  expect(isArchivedGame(null)).toBe(false);
});

test("zur Wahl stehen nur aktive – das schon gewählte archivierte bleibt drin", () => {
  expect(selectableGames([ACTIVE, OLD, LEGACY]).map((game) => game.id)).toEqual(["a", "c"]);
  expect(selectableGames([ACTIVE, OLD, LEGACY], "b").map((game) => game.id)).toEqual(["a", "b", "c"]);
  expect(selectableGames([ACTIVE, OLD], "a").map((game) => game.id)).toEqual(["a"]);
  expect(selectableGames(null)).toEqual([]);
});

test("die Auswahl sagt, dass es archiviert ist; der Name bleibt überall sonst gleich", () => {
  expect(gameOptionLabel(OLD)).toBe("Altspiel – archiviert");
  expect(gameLabel(OLD)).toBe("Altspiel");
  expect(gameOptionLabel(ACTIVE)).toBe("Probe Shooter");
  expect(gameOptionLabel({ ...OLD, kind: "edition", short_name: "AS1" })).toBe("Altspiel (AS1) – archiviert");
});
