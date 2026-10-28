import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { LineupPicker } from "./LeagueReportForm";

// Spieler-Chips der Aufstellung (#2096, Browser-Durchlauf): der Platz fürs Häkchen ist immer da - ein Chip wird beim
// Antippen nicht breiter, die Reihe springt nicht. Erfundene Namen.

const ROSTER = [{ id: "a", name: "NebelEcho" }, { id: "b", name: "NebelFunke" }];

function Picker() {
  const [value, setValue] = useState([]);
  return <LineupPicker roster={ROSTER} value={value} size={2} onChange={setValue} testId="pick" />;
}

test("jeder Chip hat den Platz fürs Häkchen - gewählt oder nicht", () => {
  render(<Picker />);
  const chip = screen.getByTestId("pick-a");
  const before = chip.innerHTML.length;
  expect(chip.querySelector("[data-check-slot]")).not.toBeNull();
  expect(chip.querySelector("[data-check-slot] svg")).toBeNull();

  fireEvent.click(chip);

  expect(chip).toHaveAttribute("aria-pressed", "true");
  expect(chip.querySelector("[data-check-slot] svg")).not.toBeNull();
  expect(screen.getByTestId("pick-b").querySelector("[data-check-slot]")).not.toBeNull();
  expect(chip.innerHTML.length).toBeGreaterThan(before);
});
