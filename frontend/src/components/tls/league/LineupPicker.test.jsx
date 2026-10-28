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

test("ohne gültige Spiel-ID (#2108) ist der Chip grau und der Grund steht darunter", () => {
  const onChange = vi.fn();
  const roster = [
    { id: "a", name: "NebelEcho", game_id_text: "Nebel#1234567", lineup_blocked: null },
    { id: "b", name: "NebelFunke", game_id_text: null, lineup_blocked: "Activision-ID fehlt im Profil." },
  ];
  render(<LineupPicker roster={roster} value={[]} size={2} onChange={onChange} testId="pick" />);

  const blocked = screen.getByTestId("pick-b");
  expect(blocked).toBeDisabled();
  expect(blocked).toHaveAttribute("data-blocked", "true");
  expect(screen.getByTestId("pick-blocked")).toHaveTextContent("Nicht aufstellbar: NebelFunke – Activision-ID fehlt im Profil.");
  expect(blocked.getAttribute("aria-describedby")).toBe(screen.getByTestId("pick-blocked").id);
  fireEvent.click(blocked);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByTestId("pick-a")).not.toBeDisabled();
});

test("wer schon aufgestellt ist, bleibt abwählbar - auch ohne gültige ID", () => {
  const onChange = vi.fn();
  render(<LineupPicker roster={[{ id: "b", name: "NebelFunke", lineup_blocked: "fehlt" }]} value={["b"]} size={1} onChange={onChange} testId="pick" />);

  fireEvent.click(screen.getByTestId("pick-b"));

  expect(onChange).toHaveBeenCalledWith([]);
});
