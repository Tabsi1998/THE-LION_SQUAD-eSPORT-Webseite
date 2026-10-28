import { render, screen } from "@testing-library/react";
import { TournamentFlowStepper } from "./TournamentFlowStepper";

// Ablauf-Leiste (#2109, S17): je Kontext die passenden Schritte, deutsche Begriffe.

const STAFFEL = { id: "t-s", status: "draft", format: "league", team_mode: "team",
  league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" } };

const labels = () => screen.getAllByRole("button").map((button) => button.querySelector("span + span")?.textContent);

test("ein Turnier: Anmeldung, Check-in, Setzliste, Turnierbaum, Ergebnisse, Endstand", () => {
  render(<TournamentFlowStepper tournament={{ status: "registration_open" }} registrations={[]} matchesV2={[]} />);
  expect(screen.getByText("Turnier-Ablauf")).toBeInTheDocument();
  expect(labels()).toEqual(["Anmeldung", "Check-in", "Setzliste", "Turnierbaum", "Ergebnisse", "Endstand"]);
});

test("eine Staffel: Co-Teams zuteilen, Liga starten, Spieltage, Tabelle - ohne Anmeldung und Check-in", () => {
  const regs = [{ id: "r1", status: "approved" }, { id: "r2", status: "approved" }];
  render(<TournamentFlowStepper tournament={STAFFEL} registrations={regs} matchesV2={[{ id: "m1", status: "preview" }]} />);
  expect(screen.getByText("Liga-Ablauf")).toBeInTheDocument();
  expect(labels()).toEqual(["Co-Teams zuteilen", "Liga starten", "Spieltage", "Tabelle"]);
  expect(screen.getByTestId("flow-step-assign")).toHaveTextContent("2 zugeteilt");
  // Zwei Co-Teams reichen zum Start: der nächste Schritt ist „Liga starten“.
  expect(screen.getByTestId("flow-step-start")).toHaveAttribute("aria-current", "step");
  expect(screen.queryByText("Check-in")).toBeNull();
});

test("eine laufende Staffel zählt die Spieltage", () => {
  const matches = [{ id: "m1", status: "completed" }, { id: "m2", status: "scheduled" }];
  render(<TournamentFlowStepper tournament={{ ...STAFFEL, status: "live" }} registrations={[]} matchesV2={matches} />);
  expect(screen.getByTestId("flow-step-matchdays")).toHaveTextContent("1/2 Spiele");
  expect(screen.getByTestId("flow-step-matchdays")).toHaveAttribute("aria-current", "step");
});
