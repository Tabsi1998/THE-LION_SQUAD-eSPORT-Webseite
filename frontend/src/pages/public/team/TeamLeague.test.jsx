import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TeamLeague } from "./TeamLeague";
import { leagueLine } from "@/lib/teamPage";

// Teamseite (docs/LIGA.md, P5, #1625): Abschnitt „Liga“ mit Co-Team und Staffel, Link auf die Ligaseite.

const ROW = {
  registration_id: "r1", display_name: "Probe · Probe B", squad_name: "Probe B", staffel_label: "Liga 1 · Staffel A",
  league: { name: "Probe-Liga", slug: "probe-liga" }, season: { name: "Season 1", slug: "season-1" },
  link: "/liga/probe-liga/season-1#staffel-probe-a",
};

test("zeigt Co-Team, Staffel und führt zur Ligaseite", () => {
  render(<MemoryRouter><TeamLeague overview={{ league: [ROW] }} /></MemoryRouter>);
  const link = screen.getByTestId("team-league-r1");
  expect(link).toHaveAttribute("href", "/liga/probe-liga/season-1#staffel-probe-a");
  expect(link).toHaveTextContent("Liga 1 · Staffel A");
  expect(link).toHaveTextContent("Probe B");
  expect(link).toHaveTextContent("Probe-Liga · Season 1");
  expect(leagueLine({ league: { name: "A" } })).toBe("A");
});

test("ohne Liga kein Abschnitt", () => {
  const { container } = render(<MemoryRouter><TeamLeague overview={{ league: [] }} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
