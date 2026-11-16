import { inheritedPlatform } from "./GameIdsTab";

// Review #2281: das Hauptspiel kommt aus dem Formular des Reiters Allgemein, auch wenn es noch nicht gespeichert ist.
const GAMES = [
  { id: "v1", name: "Version", kind: "edition", parent_game_id: "alt" },
  { id: "alt", name: "Altes Hauptspiel", player_id_fields: [] },
  { id: "neu", name: "Neues Hauptspiel", player_id_fields: [{ key: "plattform", label: "Plattform", options: ["PC"], platform: true }] },
];

test("das Hauptspiel aus dem Formular zählt, nicht das gespeicherte", () => {
  expect(inheritedPlatform(GAMES, "v1", {})).toBeNull();
  expect(inheritedPlatform(GAMES, "v1", {}, "neu")).toEqual({ game: "Neues Hauptspiel", label: "Plattform" });
  expect(inheritedPlatform(GAMES, "v1", { inherit_player_ids: false }, "neu")).toBeNull();
  expect(inheritedPlatform(GAMES, "v1", {}, "")).toBeNull();
});
