import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Meine Rechnungen (#296): offen oben, Archiv unten, PDF im Betrachter, Bezahlen fragt den Server
// im Moment des Klicks – und bei Ausfall bleibt der letzte Stand ohne Bezahlen-Knopf.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/DocumentViewer", () => ({ DocumentViewer: ({ path, title }) => <div data-testid="viewer">{title} · {path}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const MyInvoicesPage = (await import("./MyInvoicesPage")).default;

const DATA = {
  connected: true, available: true, currency: "EUR", as_of: "2026-09-21T10:00:00+00:00",
  summary: { count: 3, open_count: 1, open_total: 60, overdue_count: 1 },
  invoices: [
    { key: "d-31", ref: "FA-31", type: "standard", type_label: "Rechnung", status: "overdue", status_label: "überfällig", date: "2026-08-01", due_date: "2026-08-15", total: 60, remaining: 60, overdue: true, is_fee: true, can_pay: true },
    { key: "d-30", ref: "FA-30", type: "standard", type_label: "Rechnung", status: "paid", status_label: "bezahlt", date: "2025-08-01", total: 60, remaining: 0, is_fee: true, can_pay: false },
    { key: "d-29", ref: "AV-29", type: "credit_note", type_label: "Gutschrift", status: "paid", status_label: "bezahlt", date: "2025-02-01", total: -10, remaining: 0, is_fee: false, can_pay: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: DATA });
});

const renderPage = () => render(<MemoryRouter><MyInvoicesPage /></MemoryRouter>);

test("offen oben mit Bezahlen, Archiv unten ohne; Ansehen öffnet den Betrachter mit dem eigenen Beleg", async () => {
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByTestId("invoices-summary")).toHaveTextContent("1 offener Beleg über");
  expect(screen.getByTestId("invoice-pay-d-31")).toBeInTheDocument();
  expect(screen.queryByTestId("invoice-pay-d-30")).toBeNull();
  expect(screen.getByTestId("invoice-d-29")).toHaveTextContent("Gutschrift");
  await user.click(screen.getByTestId("invoice-view-d-31"));
  expect(screen.getByTestId("viewer")).toHaveTextContent("Rechnung FA-31 · /account/invoices/d-31/pdf");
});

test("Bezahlen fragt den Server und folgt seinem Ziel; ein 409 wird erklärt", async () => {
  const user = userEvent.setup();
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  apiMock.post.mockResolvedValueOnce({ data: { url: "https://erp.example.test/public/payment/x" } });
  renderPage();
  await user.click(await screen.findByTestId("invoice-pay-d-31"));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("https://erp.example.test/public/payment/x"));
  expect(apiMock.post).toHaveBeenCalledWith("/account/invoices/d-31/pay");

  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Dieser Beleg lässt sich nicht (mehr) online bezahlen." } } });
  await user.click(screen.getByTestId("invoice-pay-d-31"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Dieser Beleg lässt sich nicht (mehr) online bezahlen."));
  vi.unstubAllGlobals();
});

test("bei Ausfall steht der letzte Stand da, Bezahlen ist weg", async () => {
  apiMock.get.mockResolvedValue({ data: { ...DATA, available: false, reason_text: "Dolibarr ist nicht erreichbar", invoices: DATA.invoices.map((row) => ({ ...row, can_pay: false })) } });
  renderPage();
  expect(await screen.findByTestId("invoices-outage")).toHaveTextContent("nicht erreichbar");
  expect(screen.getByTestId("invoice-d-31")).toBeInTheDocument();
  expect(screen.queryByTestId("invoice-pay-d-31")).toBeNull();
});

test("ohne Zuordnung eine Erklärung statt einer leeren Seite", async () => {
  apiMock.get.mockResolvedValue({ data: { connected: false, available: true, invoices: [], summary: { count: 0 }, currency: "EUR" } });
  renderPage();
  expect(await screen.findByTestId("invoices-summary")).toHaveTextContent("noch keine Rechnungen zu deinem Konto");
});

test("Quelle am Beleg, Filter nach Quelle und Stand; Nicht-Mitglieder gehen zurück ins Profil (#320)", async () => {
  const user = userEvent.setup();
  const event = { key: "d-501", ref: "FA2609-0501", type: "standard", type_label: "Rechnung", status: "open", status_label: "offen", date: "2026-09-01", total: 40, remaining: 40, is_fee: false, can_pay: false, source: "event", source_label: "Weihnachtsfeier", booking: { name: "Weihnachtsfeier", date: "12.12.2026", seats: 2, companions: 1, team: "", players: 0 } };
  apiMock.get.mockResolvedValue({ data: { ...DATA, member: false, sources: { club: 3, event: 1 }, invoices: [...DATA.invoices.map((row) => ({ ...row, source: "club" })), event] } });
  renderPage();
  expect(await screen.findByTestId("invoice-source-d-501")).toHaveTextContent("Weihnachtsfeier · 12.12.2026 · 2 Personen");
  expect(screen.queryByTestId("invoice-source-d-31")).toBeNull();
  expect(screen.getByText("Mein Profil")).toBeInTheDocument();

  await user.click(screen.getByTestId("invoices-source-event"));
  expect(screen.queryByTestId("invoice-d-31")).toBeNull();
  expect(screen.getByTestId("invoice-d-501")).toBeInTheDocument();

  await user.click(screen.getByTestId("invoices-source-all"));
  await user.click(screen.getByTestId("invoices-state-paid"));
  expect(screen.queryByTestId("invoice-d-501")).toBeNull();
  expect(screen.getByTestId("invoice-d-30")).toBeInTheDocument();
  expect(screen.getByTestId("invoice-d-29")).toBeInTheDocument();
});
