import { fireEvent, render, screen } from "@testing-library/react";
import { OfficialTeamTotals } from "./OfficialTeamTotals";

// Teamwertung laut Veranstalter im Ergebnisblatt (#1960): einfügen ersetzt die Liste, einzeln ändern und entfernen;
// eine Zeile ohne gültige Zahl ist rot und geht nicht mit. Nur erfundene Namen.

test("Einfügen, ändern, ungültige Zahl und entfernen - nach oben gehen nur gültige Teamwerte", () => {
  const onChange = vi.fn();
  render(<OfficialTeamTotals totals={{ "Probe Löwen": 20 }} teams={["Probe Löwen"]} onChange={onChange} />);
  expect(screen.getAllByTestId("result-team-total")).toHaveLength(1);

  fireEvent.click(screen.getByTestId("result-team-totals-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-team-totals-text"), { target: { value: "1.\tFremd Rot\t40\n2. Probe Löwen 30,5" } });
  fireEvent.click(screen.getByTestId("result-team-totals-apply"));
  expect(onChange).toHaveBeenLastCalledWith({ "Fremd Rot": 40, "Probe Löwen": 30.5 });
  expect(screen.getAllByTestId("result-team-total")).toHaveLength(2);

  const points = screen.getAllByTestId("result-team-total-points");
  fireEvent.change(points[0], { target: { value: "4x" } });
  expect(points[0]).toHaveAttribute("aria-invalid", "true");
  expect(onChange).toHaveBeenLastCalledWith({ "Probe Löwen": 30.5 });

  fireEvent.click(screen.getByRole("button", { name: "Team 2 entfernen" }));
  expect(onChange).toHaveBeenLastCalledWith({});
  fireEvent.click(screen.getByTestId("result-team-totals-clear"));
  expect(screen.queryAllByTestId("result-team-total")).toHaveLength(0);
});
