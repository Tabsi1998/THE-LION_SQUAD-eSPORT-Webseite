import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Betrieb (#233): Fehlergruppen mit Zähler, als gelöst markierbar; die
// langsamsten Routen unter Tempo.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => false }));
vi.mock("@/components/tls/AdminLayout", () => ({
  AdminLayout: ({ children }) => <div data-testid="admin-layout">{children}</div>,
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminOpsPage = (await import("./AdminOpsPage")).default;
const { describeSummary } = await import("./AdminOpsPage");

const GROUP = {
  fingerprint: "abc123",
  error_type: "KeyError",
  message: "'team_id'",
  route: "/api/teams/{team_id}",
  method: "GET",
  status_code: 500,
  count: 7,
  first_seen_at: "2026-09-15T08:00:00Z",
  last_seen_at: "2026-09-15T17:30:00Z",
  actor: "angemeldet",
  stack: "Traceback ...\nKeyError: 'team_id'",
  resolved_at: null,
};

function respond(url) {
  const path = String(url);
  if (path.startsWith("/admin/ops/summary")) return { data: { open_error_groups: 1, error_groups_24h: 1, slow_requests_24h: 3, slowest_route_24h: { route: "/api/gallery", duration_ms: 2400 }, threshold_ms: 1000 } };
  if (path.startsWith("/admin/ops/errors")) return { data: [GROUP] };
  if (path.startsWith("/admin/ops/slow")) return { data: { hours: 24, threshold_ms: 1000, total: 3, routes: [{ method: "GET", route: "/api/gallery", count: 3, avg_ms: 1800, p95_ms: 2400, max_ms: 2400 }], recent: [] } };
  return { data: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation((url) => Promise.resolve(respond(url)));
  apiMock.post.mockImplementation(() => Promise.resolve({ data: { ...GROUP, resolved_at: "2026-09-15T18:00:00Z" } }));
});

test("Fehlergruppen zeigen Zähler und Route und lassen sich als gelöst markieren", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminOpsPage /></MemoryRouter>);

  await waitFor(() => expect(screen.getByText("KeyError")).toBeInTheDocument());
  expect(screen.getByText("GET /api/teams/{team_id}")).toBeInTheDocument();
  expect(screen.getByText(/7× · zuerst/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByText(/KeyError: 'team_id'/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Als gelöst markieren/ }));

  expect(apiMock.post).toHaveBeenCalledWith("/admin/ops/errors/abc123/resolve");
  await waitFor(() => expect(screen.getByRole("button", { name: /Wieder öffnen/ })).toBeInTheDocument());
});

test("Tempo listet die langsamsten Routen", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminOpsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("KeyError")).toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: "Tempo" }));
  // Die Route steht in der Kachel "Langsamste Route" und in der Tabelle; p95 und max sind hier gleich.
  expect(screen.getAllByText("/api/gallery").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("2400")).toHaveLength(2);
  expect(screen.getByText("1800")).toBeInTheDocument();
});

test("die Zusammenfassung für die Tageszentrale ist ein Satz", () => {
  expect(describeSummary(null)).toBe("Noch keine Daten.");
  expect(describeSummary({ open_error_groups: 2, slow_requests_24h: 5, slowest_route_24h: { route: "/api/x", duration_ms: 1500 } }))
    .toBe("2 Fehlergruppen offen · 5 langsame Anfragen in 24 h · langsamste: /api/x (1500 ms)");
});
