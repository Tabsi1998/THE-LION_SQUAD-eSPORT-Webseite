import { render, screen } from "@testing-library/react";
import { GermanDateField } from "./GermanDateField";

// Datumsfeld (#937): Beschriftung und Fehler hängen am Knopf - der Fehler über aria-describedby (und als Hinweis), nicht
// über aria-invalid, das es für Knöpfe nicht gibt.
test("Beschriftung und Fehler hängen am Knopf, ohne aria-invalid", () => {
  render(<GermanDateField id="geburtstag" label="Geburtstag" value="2001-04-03" onChange={() => {}} error="Bitte ein Datum wählen." testId="dob" />);
  const trigger = screen.getByRole("button", { name: /Geburtstag/ });
  expect(trigger).toHaveTextContent("3. April 2001");
  expect(trigger).toHaveAccessibleDescription("Bitte ein Datum wählen.");
  expect(trigger).not.toHaveAttribute("aria-invalid");
  expect(screen.getByRole("alert")).toHaveTextContent("Bitte ein Datum wählen.");
});
