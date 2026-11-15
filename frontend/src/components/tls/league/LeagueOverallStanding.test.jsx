import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LeagueOverallStanding } from "./LeagueOverallStanding";

// Platz in der Gesamtwertung an Profil und Teamseite (F.5, #2215): „Gesamtsieger“ nur bei einem vollständigen Endstand.
const row = (extra) => ({ league_name: "Probe-Liga", period_name: "2027", division_label: "Liga 1", level: 1, place: 1, of: 4, points: 9,
  closed: true, complete: true, url: "/liga/probe-liga/season-2/gesamtwertung", ...extra });

test("vollständiger Endstand: Gesamtsieger mit Link", () => {
  render(<MemoryRouter><LeagueOverallStanding rows={[row()]} /></MemoryRouter>);
  expect(screen.getByTestId("league-overall-1")).toHaveTextContent("Gesamtsieger");
  expect(screen.getByRole("link", { name: "Probe-Liga · 2027" })).toHaveAttribute("href", "/liga/probe-liga/season-2/gesamtwertung");
});

test("Gegenprobe: Teilansicht ohne nicht öffentliche Seasons - kein Gesamtsieger, ehrlicher Stand", () => {
  render(<MemoryRouter><LeagueOverallStanding rows={[row({ complete: false })]} /></MemoryRouter>);
  const item = screen.getByTestId("league-overall-1");
  expect(item).not.toHaveTextContent("Gesamtsieger");
  expect(item).toHaveTextContent("Endstand ohne nicht öffentliche Seasons");
});
