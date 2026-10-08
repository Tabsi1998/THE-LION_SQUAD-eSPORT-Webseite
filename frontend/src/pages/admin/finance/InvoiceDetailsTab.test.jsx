import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Rechnungsangaben (#1358): der Kassier pflegt Zahlungsziel, Zahlungsart, Bankkonto, Sprache und Steuersätze selbst - die
// Listen kommen weiter aus Dolibarr, gespeichert wird über den schmalen Weg der Finanzen.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { InvoiceDetailsTab } = await import("./InvoiceDetailsTab");

const DETAILS = {
  connected: true, write_enabled: true, write_capable: true, invoice_auto_validate: false,
  tax_rates: { none: 0, standard: 20, reduced: 10 }, tax_confirmed: null,
  terms: { payment_term_id: null, payment_mode_id: null, bank_account_id: null, complete: false, pdf_lang: "de_AT", pdf_langs: [{ code: "de_AT", label: "Deutsch (Österreich)" }] },
};
const OPTIONS = {
  available: true,
  terms: [{ id: 1, code: "RECEP", label: "Sofort" }, { id: 2, code: "30D", label: "30 Tage" }],
  modes: [{ id: 2, code: "VIR", label: "Banküberweisung" }, { id: 4, code: "LIQ", label: "Bar" }],
  accounts: null,
  suggested: { payment_term_id: 2, payment_mode_id: 2, bank_account_id: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/finance/invoice-details") return { data: DETAILS };
    if (url === "/admin/finance/invoice-options") return { data: OPTIONS };
    throw new Error(url);
  });
});

test("Listen aus Dolibarr über den Weg der Finanzen, Vorschlag übernehmen, speichern als Rechnungsangaben", async () => {
  apiMock.put.mockResolvedValue({ data: { ...DETAILS, terms: { ...DETAILS.terms, payment_term_id: 2, payment_mode_id: 2, bank_account_id: 1, complete: true } } });
  const user = userEvent.setup();
  render(<InvoiceDetailsTab />);
  expect(await screen.findByTestId("invoice-terms-state")).toHaveTextContent("unvollständig");
  expect(screen.getByTestId("invoice-details-auto-validate")).toBeDisabled();
  expect(await screen.findByTestId("invoice-terms-accounts-help")).toHaveTextContent("Bankkonten einsehen");
  await user.click(await screen.findByTestId("invoice-terms-suggest"));
  await user.type(screen.getByTestId("invoice-terms-bank_account_id"), "1");
  await user.click(screen.getByTestId("invoice-terms-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/finance/invoice-details", { invoice_payment_term_id: 2, invoice_payment_mode_id: 2, invoice_bank_account_id: 1, invoice_pdf_lang: "de_AT" }));
  expect(toastMock.success).toHaveBeenCalledWith("Rechnungsangaben gespeichert.");
  expect(screen.getByTestId("invoice-terms-save")).toHaveTextContent("Rechnungsangaben speichern");
  expect(apiMock.get).not.toHaveBeenCalledWith("/admin/dolibarr/invoice-options");
});

test("Steuersätze geprüft: mit Name und Datum; ohne Schreibzugriff ein Satz, wer ihn einschaltet", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/finance/invoice-details") return { data: { ...DETAILS, write_capable: false, tax_confirmed: { at: "2026-10-01T10:00:00+00:00", by: "Kai Kassa" } } };
    if (url === "/admin/finance/invoice-options") return { data: OPTIONS };
    throw new Error(url);
  });
  apiMock.put.mockResolvedValue({ data: { ...DETAILS, tax_confirmed: null } });
  const user = userEvent.setup();
  render(<InvoiceDetailsTab />);
  expect(await screen.findByTestId("invoice-details-tax-by")).toHaveTextContent("Kai Kassa am 1.10.2026");
  expect(screen.getByTestId("invoice-details-write")).toHaveTextContent("das schaltet System unter Dolibarr → Funktionen ein");
  await user.click(screen.getByTestId("invoice-details-tax-confirmed"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/finance/invoice-details", { tax_confirmed: false }));
});
