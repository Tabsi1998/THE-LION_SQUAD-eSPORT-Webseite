import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// Diese Seite ist mit ueber 2000 Zeilen die groesste im Frontend und schreibt
// Turnierdaten. Der Test haelt fest, dass sie mit realistischen API-Antworten
// laedt, ihre Reiter bedienbar bleiben und dass eine Statusaenderung genau
// einen PATCH mit dem gewaehlten Status ausloest. Damit hat die geplante
// Zerlegung in Unterkomponenten ein Sicherheitsnetz.

const apiMock = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  API: "http://test.local/api",
  api: apiMock,
  formatApiError: (error, fallback) => fallback || String(error),
  formatRequestError: (error, fallback) => fallback || String(error),
  resolveMediaUrl: (value) => value || "",
}));

// Der Bereich Finanzen (#322) entscheidet, ob das Startgeld (#319) im Formular steht.
const authState = { areas: [], lead: true };
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ isTournamentLead: authState.lead, user: { id: "admin-1", display_name: "Admin" }, can: (area) => authState.areas.includes(area) }),
}));

vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

vi.mock("@/components/tls/AdminLayout", () => ({
  AdminLayout: ({ children }) => <div data-testid="admin-layout">{children}</div>,
}));
vi.mock("@/components/tls/BracketTree", () => ({ BracketTree: () => <div data-testid="bracket-tree" /> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: () => <div data-testid="markdown-editor" /> }));
vi.mock("@/components/tls/AccessLinksPanel", () => ({ AccessLinksPanel: () => <div data-testid="access-links" /> }));
vi.mock("@/components/tls/TournamentFlowStepper", () => ({ TournamentFlowStepper: () => <div data-testid="flow-stepper" /> }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const { AdminTournamentEditPage } = await import("./AdminTournamentEditPage").then((module) => ({
  AdminTournamentEditPage: module.default || module.AdminTournamentEditPage,
}));

const TOURNAMENT = {
  id: "t-1",
  slug: "winter-cup",
  title: "Winter Cup 2026",
  status: "registration_open",
  game: "rocket_league",
  format: "single_elimination",
  team_size: 3,
  max_teams: 16,
  registration_enabled: true,
  // Rechte je Turnier (#1353), wie sie der Server der Turnierleitung schickt.
  can_manage_structure: true,
  can_manage_results: true,
  can_manage_all_results: true,
  can_plan_matches: true,
  staff_scopes: [],
  can_check_in: true,
  can_manage_participants: true,
  can_assign_stations: true,
  can_use_staff_tools: true,
};

function routeFor(url) {
  if (url.includes("/registrations")) return { data: [] };
  if (url.includes("/bracket")) return { data: { rounds: [] } };
  if (url.includes("/stages")) return { data: [] };
  if (url.includes("/matches-v2")) return { data: [] };
  if (url.includes("/groups")) return { data: [] };
  if (url.includes("/staff")) return { data: [] };
  if (url.includes("/assignable-users")) return { data: [] };
  if (url.includes("/stations")) return { data: [] };
  if (url.startsWith("/users")) return { data: [] };
  if (url.startsWith("/teams")) return { data: [] };
  if (url.includes("/tournaments/t-1")) return { data: TOURNAMENT };
  return { data: [] };
}

function renderPage() {
  return render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/admin/tournaments/t-1"]}>
        <Routes>
          <Route path="/admin/tournaments/:id" element={<AdminTournamentEditPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
}

beforeEach(() => {
  authState.areas = [];
  authState.lead = true;
  apiMock.get.mockImplementation((url) => Promise.resolve(routeFor(String(url))));
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockImplementation((_url, body) => Promise.resolve({ data: { ...TOURNAMENT, ...body } }));
  apiMock.delete.mockResolvedValue({ data: {} });
});

// Startgeld (#319): nur der Bereich Finanzen sieht den Abschnitt, und nur dann geht `billing`
// beim Speichern mit - der Server lehnt es sonst mit 403 ab.
test("ohne Bereich Finanzen gibt es im Formular kein Startgeld", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.click(screen.getByTestId("admin-tr-tab-edit"));

  expect(await screen.findByTestId("tr-edit-save")).toBeInTheDocument();
  expect(screen.queryByTestId("event-billing")).not.toBeInTheDocument();
});

test("Finanzen schaltet das Startgeld ein und Speichern schickt es mit den Turnier-Schaltern", async () => {
  authState.areas = ["finance"];
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.click(screen.getByTestId("admin-tr-tab-edit"));

  const section = await screen.findByTestId("event-billing");
  expect(section).toHaveTextContent("Startgeld");
  await user.click(screen.getByTestId("event-billing-enabled"));
  await user.type(screen.getByTestId("event-billing-amount-0"), "10");
  await user.click(screen.getByTestId("tournament-billing-substitutes"));
  expect(screen.getByTestId("tr-edit-unsaved")).toBeInTheDocument();
  await user.click(screen.getByTestId("tr-edit-save"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tournaments/t-1", expect.objectContaining({
    billing: expect.objectContaining({
      enabled: true, count_substitutes: true, included_in_event: false,
      positions: [expect.objectContaining({ label: "Startgeld", amount_cents: 1000, basis: "per_person" })],
    }),
  })));
});

// „Ohne Discord“ (#572): keine Meldung, kein Thread, kein Bracket - der Haken geht beim Speichern mit.
test("„Ohne Discord“ geht beim Speichern mit", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.click(screen.getByTestId("admin-tr-tab-edit"));

  const skip = await screen.findByTestId("tr-edit-discord-skip");
  expect(skip).not.toBeChecked();
  expect(skip.closest("label")).toHaveTextContent("kein Thread, kein Bracket");
  await user.click(skip);
  await user.click(screen.getByTestId("tr-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tournaments/t-1", expect.objectContaining({ discord_skip: true })));
});

test("laedt das Turnier und zeigt Titel und Status", async () => {
  renderPage();

  expect(await screen.findByRole("heading", { name: "Winter Cup 2026" })).toBeInTheDocument();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith(expect.stringContaining("/tournaments/t-1")));
  expect(screen.getByTestId("admin-tr-status-select")).toHaveValue("registration_open");
});

test("die Arbeitsreiter sind vorhanden und lassen sich wechseln", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });

  for (const key of ["participants", "bracket", "stages", "staff", "edit"]) {
    expect(screen.getByTestId(`admin-tr-tab-${key}`)).toBeInTheDocument();
  }

  const editTab = screen.getByTestId("admin-tr-tab-edit");
  await user.click(editTab);

  expect(editTab.className).toContain("border-b-2");
});

test("der Gruppenreiter erscheint nur bei Gruppenformat", async () => {
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });

  expect(screen.queryByTestId("admin-tr-tab-groups")).not.toBeInTheDocument();
});

test("eine Statusaenderung schickt genau einen Aufruf mit dem neuen Status", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  apiMock.post.mockClear();

  await user.selectOptions(screen.getByTestId("admin-tr-status-select"), "registration_closed");

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    expect.stringContaining("/tournaments/t-1/status"),
    expect.objectContaining({ status: "registration_closed" })
  ));
  const statusCalls = apiMock.post.mock.calls.filter(([url]) => String(url).includes("/status"));
  expect(statusCalls).toHaveLength(1);
});

test("ein Ladefehler wird angezeigt statt endlos zu laden", async () => {
  apiMock.get.mockRejectedValue(new Error("Backend nicht erreichbar"));

  renderPage();

  expect(await screen.findByTestId("admin-tr-load-error")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Winter Cup 2026" })).not.toBeInTheDocument();
});

// Der Kopf trug dreizehn Bedienelemente in einer Reihe: nächster Schritt,
// Status, Sperren, Stationen, Planung, Zurücksetzen, Format-Aktion und fünf
// Downloads. Die Tests halten fest, dass oben nur noch steht, was das Turnier
// weiterschiebt, und der Rest hinter benannten Gruppen liegt.

test("der Kopf zeigt nur die Ablaufaktionen, Werkzeuge liegen in einer Gruppe", async () => {
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });

  expect(screen.getByTestId("admin-tr-primary-action")).toBeInTheDocument();
  expect(screen.getByTestId("admin-tr-status-select")).toBeInTheDocument();

  const tools = screen.getByTestId("admin-tr-tools");
  expect(tools).not.toHaveAttribute("open");
  expect(tools).toContainElement(screen.getByTestId("admin-tr-planning-check"));
  expect(tools).toContainElement(screen.getByTestId("admin-tr-reset"));
});

test("die Werkzeuggruppe lässt sich öffnen und nennt ihre Anzahl", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });

  const tools = screen.getByTestId("admin-tr-tools");
  // Ohne Stationen bleiben Planung prüfen und Zurücksetzen.
  expect(tools.querySelector("summary")).toHaveTextContent(/Werkzeuge\s*2/);

  await user.click(tools.querySelector("summary"));

  expect(tools).toHaveAttribute("open");
});

test("die Downloads liegen vollständig in ihrer eigenen Gruppe", async () => {
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });

  const downloads = screen.getByTestId("admin-tr-downloads");
  expect(downloads).not.toHaveAttribute("open");
  for (const key of ["participants", "checkin", "registration-qr", "matches", "match-plan"]) {
    expect(downloads).toContainElement(screen.getByTestId(`admin-tr-download-${key}`));
  }
});

test("die Format-Aktion steht oben und nicht in den Werkzeugen", async () => {
  renderPageWithFormat("swiss");
  await screen.findByRole("heading", { name: "Winter Cup 2026" });

  const swiss = screen.getByTestId("admin-tr-swiss-next");
  expect(swiss).toBeInTheDocument();
  expect(screen.getByTestId("admin-tr-tools")).not.toContainElement(swiss);
  expect(screen.getByTestId("admin-tr-downloads")).not.toContainElement(swiss);
});

// Die Turnierstruktur ist das einzige Strukturfeld, das im Bearbeiten-Formular
// sichtbar ist. Welcher Strukturtyp daraus folgt, entscheidet das Backend
// (services/competition_formats.py). Schickt das Formular dabei einen eigenen
// Strukturtyp mit, gewinnt dieser - deshalb darf es nur mitschicken, was
// wirklich gewählt wurde.
function renderPageWithFormat(format) {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/tournaments/t-1") && !path.includes("/registrations") && !path.includes("/bracket")
      && !path.includes("/stages") && !path.includes("/matches-v2") && !path.includes("/groups")
      && !path.includes("/staff") && !path.includes("/stations")) {
      return Promise.resolve({ data: { ...TOURNAMENT, format } });
    }
    return Promise.resolve(routeFor(path));
  });
  return renderPage();
}

async function applyStructure(user) {
  await user.click(screen.getByTestId("admin-tr-tab-edit"));
  apiMock.post.mockClear();
  await user.click(await screen.findByTestId("tr-edit-save-rebuild"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    expect.stringContaining("/bracket/from-format"),
    expect.anything()
  ));
  const [, body] = apiMock.post.mock.calls.find(([url]) => String(url).includes("/bracket/from-format"));
  return body;
}

test.each([
  ["league", "single_elimination"],
  ["round_robin", "single_elimination"],
  ["groups", "single_elimination"],
  ["ffa", "single_elimination"],
])("Struktur anwenden macht aus %s keine Einzelausscheidung", async (format) => {
  const user = userEvent.setup();
  renderPageWithFormat(format);
  await screen.findByRole("heading", { name: "Winter Cup 2026" });

  const body = await applyStructure(user);

  expect(body.stage_type).not.toBe("single_elimination");
});

test("ein Formatwechsel im Formular überschreibt den Strukturtyp nicht mehr selbst", async () => {
  const user = userEvent.setup();
  renderPageWithFormat("single_elim");
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.click(screen.getByTestId("admin-tr-tab-edit"));

  const formatSelect = await screen.findByLabelText("Turnierstruktur");
  await user.selectOptions(formatSelect, "league");

  apiMock.post.mockClear();
  await user.click(screen.getByTestId("tr-edit-save-rebuild"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    expect.stringContaining("/bracket/from-format"),
    expect.anything()
  ));
  const [, body] = apiMock.post.mock.calls.find(([url]) => String(url).includes("/bracket/from-format"));

  expect(body.stage_type).not.toBe("single_elimination");
});

test("eine vorhandene Phase behält ihren Strukturtyp", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/stages")) {
      return Promise.resolve({ data: [{ id: "s-1", stage_type: "round_robin_groups", match_type: "duel", settings: {} }] });
    }
    return Promise.resolve(routeFor(path));
  });
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });

  const body = await applyStructure(user);

  expect(body.stage_type).toBe("round_robin_groups");
});

test("ein Ausfall der Nebendaten blockiert das Turnier nicht", async () => {
  // Nur Personal-, Nutzer- und Teamlisten fallen aus: die Seite muss trotzdem stehen.
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/staff") || path.startsWith("/users") || path.startsWith("/teams")) {
      return Promise.reject(new Error("Teil-API nicht erreichbar"));
    }
    return Promise.resolve(routeFor(path));
  });

  renderPage();

  expect(await screen.findByRole("heading", { name: "Winter Cup 2026" })).toBeInTheDocument();
  expect(screen.queryByTestId("admin-tr-load-error")).not.toBeInTheDocument();
});

// Spielwochen gibt es nur bei Formaten, die in Wochen spielen. Ein
// K.-o.-Turnier hat Runden - dort waeren die Felder nur Ballast.

test("die Spielwochen-Einstellungen erscheinen nur bei Wochenformaten", async () => {
  const user = userEvent.setup();
  renderPageWithFormat("league");
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.click(screen.getByTestId("admin-tr-tab-edit"));

  expect(await screen.findByTestId("tr-edit-matchdays")).toBeInTheDocument();
  expect(screen.getByTestId("tr-edit-matchday-days")).toHaveValue(7);
  expect(screen.getByTestId("tr-edit-matchday-time")).toHaveValue("20:00");
  expect(screen.getByLabelText("Standardtag")).toHaveValue("6");
});

test("ein K.-o.-Turnier zeigt keine Spielwochen-Einstellungen", async () => {
  const user = userEvent.setup();
  renderPageWithFormat("single_elim");
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.click(screen.getByTestId("admin-tr-tab-edit"));

  await screen.findByLabelText("Turnierstruktur");
  expect(screen.queryByTestId("tr-edit-matchdays")).not.toBeInTheDocument();
});

test("Anmeldung im Discord (#885): Vorgabe an, Abwahl geht beim Speichern mit", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.click(screen.getByTestId("admin-tr-tab-edit"));

  const box = await screen.findByTestId("tr-edit-discord-registration");
  expect(box).toBeChecked();
  expect(box.closest("label")).toHaveTextContent("Kapitän");
  await user.click(box);
  await user.click(screen.getByTestId("tr-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tournaments/t-1", expect.objectContaining({ discord_registration: false })));
});

// Personensuche (#1354): Helfer, Teams und Personen laden je für sich. Die ganze Kontoliste (/users) lädt die Seite nie;
// fehlt das Recht für eine Liste, steht dort ein Satz und der Rest geht weiter.
test("Team-Turnier: fehlt das Recht für die Teams, steht ein Satz – Helfer laden trotzdem, /users nie", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path === "/admin/choices/teams") return Promise.reject({ response: { status: 403, data: { detail: "fehlt" } } });
    if (path.includes("/staff")) return Promise.resolve({ data: [{ id: "s-1", role: "referee", scope: "tournament", is_active: true, user: { display_name: "Pia Pokal", username: "pia.pokal" } }] });
    if (path.includes("/tournaments/t-1") && !path.includes("/", 15)) return Promise.resolve({ data: { ...TOURNAMENT, team_mode: "team" } });
    return Promise.resolve(routeFor(path));
  });
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  expect(await screen.findByTestId("participant-add-teams-error")).toHaveTextContent("Dafür fehlt dir das Recht: Teams dieses Turniers.");
  await user.click(screen.getByTestId("admin-tr-tab-staff"));
  expect(await screen.findByText("Pia Pokal")).toBeInTheDocument();
  expect(screen.getByText("@pia.pokal")).toBeInTheDocument();
  expect(apiMock.get.mock.calls.map(([url]) => String(url))).not.toContain("/users");
});

test("Teilnehmer über die Personensuche: die Anmeldung geht mit der Kennung des Kontos", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path === "/admin/people/search") return Promise.resolve({ data: [{ id: "u-9", name: "Erika Beispiel", context: "Mitglied" }] });
    if (path === "/admin/choices/teams") return Promise.resolve({ data: [] });
    return Promise.resolve(routeFor(path));
  });
  apiMock.post.mockResolvedValue({ data: { id: "r-1" } });
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.type(screen.getByTestId("participant-add-user-search"), "eri");
  await user.click(await screen.findByTestId("participant-add-user-option-u-9"));
  expect(screen.getByTestId("participant-add-user-selected")).toHaveTextContent("Erika Beispiel");
  await user.click(screen.getByTestId("participant-add-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t-1/registrations", expect.objectContaining({ user_id: "u-9" })));
});

// Knöpfe nach den Rechten je Turnier (#1353): eine Stream-Betreuung sieht keine Check-in-, Entfernen- oder Aufbau-Knöpfe
// und keinen Reiter „Team“; eine Redaktion (kein Recht in diesem Turnier) gar keine Werkzeuge.
const NO_RIGHTS = {
  can_manage_structure: false, can_manage_results: false, can_manage_all_results: false, can_plan_matches: false, staff_scopes: [], can_check_in: false, can_manage_participants: false,
  can_assign_stations: false, can_use_staff_tools: false,
};

function serveTournament(rights) {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/registrations")) return Promise.resolve({ data: [{ id: "r-1", status: "approved", display_name: "Max Muster" }] });
    if (path.includes("/tournaments/t-1") && !path.includes("/", 15)) return Promise.resolve({ data: { ...TOURNAMENT, ...NO_RIGHTS, ...rights } });
    return Promise.resolve(routeFor(path));
  });
}

test("Stream-Betreuung: nur die Werkzeuge zum Lesen, kein Check-in, kein Entfernen, kein Team", async () => {
  authState.lead = false;
  serveTournament({ can_use_staff_tools: true });
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await screen.findAllByText("Max Muster");
  expect(screen.queryByRole("button", { name: "Check-in" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Entfernen" })).toBeNull();
  expect(screen.queryByTestId("participant-add-submit")).toBeNull();
  expect(screen.queryByTestId("admin-tr-reset")).toBeNull();
  expect(screen.getByTestId("admin-tr-planning-check")).toBeInTheDocument();
  expect(screen.queryByTestId("admin-tr-tab-staff")).toBeNull();
  expect(apiMock.get.mock.calls.map(([url]) => String(url))).not.toContain("/admin/choices/teams");
});

test("Ergebnisdienst: Check-in und Teilnehmer ja, Turnierbaum zurücksetzen nein", async () => {
  authState.lead = false;
  serveTournament({ can_use_staff_tools: true, can_check_in: true, can_manage_participants: true, can_manage_results: true });
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  expect((await screen.findAllByRole("button", { name: "Check-in" })).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: "Entfernen" }).length).toBeGreaterThan(0);
  expect(screen.queryByTestId("admin-tr-reset")).toBeNull();
});

test("Redaktion ohne Recht in diesem Turnier: keine Werkzeuge", async () => {
  authState.lead = false;
  serveTournament({});
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await screen.findAllByText("Max Muster");
  expect(screen.queryByRole("button", { name: "Check-in" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Entfernen" })).toBeNull();
  expect(screen.queryByTestId("admin-tr-tools")).toBeNull();
  expect(screen.queryByTestId("admin-tr-tab-staff")).toBeNull();
  expect(apiMock.get.mock.calls.map(([url]) => String(url)).some((url) => url.startsWith("/stations"))).toBe(false);
});

// Nach Codex-Prüfung (#1353): „Bearbeiten“ speichert per PATCH, das nur die Turnierleitung darf - Helfer sehen den Reiter
// nicht, auch nicht über ?tab=edit.
test("Helfer sehen den Reiter „Bearbeiten“ nicht", async () => {
  authState.lead = false;
  serveTournament({ can_use_staff_tools: true, can_manage_structure: true, can_check_in: true, can_manage_participants: true });
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  expect(screen.queryByTestId("admin-tr-tab-edit")).toBeNull();
  expect(screen.queryByTestId("tr-edit-save")).toBeNull();
});

test("die Turnierleitung sieht „Bearbeiten“", async () => {
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  expect(screen.getByTestId("admin-tr-tab-edit")).toBeInTheDocument();
});

// Ein Einsatz nur für ein Spiel (#1353): „Ergebnis eintragen“ steht nur bei diesem Spiel, nicht bei allen.
test("an ein Spiel gebundener Ergebnisdienst: Ergebnis-Knopf nur bei seinem Spiel", async () => {
  const user = userEvent.setup();
  authState.lead = false;
  const slots = [{ status: "filled", registration_id: "r-a" }, { status: "filled", registration_id: "r-b" }];
  const matches = [
    { id: "m-mine", stage_id: "st-1", match_key: "A1", status: "ready", slots, results: [] },
    { id: "m-other", stage_id: "st-1", match_key: "A2", status: "ready", slots, results: [] },
  ];
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/stages")) return Promise.resolve({ data: [{ id: "st-1", name: "Hauptrunde", match_type: "ffa", stage_type: "ffa_custom_bracket", status: "running", settings: {} }] });
    if (path.includes("/matches-v2")) return Promise.resolve({ data: matches });
    if (path.includes("/tournaments/t-1") && !path.includes("/", 15)) {
      return Promise.resolve({ data: { ...TOURNAMENT, ...NO_RIGHTS, status: "live", can_manage_results: true, can_use_staff_tools: true,
        staff_scopes: [{ scope: "match", scope_id: "m-mine", results: true, plan: false }] } });
    }
    return Promise.resolve(routeFor(path));
  });
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.click(screen.getByTestId("admin-tr-tab-stages"));
  expect(await screen.findByTestId("matchplan-result-m-mine")).toBeInTheDocument();
  expect(screen.queryByTestId("matchplan-result-m-other")).toBeNull();
});

// Grand Final (#1549): im Bearbeiten-Formular nur beim Doppel-K.-o., mit dem gespeicherten Wert.
test("Bearbeiten: Grand Final nur beim Doppel-K.-o., gespeicherter Wert vorbelegt", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation((url) => Promise.resolve(String(url).includes("/tournaments/t-1") && !String(url).includes("/t-1/")
    ? { data: { ...TOURNAMENT, format: "double_elim", grand_final_mode: "none" } }
    : routeFor(String(url))));
  renderPage();
  await screen.findByRole("heading", { name: "Winter Cup 2026" });
  await user.click(screen.getByTestId("admin-tr-tab-edit"));
  const select = await screen.findByTestId("tr-edit-grand-final");
  expect(select).toHaveValue("none");
  await user.selectOptions(select, "reset");
  await user.click(screen.getByTestId("tr-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tournaments/t-1", expect.objectContaining({ grand_final_mode: "reset" })));
});
