import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Finanzübersicht (#322, #370): offene Aufträge zeigen den Rechnungstext, wie er auf den Beleg
// käme, und nehmen einen Zusatz an; fehlende Konditionen werden genannt.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AdminFinancePage = (await import("./AdminFinancePage")).default;

const OVERVIEW = {
  by_status: { pending: { count: 1, total_cents: 4000 } },
  labels: { pending: "neu", invoiced: "Rechnung angelegt" },
  open: [{
    id: "o1", kind: "event", source_id: "e1", user_id: "u1", status: "pending", total_cents: 4000, currency: "EUR", total: "40,00 €",
    created_at: "2026-09-22T10:00:00+00:00", source: { name: "Weihnachtsfeier", slug: "weihnachtsfeier", kind: "event" }, person: "Paula",
    invoice_text: ["Kostenbeitrag – Essen und Getränke\nWeihnachtsfeier am 12.12.2026 – 2 Personen (Paula + 1 Begleitperson)"], extra_text: "",
  }],
  invoiced: [],
  dolibarr: { connected: true, mode: "live", write_capable: true, terms_complete: false, invoice_auto_validate: false },
  tax_profiles: [], price_bases: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: OVERVIEW });
  apiMock.put.mockResolvedValue({ data: { ok: true } });
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
