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

test("Emblem der Season bzw. Liga klein vor der Staffel (#2107), ohne Bild das Liga-Zeichen", () => {
  render(<MemoryRouter><TeamLeague overview={{ league: [{ ...ROW, emblem_url: "/api/static/uploads/probe-emblem.png" }, { ...ROW, registration_id: "r2" }] }} /></MemoryRouter>);
  expect(screen.getByTestId("team-league-emblem-r1").querySelector("img")).toHaveAttribute("src", expect.stringContaining("/api/static/uploads/probe-emblem.png"));
  expect(screen.getByTestId("team-league-emblem-r2")).toHaveAttribute("data-empty", "true");
});

test("ohne Liga kein Abschnitt", () => {
  const { container } = render(<MemoryRouter><TeamLeague overview={{ league: [] }} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});

test("„Angemeldet für“ blendet aus, was schon im Abschnitt „Liga“ steht", async () => {
  const { TeamSchedule } = await import("./TeamSchedule");
  const overview = { recent: [], upcoming: [
    { registration_id: "r1", in_league_section: true, status_label: "Angemeldet", tournament: { id: "t1", title: "Staffel A" } },
    { registration_id: "r2", status_label: "Angemeldet", tournament: { id: "t2", title: "Herbst-Cup" } },
  ] };
  render(<MemoryRouter><TeamSchedule overview={overview} /></MemoryRouter>);
  expect(screen.queryByTestId("team-upcoming-r1")).toBeNull();
  expect(screen.getByTestId("team-upcoming-r2")).toHaveTextContent("Herbst-Cup");
});
