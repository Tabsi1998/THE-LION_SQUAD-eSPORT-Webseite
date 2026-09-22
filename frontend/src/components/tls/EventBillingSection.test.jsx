import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventBillingSection } from "./EventBillingSection";

// „Kosten und Abrechnung“ (#315, #322): nur für Finanzen sichtbar; Vorschau und Fehlertexte
// zeigen vor dem Speichern, was die Anmeldung kosten würde.

function Harness({ canEdit = true }) {
  const [value, setValue] = useState({ enabled: false, positions: [], invoice_timing: "on_confirm" });
  return <EventBillingSection value={value} onChange={setValue} canEdit={canEdit} />;
}

test("ohne Bereich Finanzen gibt es den Abschnitt nicht", () => {
  render(<Harness canEdit={false} />);
  expect(screen.queryByTestId("event-billing")).not.toBeInTheDocument();
});

test("Einschalten legt eine Pflichtposition an; die Vorschau rechnet zwei Personen", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByTestId("event-billing-enabled"));
  expect(screen.getByTestId("event-billing-position-0")).toBeInTheDocument();
  expect(screen.getByTestId("event-billing-error")).toHaveTextContent(/Betrag/);
  await user.type(screen.getByTestId("event-billing-amount-0"), "20");
  expect(screen.getByTestId("event-billing-preview")).toHaveTextContent("40,00 €");
  await user.click(screen.getByTestId("event-billing-add"));
  expect(screen.getByTestId("event-billing-position-1")).toBeInTheDocument();
  expect(screen.getByTestId("event-billing-error")).toHaveTextContent(/Position 2: Bezeichnung fehlt/);
});
