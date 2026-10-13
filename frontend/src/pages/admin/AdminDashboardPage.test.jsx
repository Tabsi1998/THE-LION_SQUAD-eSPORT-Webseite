import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Startseite der Verwaltung je Rolle (#1353, #992): jeder Knopf, jede Aufgabe und jede Anfrage hängt an dem Bereich, den
// auch die Seite dahinter und der Server verlangen. Der Kassier bekommt seine Startseite, aber keine Turnier-Knöpfe;
// „+ Turnier“ und Co. nur mit Turnierleitung, „Setup prüfen“ und der Systemstand nur mit System. Admins mit
// Helfer-Einsatz sehen ihre Einsätze oben (#1352).

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/components/tls/AdminLayout", async (importOriginal) => ({
  ...(await importOriginal()),
  AdminLayout: ({ children }) => <div data-testid="admin-layout">{children}</div>,
}));
vi.mock("recharts", () => {
  const Box = ({ children }) => <div>{children}</div>;
  return { ResponsiveContainer: Box, ComposedChart: Box, Area: () => null, Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null };
});

const { canOpenAdminLink } = await import("@/components/tls/AdminLayout");
const { default: AdminDashboardPage } = await import("./AdminDashboardPage");

const mfa = { mfa_enabled: true, auth_mfa_verified: true };
const DASHBOARD = {
  daily_tasks: { reported_results: 1, moderation_reports: 2, contact_messages: 1, billing_cases: 1, sponsors_expiring: 1 },
  open_disputes: 1, membership_applications: { pending: 1 }, prize_pickups: { pending: 1 },
  tournament_registrations: { pending: 1 }, finance_attention: { overdue: 1 }, mobile_push: { ticket_errors: 1 },
  client_logs: { open: 1, critical_open: 1 }, ops: { checks: { status: "warn" } }, discord_broken: [{ label: "News", text: "kein Recht" }],
  today: [{ kind: "check_in", at: "2026-10-13T16:00:00Z", title: "Check-in: Cup", url: "/admin/tournaments/t-1" }],
  recent_audit_logs: [],
};

function serve() {
  apiMock.get.mockImplementation((url) => {
    if (url === "/admin/dashboard") return Promise.resolve({ data: DASHBOARD });
    if (url === "/users/me/duty") return Promise.resolve({ data: { assignments: [{ kind: "tournament", id: "t-9", title: "Helfer-Cup", roles: ["referee"], today: true, starts_at: null, url: "/tournaments/helfer-cup/leitung", admin_url: "/admin/tournaments/t-9" }], moderation: null, lead_today: [] } });
    if (url === "/setup/status") return Promise.resolve({ data: { completed: false, health_score: 50, missing: [] } });
    return Promise.resolve({ data: {} });
  });
}

async function renderAs(user) {
  authState.user = user;
  serve();
  const view = render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/dashboard"));
  await screen.findByTestId("dashboard-task-reported-results").catch(() => null);
  return view;
}

const requested = () => apiMock.get.mock.calls.map(([url]) => String(url));
const adminLinks = (container) => [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((href) => href.startsWith("/admin") || href.startsWith("/setup"));

beforeEach(() => apiMock.get.mockReset());

test.each([
  ["Kassier", { id: "k", role: "player", areas: ["finance"], ...mfa }],
  ["Redaktion", { id: "r", role: "player", areas: ["content"], ...mfa }],
  ["Turnierleitung", { id: "l", role: "tournament_admin", ...mfa }],
  ["Club-Admin", { id: "c", role: "club_admin", ...mfa }],
  ["Superadmin", { id: "s", role: "superadmin", ...mfa }],
])("%s: jeder Knopf führt auf eine Seite, die er öffnen darf", async (_name, user) => {
  const { container } = await renderAs(user);
  const links = adminLinks(container);
  expect(links.length).toBeGreaterThan(0);
  for (const href of links) expect([href, canOpenAdminLink(user, href)]).toEqual([href, true]);
});

test("Kassier: Startseite mit seinen Aufgaben, kein Schnellzugriff, keine Systemanfragen", async () => {
  await renderAs({ id: "k", role: "player", areas: ["finance"], ...mfa });
  expect(await screen.findByTestId("dashboard-task-billing-cases")).toBeInTheDocument();
  expect(screen.queryByTestId("dashboard-quick-actions")).toBeNull();
  expect(screen.queryByTestId("dashboard-live-status")).toBeNull();
  expect(screen.queryByTestId("dashboard-settings-hub")).toBeNull();
  for (const url of ["/admin/system-status", "/settings/auth", "/setup/status", "/users/me/duty"]) expect(requested()).not.toContain(url);
  // Der Check-in von heute steht da - ohne Link in die Turnierverwaltung, die der Kassier nicht öffnen darf.
  expect(screen.getByText("Check-in: Cup").closest("a")).toBeNull();
});

test("Turnierleitung: „+ Turnier“, „+ Fast Lap“, Events und Stationen - aber kein „Setup prüfen“", async () => {
  await renderAs({ id: "l", role: "tournament_admin", ...mfa });
  for (const testId of ["quick-new-tournament", "quick-new-f1", "quick-events", "quick-stations"]) expect(screen.getByTestId(testId)).toBeInTheDocument();
  expect(screen.queryByTestId("dashboard-setup-cta")).toBeNull();
  expect(document.querySelector('a[href="/setup"]')).toBeNull();
  expect(requested()).not.toContain("/settings/auth");
});

test("Redaktion: kein Schnellzugriff für Turniere", async () => {
  await renderAs({ id: "r", role: "player", areas: ["content"], ...mfa });
  expect(screen.queryByTestId("quick-new-tournament")).toBeNull();
  expect(screen.queryByTestId("dashboard-quick-actions")).toBeNull();
});

test("Superadmin: Systemstand, Setup und Login-Schalter werden geladen", async () => {
  await renderAs({ id: "s", role: "superadmin", ...mfa });
  await waitFor(() => expect(requested()).toEqual(expect.arrayContaining(["/admin/system-status", "/setup/status", "/settings/auth"])));
  expect(await screen.findByTestId("dashboard-setup-cta")).toBeInTheDocument();
});

test("Admin mit Helfer-Einsatz: die Einsätze stehen oben", async () => {
  await renderAs({ id: "r", role: "player", areas: ["content"], has_staff_assignment: true, ...mfa });
  expect(await screen.findByTestId("dashboard-duty")).toHaveTextContent("Helfer-Cup");
  expect(screen.getByTestId("duty-open-t-9")).toHaveAttribute("href", "/tournaments/helfer-cup/leitung");
});

// Nach Codex-Prüfung (#1353): der Server schickt dem Kassier nur die Finanz-Blöcke - die Seite zeigt dann auch nur die,
// ohne leere Zahlenkacheln, Termine, Protokoll oder Wachstum.
test("Kassier mit der Antwort des Servers: nur Finanz-Aufgaben, keine fremden Blöcke, kein Wachstum", async () => {
  authState.user = { id: "k", role: "player", areas: ["finance"], ...mfa };
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url === "/admin/dashboard" ? { daily_tasks: { billing_cases: 2 }, finance_attention: { overdue: 1 } } : {} }));
  render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);
  expect(await screen.findByTestId("dashboard-task-billing-cases")).toBeInTheDocument();
  expect(screen.getByTestId("dashboard-task-finance-attention")).toBeInTheDocument();
  for (const testId of ["dashboard-kpis", "dashboard-today", "dashboard-audit-log", "dashboard-growth-widget"]) expect(screen.queryByTestId(testId)).toBeNull();
  expect(requested()).not.toContain("/admin/growth-stats?days=30");
});
