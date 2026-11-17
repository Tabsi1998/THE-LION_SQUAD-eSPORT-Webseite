import { render, screen } from "@testing-library/react";
import { StandingsTable } from "./StandingsTable";

// Der volle Name als `title` nur auf Wunsch (Staffel-Seite der Verwaltung, #2262) - öffentliche Tabellen bleiben, wie sie sind.

const ROWS = [{ registration_id: "r1", rank: 1, display_name: "Wolkenkratzer-Sturmfalken Ostalpen · Zweite Mannschaft Reserve", points: 3 }];

test("ohne nameTitle trägt der Name keinen title", () => {
  render(<StandingsTable rows={ROWS} kind="team_league" />);
  expect(screen.getByText(ROWS[0].display_name)).not.toHaveAttribute("title");
});

test("mit nameTitle steht der volle Name im title", () => {
  render(<StandingsTable rows={ROWS} kind="team_league" nameTitle />);
  expect(screen.getByText(ROWS[0].display_name)).toHaveAttribute("title", ROWS[0].display_name);
});
