import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Rechnungskonditionen (#370) mit der Sprache der Rechnungs-PDFs (#840): Vorgabe Deutsch (Österreich), die Liste kommt
// vom Server; gespeichert wird mit den drei Konditionen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { InvoiceTermsPanel } = await import("./InvoiceTermsPanel");

const LANGS = [{ code: "de_AT", label: "Deutsch (Österreich)" }, { code: "de_DE", label: "Deutsch (Deutschland)" }, { code: "", label: "wie in Dolibarr eingestellt" }];

test("die Sprache der PDFs wird mit den Konditionen gespeichert", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<InvoiceTermsPanel terms={{ payment_term_id: 2, payment_mode_id: 2, bank_account_id: 1, complete: true, pdf_lang: "de_AT", pdf_langs: LANGS }} connected={false} busy="" onSave={onSave} />);
  const select = screen.getByTestId("invoice-terms-pdf-lang");
  expect(select).toHaveValue("de_AT");
  expect(screen.getByTestId("invoice-terms-save")).toBeDisabled();
  await user.selectOptions(select, "de_DE");
  await user.click(screen.getByTestId("invoice-terms-save"));
  expect(onSave).toHaveBeenCalledWith({ invoice_payment_term_id: 2, invoice_payment_mode_id: 2, invoice_bank_account_id: 1, invoice_pdf_lang: "de_DE" });
  expect(screen.queryByText(/Erst mit allen drei Angaben/)).toBeNull();
});

test("ohne Liste vom Server steht Deutsch (Österreich) zur Wahl", () => {
  render(<InvoiceTermsPanel terms={{ complete: false }} connected={false} busy="" onSave={() => {}} />);
  expect(screen.getByTestId("invoice-terms-pdf-lang")).toHaveValue("de_AT");
  expect(screen.getByTestId("invoice-terms-pdf-lang")).toHaveTextContent("Deutsch (Österreich)");
});
