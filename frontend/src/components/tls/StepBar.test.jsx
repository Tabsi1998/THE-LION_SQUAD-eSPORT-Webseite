import { render, screen } from "@testing-library/react";
import { MEMBERSHIP_STEPS, StepBar } from "./StepBar";

// Schritt-Anzeige (#1081): zeigt immer den echten Stand, die Schritte davor gelten als erledigt, Vorleseprogramme
// hören „Schritt x von y“.

test("zeigt erledigte, aktuellen und offene Schritte und spricht den Stand aus", () => {
  render(<StepBar steps={MEMBERSHIP_STEPS} current={1} />);
  const bar = screen.getByTestId("step-bar");
  expect(bar).toHaveAttribute("aria-label", "Schritt 2 von 4: Antrag");
  const items = bar.querySelectorAll("li");
  expect([...items].map((item) => item.dataset.state)).toEqual(["done", "current", "open", "open"]);
  expect(items[1]).toHaveAttribute("aria-current", "step");
  expect(items[0]).not.toHaveAttribute("aria-current");
  expect(bar).toHaveTextContent("Konto");
  expect(bar).toHaveTextContent("Mitglied");
});

test("hält den Stand in den Grenzen und fällt ohne Schritte weg", () => {
  const { container, rerender } = render(<StepBar steps={MEMBERSHIP_STEPS} current={9} />);
  expect(screen.getByTestId("step-bar")).toHaveAttribute("aria-label", "Schritt 4 von 4: Mitglied");
  rerender(<StepBar steps={[]} current={0} />);
  expect(container.querySelector("[data-testid='step-bar']")).toBeNull();
});
