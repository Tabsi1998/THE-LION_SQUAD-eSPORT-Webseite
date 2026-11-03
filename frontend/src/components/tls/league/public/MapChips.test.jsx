import { render, screen } from "@testing-library/react";
import { MapChips } from "./StaffelPanel";

// Öffentliche Ligaseite (docs/LIGA.md, C.3, #1617): wie die Matchseite „wiederholt“, „zugesprochen“ und die nach dem Serienende
// nicht gespielten Maps. Erfundene Namen.

const MATCH = {
  id: "m1", done: true, not_played: [4, 5],
  home: { registration_id: "a", name: "Rudel A" }, away: { registration_id: "b", name: "Horst" },
  games: [
    { position: 1, map_name: "Hafen", winner_registration_id: "a", status: "replayed", replay_reason: "Verbindung brach ab" },
    { position: 2, map_name: "Turm", winner_registration_id: "a", decision: "awarded" },
    { position: 3, map_name: "Nebel", winner_registration_id: "a" },
  ],
};

test("wiederholt, zugesprochen und nicht gespielt stehen an den Maps", () => {
  render(<MapChips match={MATCH} />);

  expect(screen.getByTestId("league-map-m1-1")).toHaveTextContent("für Rudel A · wiederholt");
  expect(screen.getByTestId("league-map-m1-1")).toHaveAttribute("title", "Map 1: Hafen – Rudel A · wiederholt: Verbindung brach ab");
  expect(screen.getByTestId("league-map-m1-2")).toHaveTextContent("für Rudel A · zugesprochen");
  expect(screen.getByTestId("league-map-m1-3")).toHaveTextContent("für Rudel A");
  expect(screen.getByTestId("league-map-m1-3")).not.toHaveTextContent("·");
  expect(screen.getByTestId("league-maps-m1-not-played")).toHaveTextContent("Map 4 und 5 nicht gespielt – die Serie war entschieden.");
});

test("ohne Zusatzfelder wie vorher, ohne Hinweis auf nicht gespielte Maps", () => {
  render(<MapChips match={{ ...MATCH, not_played: undefined, games: [MATCH.games[2]] }} />);
  expect(screen.queryByTestId("league-maps-m1-not-played")).toBeNull();
});
