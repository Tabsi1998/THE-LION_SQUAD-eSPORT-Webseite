import { render, screen } from "@testing-library/react";
import { GameEditor } from "./LeagueReportForm";
import { gamesProblem, repeatedMap } from "./leagueGames";

// Map-Wiederholung in einer Serie (#2096): dieselbe Map im selben Modus nur einmal (Vorgabe), anderer Modus geht;
// die Season kann es strenger („nie“) oder frei („immer“) stellen. Im Formular ist die schon gespielte Map grau.

const POOL = { modes: [
  { mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafenkante" }, { map_id: "nebel", name: "Nebelwerk" }] },
  { mode: "suchen", label: "Suchen & Zerstören", maps: [{ map_id: "hafen", name: "Hafenkante" }, { map_id: "turm", name: "Turmruine" }] },
] };
const LEAGUE = {
  best_of: 3, needed: 2, team_size: 1, mode_order: ["stellung", "suchen", "stellung"], pool: POOL,
  sides: [{ registration_id: "a", name: "Nebelwölfe" }, { registration_id: "b", name: "Sturmvögel" }],
  roster: [{ id: "u1", name: "NebelEcho" }],
};
const game = (position, mode, mapId, winner) => ({ position, mode, map_id: mapId, winner, scores: {}, lineup: ["u1"] });

test("gleiche Map im selben Modus: belegt - anderer Modus: frei", () => {
  const games = [game(1, "stellung", "hafen", "a"), game(2, "suchen", "turm", "b")];
  expect(repeatedMap(games, 3, "stellung", "hafen", LEAGUE)?.position).toBe(1);
  expect(repeatedMap(games, 2, "suchen", "hafen", LEAGUE)).toBeNull();
  expect(repeatedMap(games, 3, "stellung", "nebel", LEAGUE)).toBeNull();
});

test("Season „nie“ sperrt jede Map, „immer“ keine", () => {
  const games = [game(1, "stellung", "hafen", "a")];
  expect(repeatedMap(games, 2, "suchen", "hafen", { ...LEAGUE, map_repeat: "never" })?.position).toBe(1);
  expect(repeatedMap(games, 3, "stellung", "hafen", { ...LEAGUE, map_repeat: "always" })).toBeNull();
});

test("die Meldung sagt es, bevor etwas an den Server geht", () => {
  const games = [game(1, "stellung", "hafen", "a"), game(2, "suchen", "turm", "b"), game(3, "stellung", "hafen", "a")];
  expect(gamesProblem(games, LEAGUE)).toBe("Map 3: diese Map lief schon als Map 1 im selben Modus – bitte eine andere wählen.");
  expect(gamesProblem(games, { ...LEAGUE, map_repeat: "always" })).toBeNull();
});

test("im Formular ist die schon gespielte Map ausgegraut", () => {
  const games = [game(1, "stellung", "hafen", "a"), game(2, "suchen", "turm", "b"), game(3, "stellung", "", "")];
  render(<GameEditor game={games[2]} games={games} index={2} league={LEAGUE} onChange={() => {}} />);
  expect(screen.getByTestId("league-game-3-map-hafen")).toBeDisabled();
  expect(screen.getByTestId("league-game-3-map-hafen")).toHaveAttribute("title", "Lief schon als Map 1");
  expect(screen.getByTestId("league-game-3-map-nebel")).toBeEnabled();
});

test("Season-Formular: Vorgabe „gleiche Map nur in anderem Modus“, die Wahl geht mit", async () => {
  const { MAP_REPEAT_OPTIONS, seasonPayload, seasonToForm } = await import("@/lib/league");
  expect(MAP_REPEAT_OPTIONS.map(([value]) => value)).toEqual(["other_mode", "never", "always"]);
  const form = seasonToForm({ name: "Season 1" });
  expect(form.map_repeat).toBe("other_mode");
  expect(seasonPayload({ ...form, map_repeat: "never" }).map_repeat).toBe("never");
});
