import { render, screen } from "@testing-library/react";
import { StatusBadge, statusBadgeLabel } from "./StatusBadge";

// Dünne Hülle (#1306): StatusBadge zeigt den StatusChip - normal geschrieben, mit Symbol, nie den Rohwert.

test("das kleine Schild ist ein Zustands-Schild in normaler Schreibung", () => {
  render(<StatusBadge status="registration_open" testId="schild" />);
  const chip = screen.getByTestId("schild");
  expect(chip).toHaveClass("tls-status-chip");
  expect(chip).not.toHaveClass("tls-status-chip--lg");
  expect(chip).toHaveTextContent(/^Anmeldung offen$/);
  expect(chip.className).not.toMatch(/uppercase|tls-type-label/);
});

test("das große Schild hat die Stufe „Klein“ (14 px)", () => {
  render(<StatusBadge status="registration_open" size="lg" testId="schild" />);
  expect(screen.getByTestId("schild")).toHaveClass("tls-status-chip--lg");
});

test("ohne testId heißt das Schild status-<Zustand>; die eigene Anmeldung spricht in der Du-Form", () => {
  render(<StatusBadge status="approved" own />);
  expect(screen.getByTestId("status-approved")).toHaveTextContent("Du bist dabei");
  expect(statusBadgeLabel("approved")).toBe("Bestätigt");
  expect(statusBadgeLabel("in_progress")).toBe("Läuft");
  expect(statusBadgeLabel("gibt_es_nicht")).toBe("Unbekannt");
});
