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

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ isAdmin: true, isModerator: true, user: { id: "admin-1", display_name: "Admin" } }),
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
  can_manage_structure: true,
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
  apiMock.get.mockImplementation((url) => Promise.resolve(routeFor(String(url))));
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockImplementation((_url, body) => Promise.resolve({ data: { ...TOURNAMENT, ...body } }));
  apiMock.delete.mockResolvedValue({ data: {} });
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
