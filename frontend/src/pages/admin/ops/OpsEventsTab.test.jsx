import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Ereignisse (#517 Teil 2): eine Liste über alle Quellen, Filter gehen an den Server, die Quelle steht in
// der Adresse (alte Seiten leiten mit ?source= hierher), der Audit-Schnellfilter erscheint nur bei Adminaktionen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (d) => String(d || "") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { OpsEventsTab } = await import("./OpsEventsTab");

const PAYLOAD = {
  items: [
    { id: "e1", source: "server", source_label: "Serverfehler", href: "/admin/ops?tab=errors", severity: "error", status: "offen", time: "2026-09-24T20:00:00Z", title: "KeyError · GET /api/teams/{team_id}", subtitle: "7× · HTTP 500", detail: "'team_id'" },
    { id: "e2", source: "audit", source_label: "Adminaktionen", href: "/admin/ops?tab=events&source=audit", severity: "info", status: "audit", time: "2026-09-24T19:00:00Z", title: "user.role.change", subtitle: "admin · u-1", detail: "" },
  ],
  sources: [
    { key: "server", label: "Serverfehler", total: 3, problem_count: 1, latest_at: "2026-09-24T20:00:00Z" },
    { key: "audit", label: "Adminaktionen", total: 40, problem_count: 0, latest_at: "2026-09-24T19:00:00Z" },
  ],
  summary: { shown: 2, problem_count: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: PAYLOAD });
});

test("zeigt Ereignisse aller Quellen, schickt Filter an den Server und hält die Quelle in der Adresse", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/admin/ops?tab=events"]}><OpsEventsTab /></MemoryRouter>);
  expect(await screen.findByTestId("ops-event-server")).toHaveTextContent("KeyError");
  expect(screen.getByTestId("ops-event-audit")).toHaveTextContent("user.role.change");
  expect(screen.getByTestId("ops-events-problems")).toHaveTextContent("1 auffällige");
  expect(apiMock.get).toHaveBeenLastCalledWith("/admin/ops/events", { params: { source: "all", severity: "all", hours: 168, q: "", limit: 300 } });
  expect(screen.queryByTestId("ops-events-audit-quick")).toBeNull();

  await user.selectOptions(screen.getByTestId("ops-events-severity"), "problem");
  await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith("/admin/ops/events", { params: expect.objectContaining({ severity: "problem" }) }));
  await user.click(screen.getByTestId("ops-events-source-audit"));
  await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith("/admin/ops/events", { params: expect.objectContaining({ source: "audit" }) }));
  expect(screen.getByTestId("ops-events-audit-quick")).toBeInTheDocument();
});

test("die Quelle aus der Adresse gilt beim Laden (Umleitung der alten Audit-Seite)", async () => {
  render(<MemoryRouter initialEntries={["/admin/ops?tab=events&source=email"]}><OpsEventsTab /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/ops/events", { params: expect.objectContaining({ source: "email" }) }));
});
