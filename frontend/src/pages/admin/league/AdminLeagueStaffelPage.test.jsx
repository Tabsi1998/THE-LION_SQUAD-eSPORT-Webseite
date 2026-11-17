import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
const { toast } = await import("sonner");

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
function serve({ tournament = {}, registrations = SQUADS, matches = [], planning = { ok: true, warning_count: 0, error_count: 0 }, sanctions = [], roster = [], failRegistrations = false } = {}) {
  served = { ...STAFFEL, ...tournament };
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/planning-check")) return Promise.resolve({ data: planning });
    if (path.includes("/team-day/")) return Promise.resolve({ data: {} });
    if (path.includes("/registrations")) return failRegistrations ? Promise.reject(new Error("weg")) : Promise.resolve({ data: registrations });
    if (path.includes("/matches-v2")) return Promise.resolve({ data: matches });
    if (path.includes("/sanctions")) return Promise.resolve({ data: { items: sanctions } });
    if (path.includes("/roster")) return Promise.resolve({ data: { squads: roster } });
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
  expect(tabs).toEqual(["Überblick", "Teilnehmer", "Spielplan", "Spiele und Ergebnisse", "Tabelle"]);
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

test("Überblick: die Schritte des Liga-Ablaufs führen auf diese Seite - Zuteilen, Spieltage und Tabelle", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId("flow-step-assign"));
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/leagues/staffeln/t1#zuteilen");
  expect(await screen.findByTestId("staffel-panel-teilnehmer")).toBeInTheDocument();
  await user.click(screen.getByTestId("staffel-tab-ueberblick"));
  await user.click(await screen.findByTestId("flow-step-matchdays"));
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/leagues/staffeln/t1#spiele");
  expect(await screen.findByTestId("staffel-panel-spiele")).toBeInTheDocument();
  await user.click(screen.getByTestId("staffel-tab-ueberblick"));
  await user.click(await screen.findByTestId("flow-step-table"));
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/leagues/staffeln/t1#tabelle");
});

test("„Liga starten“ fragt wie die Turnierverwaltung nach Hinweisen der Planung und setzt dann Live", async () => {
  const user = userEvent.setup();
  serve({ planning: { ok: true, warning_count: 1, error_count: 0, warnings: [{ message: "Woche 2 ohne Termin" }] } });
  renderPage();
  await user.click(await screen.findByTestId("staffel-primary-action"));
  const dialog = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog"));
  expect(dialog).toHaveTextContent("Mit Hinweisen starten?");
  expect(dialog).toHaveTextContent("Woche 2 ohne Termin");
  await user.click(within(dialog).getByRole("button", { name: "Trotzdem starten" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/status", { status: "live", force: false }));
  // Liga-Wörter statt „Status: Live“ (Kann-Punkt aus Paket A).
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Liga gestartet"));
});

test("Status: Abgesagt fragt nach dem Grund wie in der Turnierverwaltung", async () => {
  const user = userEvent.setup();
  serve({ tournament: { status: "live" } });
  renderPage();
  await user.selectOptions(await screen.findByTestId("staffel-status-select"), "cancelled");
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Staffel absagen?");
  expect(dialog).toHaveTextContent("Alle 2 Co-Teams bekommen");
});

test("ohne „Liga verwalten“ weder „Liga starten“ noch Statusauswahl - auch mit „Season konfigurieren“", async () => {
  serve({ tournament: { can_edit_staffel: false, can_manage_structure: true, league_capabilities: ["season", "applications"] } });
  renderPage();
  // Der Stand steht nur einmal - im Abzeichen oben; die Kachel sagt nur, wer ihn ändert (Kann-Punkt aus Paket A).
  const readonly = await screen.findByTestId("staffel-status-readonly");
  expect(readonly).toHaveTextContent("Den Status ändert, wer in dieser Liga „Liga verwalten“ hat.");
  expect(readonly).not.toHaveTextContent("Vor dem Start");
  expect(screen.getByTestId("staffel-stand")).toHaveTextContent("Vor dem Start");
  expect(screen.queryByTestId("staffel-primary-action")).toBeNull();
  expect(screen.queryByTestId("staffel-status-select")).toBeNull();
});

test("Teilnehmer: Co-Teams ohne „Zugeteilt“-Rauschen, Nachmeldung, Strafe mit Link, Eingang der Season, PDF und Zuteilen", async () => {
  const user = userEvent.setup();
  serve({ sanctions: [
    { id: "x1", status: "active", kind_label: "Spielsperre", target_type: "squad", registration_id: "r1", squad_id: "sq1", tournament_id: "t1" },
    { id: "x2", status: "revoked", kind_label: "Verwarnung", target_type: "squad", registration_id: "r2", squad_id: "sq2", tournament_id: "t1" },
  ] });
  renderPage("#teilnehmer");
  expect(await screen.findByTestId("staffel-teams-count")).toHaveTextContent("2 von 8");
  expect(screen.queryByText("Zugeteilt")).toBeNull();
  expect(screen.queryByTestId("staffel-reg-status-r1")).toBeNull();
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

// ---------------------------------------------------------------- Fix-Runde 1 (Prüfung #2262 A)

test("Aufstellung je Co-Team nur mit „Spiele betreuen“ - ohne das Recht kein Aufruf, der mit 403 endet", async () => {
  serve({ tournament: { league_capabilities: ["applications", "manage"] } });
  const { unmount } = renderPage("#teilnehmer");
  await screen.findByTestId("staffel-teams-count");
  expect(apiMock.get.mock.calls.map(([url]) => String(url)).some((url) => url.includes("/team-day/"))).toBe(false);
  unmount();
  serve();
  renderPage("#teilnehmer");
  await screen.findByTestId("staffel-teams-count");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/team-day/t1/lineups"));
});

test("Ladefehler der Co-Teams: sichtbarer Hinweis mit „Nochmal versuchen“ statt „0 von 8“ oder „Noch kein Co-Team“", async () => {
  const user = userEvent.setup();
  serve({ failRegistrations: true });
  renderPage("#teilnehmer");
  expect(await screen.findByTestId("staffel-load-error")).toHaveTextContent("Co-Teams und Spiele ließen sich nicht laden");
  expect(screen.getByTestId("staffel-title")).toHaveTextContent("Liga 1 · Staffel A");
  expect(screen.queryByTestId("staffel-teams-count")).toBeNull();
  expect(screen.queryByText(/0 von 8/)).toBeNull();
  expect(screen.queryByText("Noch kein Co-Team in dieser Staffel.")).toBeNull();
  serve();
  await user.click(screen.getByTestId("staffel-retry"));
  expect(await screen.findByTestId("staffel-teams-count")).toHaveTextContent("2 von 8");
  expect(screen.queryByTestId("staffel-load-error")).toBeNull();
});

test("Neu laden nach einer Statusänderung scheitert: Hinweis, der alte Stand bleibt stehen", async () => {
  const user = userEvent.setup();
  renderPage();
  const start = await screen.findByTestId("staffel-primary-action");
  serve({ failRegistrations: true });
  await user.click(start);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/status", { status: "live", force: false }));
  expect(await screen.findByTestId("staffel-load-error")).toHaveTextContent("Neu laden hat nicht geklappt");
  expect(screen.getByTestId("staffel-retry")).toBeInTheDocument();
  expect(screen.getByTestId("staffel-numbers-teams")).toHaveTextContent("2 von 8");
});

test("„Liga starten“ steht nur einmal da: nicht unter „Was fehlt“, der Ablauf-Schritt führt zum Knopf auf dieser Seite", async () => {
  const user = userEvent.setup();
  renderPage();
  const start = await screen.findByTestId("staffel-primary-action");
  expect(screen.queryByTestId("staffel-needs-start")).toBeNull();
  expect(screen.getAllByText(/Liga starten/).filter((node) => node.closest("button,a") && node.closest("[data-testid=tournament-flow-stepper]") === null)).toHaveLength(1);
  await user.click(screen.getByTestId("flow-step-start"));
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/leagues/staffeln/t1");
  expect(screen.getByTestId("where")).not.toHaveTextContent("/admin/tournaments");
  expect(start).toHaveFocus();
});

test("wer nur lesen darf, sieht „Liga starten“ unter „Was fehlt“ als Satz ohne Link", async () => {
  serve({ tournament: { can_edit_staffel: false, league_capabilities: ["applications"] } });
  renderPage();
  const need = await screen.findByTestId("staffel-needs-start");
  expect(need.tagName).toBe("SPAN");
});

test("vor dem Start kein Auswahlfeld: nur „Liga starten“ und „Staffel absagen“ mit Rückfrage", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByTestId("staffel-primary-action");
  expect(screen.queryByTestId("staffel-status-select")).toBeNull();
  await user.click(screen.getByTestId("staffel-cancel"));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Staffel absagen?");
});

test("nach dem Start nur die Status, die eine Staffel braucht - in Liga-Wörtern", async () => {
  serve({ tournament: { status: "live" } });
  renderPage();
  const options = [...(await screen.findByTestId("staffel-status-select")).querySelectorAll("option")].map((option) => [option.value, option.textContent]);
  expect(options).toEqual([["live", "Spielbetrieb"], ["paused", "Pausiert"], ["completed", "Beendet"], ["cancelled", "Abgesagt"]]);
  expect(screen.queryByTestId("staffel-cancel")).toBeNull();
});

test("das Wort „Entwurf“ kommt auf der Staffel-Seite nirgends vor", async () => {
  const user = userEvent.setup();
  for (const tournament of [{}, { can_edit_staffel: false, league_capabilities: ["applications"] }, { status: "live" }, { status: "paused" }]) {
    serve({ tournament });
    const { container, unmount } = renderPage();
    await screen.findByTestId("staffel-status");
    expect(container.textContent).not.toMatch(/Entwurf/);
    await user.click(screen.getByTestId("staffel-tab-teilnehmer"));
    await screen.findByTestId("staffel-teams-count");
    expect(container.textContent).not.toMatch(/Entwurf/);
    unmount();
  }
});

test("Kader-Hinweis je Co-Team aus der Kaderübersicht: Größe und fehlende IDs, unter Mindestkader als Warnung", async () => {
  serve({ roster: [
    { registration_id: "r1", squad_id: "sq1", member_count: 6, min_squad_size: 4, short: false, players: [{ id: "u1", ok: true }, { id: "u2", ok: true }] },
    { registration_id: "r2", squad_id: "sq2", member_count: 3, min_squad_size: 4, short: true, players: [{ id: "u3", ok: false }, { id: "u4", ok: true }] },
  ] });
  renderPage("#teilnehmer");
  expect((await screen.findAllByTestId("staffel-reg-kaderline-r1"))[0]).toHaveTextContent("6 im Kader · alle IDs gültig");
  const short = screen.getAllByTestId("staffel-reg-kaderline-r2")[0];
  expect(short).toHaveTextContent("3 im Kader · 1 ohne gültige ID · unter Mindestkader 4");
  expect(short.className).toContain("text-warn");
});

test("ausgetreten oder disqualifiziert steht als Kennzeichen da, zugeteilt nicht", async () => {
  serve({ tournament: { status: "live" }, registrations: [...SQUADS, { id: "r3", status: "withdrawn", display_name: "Bergdohlen · Schwarm", team_id: "tm3", squad_id: "sq3" }] });
  renderPage("#teilnehmer");
  expect((await screen.findAllByTestId("staffel-reg-status-r3"))[0]).toHaveTextContent(/ausgetreten/i);
  expect(screen.queryByTestId("staffel-reg-status-r1")).toBeNull();
  expect(screen.queryByTestId("staffel-reg-remove-r3")).toBeNull();
});

test("Entfernen in einer laufenden Staffel (Nachmeldung ohne festes Spiel) verspricht kein Neumischen", async () => {
  const user = userEvent.setup();
  serve({ tournament: { status: "live" } });
  renderPage("#teilnehmer");
  const [remove] = await screen.findAllByTestId("staffel-reg-remove-r2");
  await user.click(remove);
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Es hat noch kein festes Spiel");
  expect(dialog).not.toHaveTextContent("neu gemischt");
});

function Jump({ to }) {
  const navigate = useNavigate();
  return <button type="button" data-testid="jump" onClick={() => navigate(to)}>weiter</button>;
}

test("Wechsel auf eine andere Staffel zeigt nichts von der vorigen, bis die neue geladen ist", async () => {
  // Kann-Punkt aus Paket A: neue `tournamentId`, frischer Zustand - nie die Co-Teams von Staffel A unter dem Kopf von Staffel B.
  const user = userEvent.setup();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  serve();
  const base = apiMock.get.getMockImplementation();
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.match(/\/tournaments\/t2(\?|$)/)) return Promise.resolve({ data: { ...STAFFEL, id: "t2", league_context: { ...STAFFEL.league_context, staffel: "B" }, league_links: { ...STAFFEL.league_links, staffel: "B" } } });
    if (path.includes("/tournaments/t2/registrations")) return pending;
    if (path.includes("/tournaments/t2/")) return Promise.resolve({ data: [] });
    return base(url);
  });
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/admin/leagues/staffeln/t1#teilnehmer"]}>
        <Routes>
          <Route path="/admin/leagues/staffeln/:tournamentId" element={<><AdminLeagueStaffelPage /><Jump to="/admin/leagues/staffeln/t2#teilnehmer" /></>} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>,
  );
  expect((await screen.findAllByText("Nebelwölfe · Rudel")).length).toBeGreaterThan(0);
  await user.click(screen.getByTestId("jump"));
  expect(await screen.findByTestId("staffel-title")).toHaveTextContent("Staffel B");
  expect(screen.getByTestId("staffel-lists-loading")).toBeInTheDocument();
  expect(screen.queryByText("Nebelwölfe · Rudel")).toBeNull();
  release({ data: [] });
  expect(await screen.findByTestId("staffel-teams-count")).toHaveTextContent("0");
});

test("Tabelle: den Gleichstand entscheidet nur, wer „Ergebnisse korrigieren“ hat", async () => {
  const table = { can_decide: true, superadmin: false, rules: {}, standings: [], decisions: [],
    ties: [{ rank: 1, registration_ids: ["r1", "r2"], names: ["Nebelwölfe · Rudel", "Sturmfalken · Horst"], points: 3 }] };
  for (const [capabilities, allowed] of [[ALL, true], [ALL.filter((item) => item !== "results"), false]]) {
    serve({ tournament: { status: "live", league_capabilities: capabilities } });
    const base = apiMock.get.getMockImplementation();
    apiMock.get.mockImplementation((url) => (String(url).endsWith("/admin/leagues/staffeln/t1/table") ? Promise.resolve({ data: table }) : base(url)));
    const { unmount } = renderPage("#gleichstand");
    expect(await screen.findByTestId("season-tie-t1-1")).toBeInTheDocument();
    if (allowed) expect(screen.getByTestId("season-tie-decide-1")).toBeInTheDocument();
    else expect(screen.queryByTestId("season-tie-decide-1")).toBeNull();
    expect(screen.getByTestId("staffel-pdf-standings")).toHaveAttribute("href", "http://test.local/api/exports/tournaments/t1/standings.pdf");
    unmount();
  }
});
