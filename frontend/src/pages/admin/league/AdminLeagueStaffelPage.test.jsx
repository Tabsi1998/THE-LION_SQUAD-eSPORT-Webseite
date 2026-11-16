import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// Staffel-Seite der Liga-Verwaltung (#2262, Paket A): Kopf mit Brotkrumen, nur die fertigen Reiter Überblick und Teilnehmer, die
// Hauptaktion mit derselben Rückfrage wie die Turnierverwaltung und jeder Knopf nur mit dem Recht, das der Server verlangt.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({
  API: "http://test.local/api",
  api: apiMock,
  formatApiError: (error, fallback) => fallback || String(error),
  formatRequestError: (_error, fallback) => fallback,
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div data-testid="admin-layout">{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const { default: AdminLeagueStaffelPage } = await import("./AdminLeagueStaffelPage");

const ALL = ["applications", "manage", "matches", "results", "roster", "sanctions", "season"];
const STAFFEL = {
  id: "t1", slug: "probe-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft", format: "league", team_mode: "team",
  min_participants: 2, max_participants: 8, league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" },
  league_links: { league_name: "Probe-Liga", season_name: "Season 1", division_label: "Liga 1", staffel: "A",
    season_admin_path: "/admin/leagues/seasons/s1", public_path: "/liga/probe-liga/season-1", staffel_admin_path: "/admin/leagues/staffeln/t1" },
  can_edit_staffel: true, can_manage_participants: true, can_manage_structure: true, league_capabilities: ALL,
};
const SQUADS = [
  { id: "r1", status: "approved", display_name: "Nebelwölfe · Rudel", team_id: "tm1", squad_id: "sq1" },
  { id: "r2", status: "approved", display_name: "Sturmfalken · Horst", team_id: "tm2", squad_id: "sq2", late_entry: { state: "done", from_week: 3 } },
];

let served;
function serve({ tournament = {}, registrations = SQUADS, matches = [], planning = { ok: true, warning_count: 0, error_count: 0 }, sanctions = [] } = {}) {
  served = { ...STAFFEL, ...tournament };
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/planning-check")) return Promise.resolve({ data: planning });
    if (path.includes("/registrations")) return Promise.resolve({ data: registrations });
    if (path.includes("/matches-v2")) return Promise.resolve({ data: matches });
    if (path.includes("/sanctions")) return Promise.resolve({ data: { items: sanctions } });
    if (path.includes("/roster")) return Promise.resolve({ data: { squads: [] } });
    if (path.includes("/squad-candidates")) return Promise.resolve({ data: { teams: [], min_squad_size: 4, seats_taken: 2, max_participants: 8 } });
    if (path.match(/\/tournaments\/t1(\?|$)/)) return Promise.resolve({ data: served });
    return Promise.resolve({ data: {} });
  });
}

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.hash}`}</div>;
}

function renderPage(hash = "") {
  return render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={[`/admin/leagues/staffeln/t1${hash}`]}>
        <Routes>
          <Route path="/admin/leagues/staffeln/:tournamentId" element={<><AdminLeagueStaffelPage /><Where /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.delete.mockResolvedValue({ data: {} });
  serve();
});

test("Kopf mit Brotkrumen Liga › Season › Liga 1 · Staffel A, Stand und nur die fertigen Reiter", async () => {
  renderPage();
  expect(await screen.findByTestId("staffel-title")).toHaveTextContent("Liga 1 · Staffel A");
  const crumbs = screen.getByTestId("staffel-breadcrumbs");
  expect(within(crumbs).getByTestId("staffel-crumb-leagues")).toHaveAttribute("href", "/admin/leagues");
  expect(within(crumbs).getByTestId("staffel-crumb-season")).toHaveAttribute("href", "/admin/leagues/seasons/s1");
  expect(crumbs).toHaveTextContent("Probe-Liga · Season 1");
  expect(screen.getByTestId("staffel-stand")).toBeInTheDocument();
  const tabs = within(screen.getByTestId("staffel-tabs")).getAllByRole("tab").map((tab) => tab.textContent);
  expect(tabs).toEqual(["Überblick", "Teilnehmer"]);
});

test("Überblick: Liga-Ablauf, was fehlt mit Weg auf diese Seite, Zahlen und die Wege zu Leitstand, Season und Ligaseite", async () => {
  serve({ registrations: [] });
  renderPage();
  expect(await screen.findByTestId("tournament-flow-stepper")).toHaveTextContent("Liga-Ablauf");
  expect(screen.getByTestId("staffel-needs-assign")).toHaveAttribute("href", "/admin/leagues/staffeln/t1#zuteilen");
  expect(screen.getByTestId("staffel-numbers-teams")).toHaveTextContent("0 von 8");
  expect(screen.getByTestId("staffel-desk-link")).toHaveAttribute("href", "/admin/leagues/seasons/s1#leitstand");
  expect(screen.getByTestId("staffel-season-open")).toHaveAttribute("href", "/admin/leagues/seasons/s1");
  expect(screen.getByTestId("staffel-public-open")).toHaveAttribute("href", "/liga/probe-liga/season-1");
});

test("Überblick: der Schritt Spieltage führt noch in die Turnierverwaltung, Co-Teams zuteilen auf diese Seite", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId("flow-step-assign"));
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/leagues/staffeln/t1#zuteilen");
  expect(await screen.findByTestId("staffel-panel-teilnehmer")).toBeInTheDocument();
  await user.click(screen.getByTestId("staffel-tab-ueberblick"));
  await user.click(await screen.findByTestId("flow-step-matchdays"));
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/tournaments/t1");
});

test("„Liga starten“ fragt wie die Turnierverwaltung nach Hinweisen der Planung und setzt dann Live", async () => {
  const user = userEvent.setup();
  serve({ planning: { ok: true, warning_count: 1, error_count: 0, warnings: [{ message: "Woche 2 ohne Termin" }] } });
  renderPage();
  await user.click(await screen.findByTestId("staffel-primary-action"));
  const dialog = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog"));
  expect(dialog).toHaveTextContent("Mit Hinweisen live schalten?");
  expect(dialog).toHaveTextContent("Woche 2 ohne Termin");
  await user.click(within(dialog).getByRole("button", { name: "Trotzdem live" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/status", { status: "live", force: false }));
});

test("Status: Abgesagt fragt nach dem Grund wie in der Turnierverwaltung", async () => {
  const user = userEvent.setup();
  serve({ tournament: { status: "live" } });
  renderPage();
  await user.selectOptions(await screen.findByTestId("staffel-status-select"), "cancelled");
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Turnier absagen?");
  expect(dialog).toHaveTextContent("Alle 2 Anmeldungen bekommen");
});

test("ohne „Liga verwalten“ weder „Liga starten“ noch Statusauswahl - auch mit „Season konfigurieren“", async () => {
  serve({ tournament: { can_edit_staffel: false, can_manage_structure: true, league_capabilities: ["season", "applications"] } });
  renderPage();
  expect(await screen.findByTestId("staffel-status-readonly")).toHaveTextContent("Entwurf");
  expect(screen.queryByTestId("staffel-primary-action")).toBeNull();
  expect(screen.queryByTestId("staffel-status-select")).toBeNull();
});

test("Teilnehmer: Co-Teams mit „Zugeteilt“, Nachmeldung, Strafe mit Link, Eingang der Season, PDF und Zuteilen", async () => {
  const user = userEvent.setup();
  serve({ sanctions: [
    { id: "x1", status: "active", kind_label: "Spielsperre", target_type: "squad", registration_id: "r1", squad_id: "sq1", tournament_id: "t1" },
    { id: "x2", status: "revoked", kind_label: "Verwarnung", target_type: "squad", registration_id: "r2", squad_id: "sq2", tournament_id: "t1" },
  ] });
  renderPage("#teilnehmer");
  expect(await screen.findByTestId("staffel-teams-count")).toHaveTextContent("2 von 8");
  expect(screen.getAllByTestId("status-assigned").length).toBeGreaterThan(0);
  expect(screen.getAllByTestId("staffel-reg-late-r2")[0]).toHaveTextContent("Nachgemeldet ab Woche 3");
  expect(screen.getAllByTestId("staffel-reg-sanction-x1")[0]).toHaveAttribute("href", "/admin/leagues/seasons/s1#strafen");
  expect(screen.queryByTestId("staffel-reg-sanction-x2")).toBeNull();
  expect(screen.getByTestId("staffel-entry-link")).toHaveAttribute("href", "/admin/leagues/seasons/s1#anmeldungen");
  expect(screen.getByTestId("staffel-pdf-participants")).toHaveAttribute("href", "http://test.local/api/exports/tournaments/t1/participants.pdf");
  await user.click(screen.getByTestId("squad-assign-open"));
  expect(await screen.findByTestId("squad-assign-dialog")).toHaveTextContent("Co-Team zuteilen");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t1/squad-candidates"));
});

test("Teilnehmer: Entfernen vor dem festen Spielplan nimmt die Zuteilung zurück", async () => {
  const user = userEvent.setup();
  renderPage("#teilnehmer");
  const [remove] = await screen.findAllByTestId("staffel-reg-remove-r1");
  await user.click(remove);
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Co-Team entfernen?");
  await user.click(within(dialog).getByRole("button", { name: "Entfernen" }));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/tournaments/t1/squad-registrations/r1"));
});

test("Teilnehmer: im festen Spielplan kein Entfernen, im laufenden Betrieb Austritt und Disqualifizieren", async () => {
  serve({ tournament: { status: "live" }, matches: [{ id: "m1", status: "scheduled", slots: [{ registration_id: "r1" }, { registration_id: "r2" }] }] });
  renderPage("#teilnehmer");
  expect((await screen.findAllByTestId("admin-reg-withdraw-r1")).length).toBeGreaterThan(0);
  expect(screen.getAllByTestId("admin-reg-disqualify-r1").length).toBeGreaterThan(0);
  expect(screen.queryByTestId("staffel-reg-remove-r1")).toBeNull();
});

test("Teilnehmer ohne „Teams freigeben“: kein Zuteilen, kein Entfernen, kein Austritt - auch mit „Season konfigurieren“", async () => {
  serve({ tournament: { status: "live", can_manage_participants: false, can_manage_structure: true, league_capabilities: ["season"] } });
  renderPage("#teilnehmer");
  expect(await screen.findByTestId("staffel-teams-count")).toBeInTheDocument();
  expect(screen.queryByTestId("squad-assign-open")).toBeNull();
  expect(screen.queryByTestId("admin-reg-withdraw-r1")).toBeNull();
  expect(screen.queryByTestId("admin-reg-disqualify-r1")).toBeNull();
  expect(screen.queryByTestId("staffel-reg-remove-r1")).toBeNull();
});

test("Teilnehmer: 0 Co-Teams zeigt einen Satz statt einer leeren Tabelle", async () => {
  serve({ registrations: [] });
  renderPage("#zuteilen");
  expect(await screen.findByTestId("staffel-reg-empty")).toHaveTextContent("Noch kein Co-Team in dieser Staffel.");
});

test("ohne Zuständigkeit in der Liga der Satz des Servers, ein Turnier ohne Liga führt in die Turnierverwaltung", async () => {
  serve({ tournament: { league_capabilities: [] } });
  const { unmount } = renderPage();
  expect(await screen.findByTestId("staffel-no-right")).toHaveTextContent("Dafür fehlt dir das Recht in dieser Liga.");
  expect(screen.queryByTestId("staffel-tabs")).toBeNull();
  unmount();
  serve({ tournament: { league_context: null } });
  renderPage();
  expect(await screen.findByTestId("staffel-not-league")).toHaveTextContent("keine Liga-Staffel");
});
