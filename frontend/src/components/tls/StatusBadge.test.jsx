import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

// Zustands-Schild (#1302, #1303): ein kurzes GROSSES Etikett - 12 px (tls-type-label), nicht 14 px fett GROSS. Nur das
// große Schild (lg) steht in der Stufe „Klein“.

test("das kleine Schild ist ein Etikett (12 px)", () => {
  render(<StatusBadge status="registration_open" testId="schild" />);
  expect(screen.getByTestId("schild")).toHaveClass("tls-type-label");
  expect(screen.getByTestId("schild")).not.toHaveClass("tls-type-small");
});

test("das große Schild bleibt Klein (14 px)", () => {
  render(<StatusBadge status="registration_open" size="lg" testId="schild" />);
  expect(screen.getByTestId("schild")).toHaveClass("tls-type-small");
});
