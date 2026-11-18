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

test("vereinsintern (#2521): eine Wertung mit internen Seasons trägt das Etikett, eine öffentliche nicht", () => {
  render(<MemoryRouter><LeagueOverallStanding rows={[row({ internal: true }), row({ level: 2, internal: false })]} /></MemoryRouter>);
  expect(screen.getByTestId("league-overall-1")).toHaveTextContent("Vereinsintern");
  expect(screen.getByTestId("league-overall-2")).not.toHaveTextContent("Vereinsintern");
});

test("Wertung nur aus Seasons, die die Person nicht öffnen darf (#2521): Text statt Link, mit Etikett", () => {
  render(<MemoryRouter><LeagueOverallStanding rows={[row({ url: null, internal: true, complete: false, closed: false })]} /></MemoryRouter>);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByTestId("league-overall-1")).toHaveTextContent("Probe-Liga · 2027");
  expect(screen.getByTestId("league-overall-1-internal")).toHaveTextContent("Vereinsintern");
});
