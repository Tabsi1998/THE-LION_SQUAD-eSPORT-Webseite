import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LeagueSeasonHistory } from "./LeagueSeasonHistory";

// Season-Historie (F.2, #1627): Season, Liga N, Platz, Meister, Auf- oder Abstieg. Nur erfundene Namen.
const ROWS = [
  { season_id: "s2", season_name: "Season 2", league_name: "Probe-Liga", url: "/liga/probe/season-2", division_label: "Liga 1", staffel: "A", display_name: "Loewen · Eins",
    rank: 1, of: 8, champion: true, zone: null },
  { season_id: "s1", season_name: "Season 1", league_name: "Probe-Liga", url: null, division_label: "Liga 2", staffel: "A", display_name: "Loewen · Eins",
    rank: 1, of: 6, champion: false, zone: "promotion" },
  { season_id: "s0", season_name: "Season 0", league_name: "Probe-Liga", url: null, division_label: "Liga 1", staffel: "B", display_name: "Loewen · Eins",
    rank: 6, of: 6, champion: false, zone: "out", exit: "disqualified" },
];

test("je Season Liga, Platz, Meister und Aufstieg - ohne Einträge nichts", () => {
  const { unmount } = render(<MemoryRouter><LeagueSeasonHistory rows={ROWS} showTeam testId="h" /></MemoryRouter>);
  expect(screen.getByTestId("h-s2")).toHaveTextContent("Meister");
  expect(screen.getByTestId("h-s2")).toHaveTextContent("Platz 1 von 8");
  expect(screen.getByRole("link", { name: "Probe-Liga · Season 2" })).toHaveAttribute("href", "/liga/probe/season-2");
  expect(screen.getByTestId("h-s1")).toHaveTextContent("Liga 2 · Staffel A · Loewen · Eins");
  expect(screen.getByTestId("h-s1")).toHaveTextContent("Aufstieg");
  expect(screen.getByTestId("h-s1")).not.toHaveTextContent("Meister");
  expect(screen.getByTestId("h-s0")).toHaveTextContent("disqualifiziert");
  unmount();
  const { container } = render(<MemoryRouter><LeagueSeasonHistory rows={[]} testId="h" /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
