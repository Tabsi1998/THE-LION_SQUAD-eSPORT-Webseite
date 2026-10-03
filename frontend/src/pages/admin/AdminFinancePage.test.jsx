import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { csvFilename } from "@/lib/billing";

// Finanzübersicht (#322, #370, #321): offene Aufträge zeigen den Rechnungstext und nehmen einen
// Zusatz an; angelegte Belege zeigen den Zahlungsstand; Prüffälle werden mit Grund erledigt;
// im Detail wird eine Erstattung festgehalten - nie über das Bezahlte hinaus.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AdminFinancePage = (await import("./AdminFinancePage")).default;

const OVERVIEW = {
  by_status: { pending: { count: 1, total_cents: 4000 } },
  labels: { pending: "neu", invoiced: "Rechnung angelegt" },
  payment_labels: { partial: "teilweise bezahlt", paid: "bezahlt", open: "offen" },
  open: [{
    id: "o1", kind: "event", source_id: "e1", user_id: "u1", status: "pending", total_cents: 4000, currency: "EUR", total: "40,00 €",
    created_at: "2026-09-22T10:00:00+00:00", source: { name: "Weihnachtsfeier", slug: "weihnachtsfeier", kind: "event" }, person: "Paula",
    invoice_text: ["Kostenbeitrag – Essen und Getränke\nWeihnachtsfeier am 12.12.2026 – 2 Personen (Paula + 1 Begleitperson)"], extra_text: "",
  }],
  invoiced: [{
    id: "o2", kind: "event", source_id: "e1", user_id: "u2", status: "invoiced", total_cents: 4000, currency: "EUR", total: "40,00 €", invoice_ref: "FA2609-0002",
    invoice_status: "validated", payment_state: "partial", payment_label: "teilweise bezahlt", remaining_cents: 3000, paid_cents: 1000, refunded_cents: 0, credited_cents: 0,
    synced_at: "2026-09-23T10:00:00+00:00", source: { name: "Weihnachtsfeier", slug: "weihnachtsfeier", kind: "event" }, person: "Max", booking_state: "cancelled",
  }],
  cases: [{ id: "c1", order_id: "o2", kind: "cancelled_after_invoice", status: "open", label: "Storniert, Beleg existiert", todo: "In Dolibarr entscheiden …",
    source: { name: "Weihnachtsfeier" }, person: "Max", total: "40,00 €", detail: { invoice_ref: "FA2609-0002", paid_cents: 1000, reason: "Anmeldung storniert" } }],
  cases_open: 1,
  summary: null,
  dolibarr: { connected: true, mode: "live", write_capable: true, terms_complete: false, invoice_auto_validate: false },
  tax_profiles: [], price_bases: {},
};

const DETAIL = {
  order: { id: "o2", status: "invoiced", invoice_ref: "FA2609-0002", payment_state: "partial", total: "40,00 €", total_cents: 4000, currency: "EUR", source: { name: "Weihnachtsfeier" }, person: "Max", status_label: "Rechnung angelegt" },
  positions: [{ key: "beitrag", label: "Kostenbeitrag", quantity: 2, total_cents: 4000 }],
  registration: { status: "cancelled", seat_count: 2 },
  cases: [{ id: "c1", kind: "cancelled_after_invoice", status: "open", label: "Storniert, Beleg existiert" }],
  timeline: [
    { at: "2026-09-22T10:00:00+00:00", kind: "order", text: "Auftrag angelegt – 40,00 € (zur Rechnung)" },
    { at: "2026-09-23", kind: "payment", text: "Zahlung 10,00 € (VIR)" },
    { at: "2026-09-23T11:00:00+00:00", kind: "case", text: "Prüffall: Storniert, Beleg existiert" },
  ],
  sums: { paid_cents: 1000, refunded_cents: 0, credited_cents: 0, refundable_cents: 1000 },
  payment_labels: { partial: "teilweise bezahlt" },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/finance/overview") return { data: OVERVIEW };
    if (url === "/admin/finance/orders/o2") return { data: DETAIL };
    throw new Error(url);
  });
  apiMock.put.mockResolvedValue({ data: { ok: true } });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
});

test("der Rechnungstext steht am Auftrag, ein Zusatz geht an den Server, fehlende Konditionen werden genannt", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminFinancePage /></MemoryRouter>);
  expect(await screen.findByTestId("finance-terms-hint")).toHaveTextContent("Rechnungskonditionen");
  await user.click(screen.getByTestId("finance-text-o1").querySelector("summary"));
  expect(screen.getByTestId("finance-text-line-o1-0")).toHaveTextContent("2 Personen (Paula + 1 Begleitperson)");

  const save = screen.getByTestId("finance-text-save-o1");
  expect(save).toBeDisabled();
  await user.type(screen.getByLabelText("Zusatztext für die Rechnung"), "inkl. Essen und Getränke");
  await user.click(save);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/finance/orders/o1/text", { extra_text: "inkl. Essen und Getränke" }));
});

test("mit vollständigen Konditionen gibt es keinen Hinweis", async () => {
  apiMock.get.mockResolvedValue({ data: { ...OVERVIEW, dolibarr: { ...OVERVIEW.dolibarr, terms_complete: true } } });
  render(<MemoryRouter><AdminFinancePage /></MemoryRouter>);
  expect(await screen.findByTestId("finance-order-o1")).toBeInTheDocument();
  expect(screen.queryByTestId("finance-terms-hint")).not.toBeInTheDocument();
});

test("angelegte Belege zeigen den Zahlungsstand aus Dolibarr, ein Prüffall wird nur mit Grund erledigt", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminFinancePage /></MemoryRouter>);
  expect(await screen.findByTestId("finance-payment-o2")).toHaveTextContent("teilweise bezahlt · 30,00 € offen");
  expect(screen.getByTestId("finance-invoice-o2")).toHaveTextContent("Buchung storniert");
  expect(screen.getByTestId("finance-cases-count")).toHaveTextContent("1");

  const item = screen.getByTestId("finance-case-c1");
  expect(item).toHaveTextContent("Storniert, Beleg existiert");
  expect(screen.getByTestId("finance-case-facts-c1")).toHaveTextContent("Beleg FA2609-0002 · bezahlt 10,00 €");
  const resolve = screen.getByTestId("finance-case-resolve-c1");
  expect(resolve).toBeDisabled();
  await user.type(screen.getByTestId("finance-case-reason-c1"), "Gutschrift GA2026-0003 angelegt");
  await user.click(resolve);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/finance/cases/c1/resolve", { reason: "Gutschrift GA2026-0003 angelegt" }));
});

test("im Detail stehen Verlauf und Summen, eine Erstattung geht nur bis zum Bezahlten und kann den Prüffall erledigen", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminFinancePage /></MemoryRouter>);
  await user.click(await screen.findByTestId("finance-detail-o2"));
  const detail = await screen.findByTestId("finance-detail");
  expect(within(detail).getByTestId("finance-detail-timeline")).toHaveTextContent("Zahlung 10,00 € (VIR)");
  expect(within(detail).getByTestId("finance-detail-sums")).toHaveTextContent("noch erstattbar 10,00 €");

  const save = within(detail).getByTestId("finance-refund-save");
  await user.type(within(detail).getByLabelText("Erstattungsbetrag in Euro"), "20");
  await user.type(within(detail).getByLabelText("Grund der Rückzahlung"), "Begleitperson entfallen");
  expect(save).toBeDisabled();
  await user.clear(within(detail).getByLabelText("Erstattungsbetrag in Euro"));
  await user.type(within(detail).getByLabelText("Erstattungsbetrag in Euro"), "10,00");
  await user.type(within(detail).getByLabelText("Referenz der Rückzahlung"), "Überweisung 24.09.");
  await user.selectOptions(within(detail).getByLabelText("Prüffall damit erledigen"), "c1");
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/finance/orders/o2/refunds", expect.objectContaining({ amount_cents: 1000, reference: "Überweisung 24.09.", reason: "Begleitperson entfallen", case_id: "c1" })));

  await user.click(within(detail).getByTestId("finance-resync"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/finance/orders/o2/resync"));
});

test("Filter gehen als Abfrage an den Server, „Alles abgleichen“ ruft den Abgleich", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminFinancePage /></MemoryRouter>);
  await screen.findByTestId("finance-order-o1");
  await user.selectOptions(screen.getByTestId("finance-filter-kind"), "tournament");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/finance/overview", { params: { kind: "tournament" } }));
  await user.click(screen.getByTestId("finance-reconcile"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/finance/reconcile"));
});

test("Rechnungs-PDF (#840): Belege ohne bestätigtes PDF werden nachgezogen, der Grund steht am Auftrag", async () => {
  const { toast } = await import("sonner");
  const user = userEvent.setup();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/finance/overview") return { data: { ...OVERVIEW, pdfs: { unconfirmed: 3, failed: 1 } } };
    if (url === "/admin/finance/orders/o2") return { data: { ...DETAIL, order: { ...DETAIL.order, pdf_missing: true, pdf_error_text: "Dem Website-Benutzer fehlt in Dolibarr das Recht „Rechnungen erstellen/bearbeiten“." } } };
    throw new Error(url);
  });
  apiMock.post.mockResolvedValue({ data: { summary: "2 PDFs erzeugt, 1 hatte schon eins." } });
  render(<MemoryRouter><AdminFinancePage /></MemoryRouter>);
  const row = await screen.findByTestId("finance-pdfs");
  expect(row).toHaveTextContent("3 freigegebene Belege ohne bestätigtes PDF – bei 1 ist das Erzeugen gescheitert");
  await user.click(screen.getByTestId("finance-pdfs-build"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/finance/pdfs/build-missing"));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 PDFs erzeugt, 1 hatte schon eins."));

  await user.click(await screen.findByTestId("finance-detail-o2"));
  expect(await screen.findByTestId("finance-detail-pdf-missing")).toHaveTextContent("PDF fehlt: Dem Website-Benutzer fehlt in Dolibarr das Recht „Rechnungen erstellen/bearbeiten“.");
});

test("ohne offene PDFs gibt es keinen Knopf", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/admin/finance/overview" ? { data: { ...OVERVIEW, pdfs: { unconfirmed: 0, failed: 0 } } } : { data: DETAIL }));
  render(<MemoryRouter><AdminFinancePage /></MemoryRouter>);
  await screen.findByTestId("finance-order-o1");
  expect(screen.queryByTestId("finance-pdfs")).toBeNull();
});

test("wo Belege hängen (#842): drei Knöpfe mit Zahl, ein Klick fragt nur diese ab, Beleg in Dolibarr, Export mit Blick im Namen", async () => {
  const user = userEvent.setup();
  const attention = { attention: { overdue: 2, pdf_missing: 1, draft_old: 0 }, attention_labels: { pdf_missing: "PDF fehlt", draft_old: "Entwurf seit mehr als 7 Tagen", overdue: "überfällig" } };
  const linked = { ...OVERVIEW.invoiced[0], dolibarr_url: "https://erp.example.test/compta/facture/card.php?facid=2" };
  apiMock.get.mockImplementation(async (url) => (url === "/admin/finance/overview" ? { data: { ...OVERVIEW, ...attention, invoiced: [linked] } } : { data: DETAIL }));
  render(<MemoryRouter><AdminFinancePage /></MemoryRouter>);
  const bar = await screen.findByTestId("finance-attention");
  expect(within(bar).getByTestId("finance-attention-overdue")).toHaveTextContent("Überfällig · 2");
  expect(within(bar).getByTestId("finance-attention-pdf_missing")).toHaveTextContent("PDF fehlt · 1");
  expect(within(bar).getByTestId("finance-attention-draft_old")).toHaveTextContent("Entwurf seit mehr als 7 Tagen · 0");
  expect(screen.queryByTestId("finance-attention-ok")).toBeNull();
  const link = screen.getByTestId("finance-dolibarr-o2");
  expect(link).toHaveAttribute("href", "https://erp.example.test/compta/facture/card.php?facid=2");
  expect(link).toHaveAttribute("target", "_blank");

  await user.click(screen.getByTestId("finance-attention-overdue"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/finance/overview", { params: { attention: "overdue" } }));
  expect(screen.getByTestId("finance-attention-overdue")).toHaveAttribute("aria-pressed", "true");
  expect(csvFilename(new Date("2026-10-03T12:00:00Z"), "overdue")).toBe("abrechnung-überfällig-2026-10-03.csv");
  await user.click(screen.getByTestId("finance-attention-overdue"));
  await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith("/admin/finance/overview", { params: {} }));
});

test("ohne Treffer steht „alles in Ordnung“; aus der Tageszentrale kommt der Blick über die Adresse", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/admin/finance/overview"
    ? { data: { ...OVERVIEW, invoiced: [], attention: { overdue: 0, pdf_missing: 0, draft_old: 0 }, attention_labels: { pdf_missing: "PDF fehlt", draft_old: "Entwurf seit mehr als 7 Tagen", overdue: "überfällig" } } }
    : { data: DETAIL }));
  render(<MemoryRouter initialEntries={["/admin/finance?attention=overdue"]}><AdminFinancePage /></MemoryRouter>);
  expect(await screen.findByTestId("finance-attention-ok")).toHaveTextContent("Alles in Ordnung");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/finance/overview", { params: { attention: "overdue" } });
  expect(screen.getByTestId("finance-attention-empty")).toHaveTextContent("Kein Beleg in dieser Auswahl.");
});
