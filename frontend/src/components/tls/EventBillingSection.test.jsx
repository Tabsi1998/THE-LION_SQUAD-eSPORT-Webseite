import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Leistungen aus Dolibarr kommen über die Finanz-Route; ohne Anbindung bleibt das Nummernfeld.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { EventBillingSection } = await import("./EventBillingSection");

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: { available: false, services: [] } });
});

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

test("eine Leistung aus Dolibarr wählen füllt Bezeichnung, Betrag, Steuer und Nummer vor", async () => {
  apiMock.get.mockResolvedValue({ data: { available: true, services: [
    { id: 17, ref: "KOSTENBEITRAG", label: "Kostenbeitrag", description: "Kostenbeitrag Veranstaltung", amount_cents: 2000, tax_rate: 0, tax_profile: "none" },
    { id: 18, ref: "SHIRT", label: "Event-Shirt", description: "", amount_cents: 1500, tax_rate: 20, tax_profile: "standard" },
  ] } });
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByTestId("event-billing-enabled"));
  const select = await screen.findByTestId("event-billing-service-0");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/finance/dolibarr-services");
  await user.selectOptions(select, "17");
  await waitFor(() => expect(screen.getByTestId("event-billing-amount-0")).toHaveValue("20,00"));
  expect(screen.getByDisplayValue("Kostenbeitrag")).toBeInTheDocument();
  expect(screen.getByTestId("event-billing-preview")).toHaveTextContent("40,00 €");
  // Zurück auf „keine“: die Nummer geht weg, der Rest bleibt änderbar.
  await user.selectOptions(select, "");
  expect(select).toHaveValue("");
  expect(screen.getByTestId("event-billing-amount-0")).toHaveValue("20,00");
});
