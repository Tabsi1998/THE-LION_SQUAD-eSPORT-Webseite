import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

// Team-Seite: Termine und letzte Spiele (#1191), „Einladen“ mit Link und QR-Code, Beitreten über den Link.
// Erfundene Daten, keine echten Personen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (v) => v || "" }));
const authState = { user: null, isAdmin: false };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <div data-testid="branded-qr-code" data-value={value} /> }));
const confirmMock = vi.fn();
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
const invalidation = { reload: null };
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: (callback, resources = []) => { if (resources.includes("teams")) invalidation.reload = callback; } }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useChats", () => ({ useChatRead: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useTilt", () => ({ useTilt: () => null }));
vi.mock("@/pages/user/profile/TeamsPanel", () => ({ TeamsPanel: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: TeamsPage } = await import("./TeamsPage");

const MEMBERS = [
  { id: "u-cap", username: "neonfalke", display_name: "NeonFalke" },
  { id: "u-co", username: "pixelpanther", display_name: "PixelPanther" },
  { id: "u-3", username: "lunabyte", display_name: "LunaByte" },
];
const TEAM = {
  id: "t-1", name: "Lions Rocket", tag: "LRK", leader_id: "u-cap", co_leader_ids: ["u-co"], member_ids: MEMBERS.map((m) => m.id),
  members: MEMBERS, is_member: true, can_manage: true, join_code: "Kx7pQ2", awards: [],
};
const OVERVIEW = {
  upcoming: [{ registration_id: "r-1", status: "approved", status_label: "Angemeldet", tournament: { id: "tt-1", slug: "rl-herbst", title: "Rocket League Herbst-Cup", start_date: "2026-10-17T14:00:00Z" } }],
  recent: [{ match_id: "m-1", kind: "duel", outcome: "win", score: "3:1", opponent: "Pixelpiraten", round_label: "Finale", tournament: { title: "Liga Herbst" } }],
};

function serve(team = TEAM, extra = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url in extra) {
      const value = extra[url];
      if (value instanceof Error) throw value;
      return { data: value };
    }
    if (url === "/teams/t-1") return { data: team };
    if (url === "/teams/t-1/overview") return { data: OVERVIEW };
    if (url === "/teams/t-1/invite-link") return { data: { url: "https://lionsquad.at/teams/t-1?einladung=AbC123", token: "AbC123" } };
    if (url === "/teams/t-1/level") throw new Error("kein Level");
    if (url === "/teams/t-1/chat") return { data: [] };
    return { data: {} };
  });
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/teams/:id" element={<TeamsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  confirmMock.mockReset();
  authState.user = { id: "u-cap", username: "neonfalke" };
});

test("Team-Seite: Angemeldet für und Letzte Spiele; Einladen öffnet Link mit QR-Code", async () => {
  serve();
  renderAt("/teams/t-1");
  expect(await screen.findByTestId("team-upcoming")).toHaveTextContent("Rocket League Herbst-Cup");
  expect(screen.getByTestId("team-recent")).toHaveTextContent("3:1 gegen Pixelpiraten");
  fireEvent.click(screen.getByTestId("team-invite-open"));
  await waitFor(() => expect(screen.getByTestId("branded-qr-code")).toHaveAttribute("data-value", "https://lionsquad.at/teams/t-1?einladung=AbC123"));
  expect(screen.getByTestId("team-join-code-box")).toHaveTextContent("Kx7pQ2");
});

test("Einladungs-Link für ein privates Team: nur die Einladung mit „Beitreten“", async () => {
  authState.user = { id: "u-9", username: "kiwikomet" };
  const missing = Object.assign(new Error("404"), { response: { status: 404 } });
  serve(TEAM, {
    "/teams/t-1": missing,
    "/teams/t-1/invite-link/check": { valid: true, already_member: false, team: { name: "Lions Rocket", member_count: 3 } },
  });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  renderAt("/teams/t-1?einladung=AbC123");
  expect(await screen.findByText("Du bist eingeladen: Lions Rocket")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("team-join-invite-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/teams/t-1/join-link", { token: "AbC123" }));
});

// „Löschen“ nicht neben „Bearbeiten“ (#1274): oben nur Einladen und Bearbeiten; „Team auflösen“ ganz unten im
// Bearbeiten-Blatt, mit einem Satz, was passiert, und erst mit dem richtig eingetippten Teamnamen.
test("oben nur Einladen und Bearbeiten - kein roter Lösch-Knopf", async () => {
  serve();
  renderAt("/teams/t-1");
  await screen.findByTestId("team-header-actions");
  expect(screen.getByTestId("team-invite-open")).toHaveTextContent("Einladen");
  expect(screen.getByTestId("team-edit-open")).toHaveTextContent("Bearbeiten");
  expect(screen.queryByTestId("team-delete")).toBeNull();
  expect(screen.getByTestId("team-header-actions").querySelector(".tls-btn--danger")).toBeNull();
});

test("Auflösen im Bearbeiten-Blatt: falscher Name sperrt, richtiger Name löst auf", async () => {
  serve(TEAM, {
    "/teams/t-1/dissolve-preview": { member_count: 3, chat_messages: 4, withdraw: [{ registration_id: "r-1", tournament_id: "tt-1", title: "Rocket League Herbst-Cup" }], blocked: [], can_dissolve: true },
  });
  apiMock.delete.mockResolvedValue({ data: { ok: true, withdrawn: 1 } });
  renderAt("/teams/t-1");
  fireEvent.click(await screen.findByTestId("team-edit-open"));
  const sheet = await screen.findByTestId("team-edit-sheet");
  await waitFor(() => expect(screen.getByTestId("team-dissolve-sentence")).toHaveTextContent("Alle 3 Mitglieder verlieren das Team, der Team-Chat mit 4 Nachrichten wird gelöscht und die Anmeldung für „Rocket League Herbst-Cup“ wird zurückgezogen."));
  // Das Auflösen steht nach dem Formular, ganz unten im Blatt.
  const order = [...sheet.querySelectorAll("[data-testid]")].map((node) => node.getAttribute("data-testid"));
  expect(order.indexOf("team-dissolve")).toBeGreaterThan(order.indexOf("team-color-picker"));
  const submit = screen.getByTestId("team-dissolve-submit");
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByTestId("team-dissolve-name"), { target: { value: "Lions" } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByTestId("team-dissolve-name"), { target: { value: "lions rocket" } });
  expect(submit).not.toBeDisabled();
  fireEvent.click(submit);
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/teams/t-1", { params: { confirm: "lions rocket" } }));
});

test("läuft ein Turnier, bleibt Auflösen gesperrt und das Turnier steht da; Co-Kapitäne sehen das Auflösen nicht", async () => {
  serve(TEAM, {
    "/teams/t-1/dissolve-preview": { member_count: 3, chat_messages: 0, withdraw: [], blocked: [{ registration_id: "r-9", tournament_id: "tt-9", slug: "liga", title: "Liga live", reason: "Das Turnier läuft gerade – das klärt die Turnierleitung." }], can_dissolve: false },
  });
  const { unmount } = renderAt("/teams/t-1");
  fireEvent.click(await screen.findByTestId("team-edit-open"));
  expect(await screen.findByTestId("team-dissolve-blocked")).toHaveTextContent("Liga live");
  fireEvent.change(screen.getByTestId("team-dissolve-name"), { target: { value: "Lions Rocket" } });
  expect(screen.getByTestId("team-dissolve-submit")).toBeDisabled();
  unmount();

  authState.user = { id: "u-co", username: "pixelpanther" };
  serve();
  renderAt("/teams/t-1");
  fireEvent.click(await screen.findByTestId("team-edit-open"));
  await screen.findByTestId("team-edit-sheet");
  expect(screen.queryByTestId("team-dissolve")).toBeNull();
});

test("ohne Netz oder bei einem Serverfehler: Fehler mit „Nochmal versuchen“ statt ewigem Laden oder „nicht gefunden“ (#983, #1152)", async () => {
  const offline = new Error("Network Error");
  serve(TEAM, { "/teams/t-1": offline });
  renderAt("/teams/t-1");
  const error = await screen.findByTestId("public-error-state");
  expect(error).toHaveAttribute("data-kind", "offline");
  expect(screen.queryByTestId("team-missing")).toBeNull();
  serve(TEAM);
  fireEvent.click(screen.getByTestId("public-error-retry"));
  expect(await screen.findByText("Lions Rocket")).toBeInTheDocument();
  expect(screen.queryByTestId("public-error-state")).toBeNull();
});

test("404 ist „Team nicht gefunden“", async () => {
  serve(TEAM, { "/teams/t-1": Object.assign(new Error("404"), { response: { status: 404 } }) });
  renderAt("/teams/t-1");
  expect(await screen.findByTestId("team-missing")).toBeInTheDocument();
});

// Teamwechsel (#1047): Chat-Entwurf und Anhänge bleiben beim Team, für das sie gedacht waren.
function GoTo({ to }) {
  const navigate = useNavigate();
  return <button type="button" data-testid={`goto-${to}`} onClick={() => navigate(to)}>wechseln</button>;
}

test("Wechsel zu einem anderen Team: der Team-Chat startet ohne Anhänge des vorigen", async () => {
  authState.user = { id: "u-cap", username: "neonfalke" };
  const urlSpies = [vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:vorschau"), vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})];
  const other = { ...TEAM, id: "t-2", name: "Lions Valorant", tag: "LVA" };
  apiMock.get.mockImplementation(async (url) => {
    const match = String(url).match(/^\/teams\/(t-[12])(\/.*)?$/);
    if (!match) return { data: {} };
    const [, id, rest = ""] = match;
    if (rest === "") return { data: id === "t-1" ? TEAM : other };
    if (rest === "/overview") return { data: OVERVIEW };
    if (rest === "/chat") return { data: [] };
    if (rest === "/level") throw new Error("kein Level");
    return { data: {} };
  });
  apiMock.post.mockImplementation(async (url) => (url === "/chat-attachments" ? { data: { id: "att-t1", kind: "image" } } : { data: {} }));
  try {
    render(
      <MemoryRouter initialEntries={["/teams/t-1"]}>
        <Routes><Route path="/teams/:id" element={<><GoTo to="/teams/t-2" /><TeamsPage /></>} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId("team-chat");
    fireEvent.change(screen.getByTestId("team-chat-attach-input"), { target: { files: [new File(["x"], "bild.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByTestId("chat-attachment-drafts").querySelector('[data-status="ready"]')).not.toBeNull());

    fireEvent.click(screen.getByTestId("goto-/teams/t-2"));
    expect(await screen.findAllByText("Lions Valorant")).not.toHaveLength(0);
    await screen.findByTestId("team-chat");
    expect(screen.queryByTestId("chat-attachment-drafts")).toBeNull();
  } finally {
    urlSpies.forEach((spy) => spy.mockRestore());
    authState.user = null;
  }
});

test("Kontowechsel auf der Teamseite: Einladung und Bearbeiten des vorigen Kontos sind zu", async () => {
  serve();
  const page = () => (
    <MemoryRouter initialEntries={["/teams/t-1"]}>
      <Routes><Route path="/teams/:id" element={<TeamsPage />} /></Routes>
    </MemoryRouter>
  );
  const view = render(page());
  fireEvent.click(await screen.findByTestId("team-invite-open"));
  expect(await screen.findByTestId("team-invite-sheet")).toBeInTheDocument();

  authState.user = { id: "u-3", username: "lunabyte" };
  view.rerender(page());

  await waitFor(() => expect(screen.queryByTestId("team-invite-sheet")).toBeNull());
});

test("die Anmeldung lädt erst nach der Seite: kein zweiter Aufbau der Teamseite", async () => {
  authState.user = undefined;
  serve();
  const page = () => (
    <MemoryRouter initialEntries={["/teams/t-1"]}>
      <Routes><Route path="/teams/:id" element={<TeamsPage />} /></Routes>
    </MemoryRouter>
  );
  const view = render(page());
  const upcoming = await screen.findByTestId("team-upcoming");
  const loads = apiMock.get.mock.calls.filter(([url]) => url === "/teams/t-1").length;

  authState.user = { id: "u-cap", username: "neonfalke" };
  view.rerender(page());

  expect(await screen.findByTestId("team-chat")).toBeInTheDocument();
  expect(upcoming.isConnected).toBe(true);
  expect(apiMock.get.mock.calls.filter(([url]) => url === "/teams/t-1")).toHaveLength(loads);
});

// Verwaltung nur mit bestätigter Zwei-Faktor-Anmeldung (#1479): was eine Admin-Rolle am fremden Team darf, sagt der
// Server (`can_manage`, `can_remove_members`, `can_dissolve`). Fehlt nur die Zwei-Faktor-Anmeldung, steht statt der
// Knöpfe „2FA einrichten“ da - mit dem Weg zurück zum Team.
const FOREIGN = { ...TEAM, is_member: false, can_manage: false, can_remove_members: false, can_dissolve: false, admin_needs_second_factor: false };

describe("Admin-Rollen am fremden Team (#1479)", () => {
  afterEach(() => { authState.isAdmin = false; });

  test("Club-Admin ohne Zwei-Faktor: keine Verwaltungs-Knöpfe, dafür „2FA einrichten“", async () => {
    authState.user = { id: "u-admin", username: "clubadmin", role: "club_admin", mfa_enabled: true, auth_mfa_verified: false };
    authState.isAdmin = true;
    serve({ ...FOREIGN, admin_needs_second_factor: true });
    renderAt("/teams/t-1");
    const hint = await screen.findByTestId("team-mfa-setup");
    expect(hint).toHaveTextContent("2FA einrichten");
    expect(hint).toHaveAttribute("href", "/profile?tab=security&mfa=required&next=%2Fteams%2Ft-1");
    expect(screen.queryByTestId("team-edit-open")).toBeNull();
    expect(screen.queryByTestId("team-invite-open")).toBeNull();
    expect(screen.queryByTestId("team-manage-members")).toBeNull();
  });

  test("Club-Admin mit Zwei-Faktor: Bearbeiten, Mitglieder entfernen und Auflösen - kein Hinweis", async () => {
    authState.user = { id: "u-admin", username: "clubadmin", role: "club_admin", mfa_enabled: true, auth_mfa_verified: true };
    authState.isAdmin = true;
    serve({ ...FOREIGN, can_manage: true, can_remove_members: true, can_dissolve: true }, {
      "/teams/t-1/dissolve-preview": { member_count: 3, chat_messages: 0, withdraw: [], blocked: [], can_dissolve: true },
    });
    renderAt("/teams/t-1");
    expect(await screen.findByTestId("team-edit-open")).toBeInTheDocument();
    expect(screen.queryByTestId("team-mfa-setup")).toBeNull();
    expect(screen.getByTestId("team-kick-u-3")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("team-edit-open"));
    expect(await screen.findByTestId("team-dissolve")).toBeInTheDocument();
  });

  test("Turnierleitung mit Zwei-Faktor: bearbeiten ja, Mitglieder entfernen und Auflösen nicht", async () => {
    authState.user = { id: "u-lead", username: "turnierleitung", role: "tournament_admin", mfa_enabled: true, auth_mfa_verified: true };
    authState.isAdmin = true;
    serve({ ...FOREIGN, can_manage: true });
    renderAt("/teams/t-1");
    fireEvent.click(await screen.findByTestId("team-edit-open"));
    await screen.findByTestId("team-edit-sheet");
    expect(screen.queryByTestId("team-kick-u-3")).toBeNull();
    expect(screen.queryByTestId("team-dissolve")).toBeNull();
  });

  test("Besucher und Spieler: keine Knöpfe und kein Hinweis", async () => {
    authState.user = { id: "u-9", username: "kiwikomet", role: "player" };
    serve(FOREIGN);
    renderAt("/teams/t-1");
    await screen.findByTestId("team-header-actions");
    expect(screen.queryByTestId("team-edit-open")).toBeNull();
    expect(screen.queryByTestId("team-mfa-setup")).toBeNull();
  });
});

// Team-Liste (#984): „KEINE TEAMS“ nur nach einer erfolgreichen, leeren Antwort - nie beim Laden oder nach einem Fehler.
function renderList() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <Routes>
        <Route path="/teams" element={<TeamsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const serverError = () => Object.assign(new Error("boom"), { response: { status: 500, data: {} } });

test("Team-Liste: ein Serverfehler zeigt den Fehler mit „Nochmal versuchen“ statt „KEINE TEAMS“", async () => {
  authState.user = null;
  serve(TEAM, { "/teams?limit=90": serverError(), "/teams/levels": { levels: {}, crowns: {} } });
  renderList();
  expect(await screen.findByTestId("public-error-state")).toHaveTextContent("Teams konnten nicht geladen werden");
  expect(screen.queryByText("KEINE TEAMS")).toBeNull();
  serve(TEAM, { "/teams?limit=90": [TEAM], "/teams/levels": { levels: {}, crowns: {} } });
  fireEvent.click(screen.getByTestId("public-error-retry"));
  expect(await screen.findByTestId("team-card-LRK")).toBeInTheDocument();
});

test("Team-Liste: erfolgreich leer heißt „KEINE TEAMS“; beim Laden steht es nicht da", async () => {
  authState.user = null;
  let release;
  apiMock.get.mockImplementation((url) => (url === "/teams?limit=90"
    ? new Promise((resolve) => { release = () => resolve({ data: [] }); })
    : Promise.resolve({ data: { levels: {}, crowns: {} } })));
  renderList();
  expect(screen.queryByText("KEINE TEAMS")).toBeNull();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  await act(async () => release());
  expect(await screen.findByText("KEINE TEAMS")).toBeInTheDocument();
});

test("Team-Liste: ohne Level bleiben die Teams stehen; ein gescheitertes Nachladen lässt die Liste stehen", async () => {
  authState.user = null;
  serve(TEAM, { "/teams?limit=90": [TEAM], "/teams/levels": serverError() });
  renderList();
  expect(await screen.findByTestId("team-card-LRK")).toBeInTheDocument();
  serve(TEAM, { "/teams?limit=90": serverError() });
  await act(async () => { await invalidation.reload(); });
  expect(screen.getByTestId("team-card-LRK")).toBeInTheDocument();
  expect(screen.getByTestId("load-stale")).toBeInTheDocument();
});

test("Team-Seite: ein gescheitertes Nachladen lässt das Team stehen und sagt es (#983)", async () => {
  serve(TEAM);
  renderAt("/teams/t-1");
  expect(await screen.findByText("Lions Rocket")).toBeInTheDocument();
  serve(TEAM, { "/teams/t-1": serverError() });
  await act(async () => { await invalidation.reload(); });
  expect(screen.getByText("Lions Rocket")).toBeInTheDocument();
  expect(screen.getByTestId("load-stale")).toBeInTheDocument();
  expect(screen.queryByTestId("public-error-state")).toBeNull();
});

// Nach Codex-Prüfung: Level und Übersicht sind Zusatzdaten - sie halten weder die Liste noch die Team-Seite auf, und
// ein Ausfall zeigt sich nur an ihrem Bereich.
function pending() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("Team-Liste: die Teams stehen sofort, die Level kommen nach; ein Level-Fehler bleibt im Level-Bereich", async () => {
  authState.user = null;
  const levels = pending();
  apiMock.get.mockImplementation((url) => (url === "/teams/levels" ? levels.promise : Promise.resolve({ data: [TEAM] })));
  renderList();
  expect(await screen.findByTestId("team-card-LRK")).toBeInTheDocument();
  expect(screen.queryByTestId("team-level-chip-LRK")).toBeNull();
  await act(async () => levels.reject(serverError()));
  expect(screen.getByTestId("team-card-LRK")).toBeInTheDocument();
  expect(screen.getByTestId("teams-levels-error")).toBeInTheDocument();
  expect(screen.queryByTestId("public-error-state")).toBeNull();
});

test("Team-Liste: Level kommen nach und erscheinen an der Karte", async () => {
  authState.user = null;
  const levels = pending();
  apiMock.get.mockImplementation((url) => (url === "/teams/levels" ? levels.promise : Promise.resolve({ data: [TEAM] })));
  renderList();
  await screen.findByTestId("team-card-LRK");
  await act(async () => levels.resolve({ data: { levels: { "t-1": { level: 3, points: 120 } }, crowns: {} } }));
  expect(await screen.findByTestId("team-level-chip-LRK")).toHaveTextContent("LVL 3");
});

test("Team-Seite: das Team steht sofort, Level und Übersicht laden unabhängig; Ausfälle nur an ihrem Bereich", async () => {
  const level = pending();
  const overview = pending();
  apiMock.get.mockImplementation((url) => {
    if (url === "/teams/t-1") return Promise.resolve({ data: TEAM });
    if (url === "/teams/t-1/level") return level.promise;
    if (url === "/teams/t-1/overview") return overview.promise;
    return Promise.resolve({ data: [] });
  });
  renderAt("/teams/t-1");
  expect(await screen.findByText("Lions Rocket")).toBeInTheDocument();
  await act(async () => overview.reject(serverError()));
  expect(screen.getByTestId("team-overview-error")).toBeInTheDocument();
  await act(async () => level.resolve({ data: { level: 4, points: 200, achievements: [] } }));
  expect(await screen.findByTestId("team-level-panel")).toBeInTheDocument();
  expect(screen.queryByTestId("team-level-error")).toBeNull();
  expect(screen.queryByTestId("public-error-state")).toBeNull();
});
