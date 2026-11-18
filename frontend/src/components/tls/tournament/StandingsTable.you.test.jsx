import { render, screen } from "@testing-library/react";
import { StandingsTable } from "./StandingsTable";

// Ecken-Klammern (#1316): In der Rangliste trägt nur deine Zeile Winkel, Fläche und „Du“ - an der Kante der Zeile
// (tls-you--inset), weil die Tabelle in einem wischbaren Rahmen liegt. „Verein“ (Rennserien) ist kein „du“.

const ROWS = [
  { registration_id: "r1", rank: 1, display_name: "NeonFalke", points: 9 },
  { registration_id: "r2", rank: 2, display_name: "Spieler", points: 6, is_mine: true },
  { registration_id: "r3", rank: 3, display_name: "LunaByte", points: 3 },
];

test("nur die eigene Zeile trägt Ecken und „Du“", () => {
  render(<StandingsTable rows={ROWS} />);
  const own = screen.getByTestId("standing-row-r2");
  expect(own).toHaveClass("tls-you", "tls-you--inset");
  expect(own).toHaveTextContent("Du");
  for (const id of ["r1", "r3"]) {
    expect(screen.getByTestId(`standing-row-${id}`)).not.toHaveClass("tls-you");
    expect(screen.getByTestId(`standing-row-${id}`)).not.toHaveTextContent("Du");
  }
  expect(document.querySelectorAll(".tls-you")).toHaveLength(1);
});

test("ohne eigene Zeile keine Ecken", () => {
  render(<StandingsTable rows={ROWS.map(({ is_mine: _mine, ...row }) => row)} />);
  expect(document.querySelectorAll(".tls-you")).toHaveLength(0);
});

test("„Dein Team“ trägt die Ecken, „Verein“ (Rennserien) nicht", () => {
  const { unmount } = render(<StandingsTable rows={ROWS} kind="team_league" mineLabel="Dein Team" />);
  expect(screen.getByTestId("standing-row-r2")).toHaveClass("tls-you");
  unmount();
  render(<StandingsTable rows={ROWS} kind="team_league" mineLabel="Verein" />);
  expect(screen.getByTestId("standing-row-r2")).not.toHaveClass("tls-you");
  expect(screen.getByTestId("standing-row-r2")).toHaveTextContent("Verein");
});
