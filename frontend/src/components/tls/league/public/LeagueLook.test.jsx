import { fireEvent, render, screen } from "@testing-library/react";
import { LeagueHead } from "./LeagueLook";

// Kopf der Ligaseite (#2107): der Ladezustand gehört zur Banner-Adresse - ein neues Banner beginnt wieder bei „lädt“.

const look = (url) => ({ emblem_url: null, accent_color: null, banner: { url, x: 50, y: 50, mobile_x: 50, mobile_y: 50 } });

test("ein kaputtes Banner fällt weg, ein neues Banner bekommt wieder seine Chance", () => {
  const { rerender } = render(<LeagueHead look={look("/api/static/uploads/a.webp")} title="Probe-Liga" />);
  const head = screen.getByTestId("league-head");
  fireEvent.error(screen.getByTestId("league-head-banner").querySelector("img"));
  expect(head).toHaveAttribute("data-banner", "false");

  rerender(<LeagueHead look={look("/api/static/uploads/b.webp")} title="Probe-Liga" />);
  expect(head).toHaveAttribute("data-banner", "true");
  const image = screen.getByTestId("league-head-banner").querySelector("img");
  expect(image).toHaveAttribute("data-loaded", "false");
  fireEvent.load(image);
  expect(image).toHaveAttribute("data-loaded", "true");

  rerender(<LeagueHead look={look("/api/static/uploads/c.webp")} title="Probe-Liga" />);
  expect(screen.getByTestId("league-head-banner").querySelector("img")).toHaveAttribute("data-loaded", "false");
});

test("die Akzentfarbe setzt im Kopf auch die Markenfarbe, ohne Farbe bleibt die Vereinsfarbe", () => {
  const { rerender } = render(<LeagueHead look={{ ...look(""), accent_color: "#FFB020" }} title="Probe-Liga" />);
  expect(screen.getByTestId("league-head").getAttribute("style")).toContain("--tls-brand-rgb: 255 176 32");
  rerender(<LeagueHead look={look("")} title="Probe-Liga" />);
  expect(screen.getByTestId("league-head").getAttribute("style") || "").not.toContain("--tls-brand-rgb");
});
