import { render, screen, within } from "@testing-library/react";
import { GameEditor } from "./LeagueReportForm";
import { sidesInSlotOrder } from "./leagueGames";

// Sieger-Knöpfe in der Reihenfolge der Plätze (#2096, Browser-Durchlauf): Heim links wie in der Überschrift - auch wenn
// die Seiten in anderer Reihenfolge ankommen. Erfundene Namen.

const MATCH = { slots: [{ slot: 1, registration_id: "nebel" }, { slot: 2, registration_id: "sturm" }] };
const LEAGUE = {
  best_of: 3,
  needed: 2,
  team_size: 1,
  mode_order: ["stellung"],
  pool: { modes: [{ mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafenkante" }] }] },
  sides: [{ registration_id: "sturm", name: "Sturmvögel" }, { registration_id: "nebel", name: "Nebelwölfe" }],
  roster: [{ id: "u1", name: "NebelEcho" }],
};

test("die Seiten folgen den Plätzen des Spiels", () => {
  const ordered = sidesInSlotOrder(LEAGUE, MATCH);
  expect(ordered.sides.map((side) => side.registration_id)).toEqual(["nebel", "sturm"]);
  expect(LEAGUE.sides[0].registration_id).toBe("sturm");
});

test("schon richtig, ohne Plätze oder ohne Liga: unverändert", () => {
  const ordered = sidesInSlotOrder(LEAGUE, MATCH);
  expect(sidesInSlotOrder(ordered, MATCH)).toBe(ordered);
  expect(sidesInSlotOrder(LEAGUE, {})).toBe(LEAGUE);
  expect(sidesInSlotOrder(null, MATCH)).toBeNull();
});

test("im Formular steht die Heimseite links", () => {
  const game = { position: 1, mode: "stellung", map_id: "", winner: "", scores: {}, lineup: [] };
  render(<GameEditor game={game} index={0} league={sidesInSlotOrder(LEAGUE, MATCH)} onChange={() => {}} />);
  const buttons = within(screen.getByRole("group", { name: "Sieger Map 1" })).getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual(["Nebelwölfe", "Sturmvögel"]);
});
