import { render, screen } from "@testing-library/react";
import { StandingsTable, nameParts } from "./StandingsTable";

// Lange Namen (#2262, #2498): der volle Name steht in jeder Tabelle im `title` - Verwaltung und öffentliche Seiten gleich;
// nach Punkt, Unterstrich und Schrägstrich darf die Zeile umbrechen; am Handy fällt die Form weg, damit Name und Punkte
// nebeneinander Platz haben.

const ROWS = [{ registration_id: "r1", rank: 1, display_name: "Wolkenkratzer-Sturmfalken Ostalpen · Zweite Mannschaft Reserve", points: 3, form: ["W", "L"] }];

test("der volle Name steht immer im title", () => {
  render(<StandingsTable rows={ROWS} kind="team_league" />);
  expect(screen.getByText(ROWS[0].display_name)).toHaveAttribute("title", ROWS[0].display_name);
});

test("ohne Namen steht „Teilnehmer“ da, auch im title", () => {
  render(<StandingsTable rows={[{ registration_id: "r2", rank: 2, display_name: "", points: 0 }]} />);
  expect(screen.getByText("Teilnehmer")).toHaveAttribute("title", "Teilnehmer");
});

test("Umbruchstellen nach Punkt, Unterstrich und Schrägstrich - der Text bleibt derselbe", () => {
  const name = "xX_Nebelwolf_Xx.Rudel.Ostmark";
  render(<StandingsTable rows={[{ registration_id: "r3", rank: 1, display_name: name, points: 3 }]} />);
  const node = screen.getByText(name);
  expect(node.querySelectorAll("wbr")).toHaveLength(4);
  expect(node.textContent).toBe(name);
});

test("nameParts: Kürzel, Leerzeichen, Anfang und Ende bleiben beisammen", () => {
  expect(nameParts("xX_Nebelwolf_Xx.Rudel.Ostmark")).toEqual(["xX_", "Nebelwolf_", "Xx.", "Rudel.", "Ostmark"]);
  expect(nameParts("Probe Löwen e.V.")).toEqual(["Probe Löwen e.V."]);
  expect(nameParts("Nord / Süd")).toEqual(["Nord / Süd"]);
  expect(nameParts("_Rudel.")).toEqual(["_Rudel."]);
  expect(nameParts("Graz/Wien")).toEqual(["Graz/", "Wien"]);
  expect(nameParts(null)).toEqual([""]);
});

test("am Handy fällt die Form weg, Punkte bleiben", () => {
  render(<StandingsTable rows={ROWS} kind="team_league" />);
  expect(screen.getByRole("columnheader", { name: "Form" })).toHaveClass("hidden", "sm:table-cell");
  expect(screen.getByRole("columnheader", { name: "Pkt" })).not.toHaveClass("hidden");
  expect(document.querySelector('td[data-col="form"]')).toHaveClass("hidden", "sm:table-cell");
});
