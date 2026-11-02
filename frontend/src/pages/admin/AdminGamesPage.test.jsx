import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Spiele (#435): „Spiel bearbeiten“ öffnet ein Seitenblatt statt eines Fensters; Speichern
// schickt das Spiel mit Slug und schließt das Blatt.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminGamesPage, inheritedServerText, roleNamePlaceholder, serverOptionLabel } = await import("./AdminGamesPage");

const GAMES = [
  { id: "g1", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8", kind: "standalone", platforms: ["Switch"], supports_solo: true, supports_teams: false },
];

const SERVERS = [
  { guild_id: "1", name: "LION", role: "main", enabled: true, left: false },
  { guild_id: "2", name: "Rocket League", role: "sub", enabled: true, left: false },
  { guild_id: "3", name: "Alt", role: "sub", enabled: false, left: false },
  { guild_id: "4", name: "Weg", role: "sub", enabled: false, left: true },
];

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/games/discord-servers" ? [] : GAMES }));
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: GAMES[0] });
});

test("Discord-Server (#626): erben in Worten, ausgeschaltet und verlassen gekennzeichnet", () => {
  const games = [{ id: "p", name: "Rocket League", discord_guild_id: "2" }, { id: "q", name: "EA FC", discord_guild_id: "3" }];
  expect(inheritedServerText({ kind: "edition", parent_game_id: "p" }, games, SERVERS)).toBe("geerbt von Rocket League: Rocket League");
  expect(inheritedServerText({ kind: "edition", parent_game_id: "q" }, games, SERVERS)).toBe("Hauptserver: LION");
  expect(inheritedServerText({ kind: "standalone", parent_game_id: "p" }, games, SERVERS)).toBe("Hauptserver: LION");
  expect(serverOptionLabel(SERVERS[0])).toBe("LION (Hauptserver)");
  expect(serverOptionLabel(SERVERS[2])).toBe("Alt – ausgeschaltet");
  expect(serverOptionLabel(SERVERS[3])).toBe("Weg – Bot nicht mehr dort");
});

test("Discord-Server wählen: Auswahl aus dem Verzeichnis, Speichern schickt die Zuordnung; leer heißt erben", async () => {
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/games/discord-servers" ? SERVERS : [{ ...GAMES[0], discord_guild_id: "3" }] }));
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  expect(await screen.findByTestId("game-discord-mario-kart-8")).toHaveTextContent("Discord: Alt");
  fireEvent.click(screen.getByTestId("game-edit-mario-kart-8"));
  const select = screen.getByTestId("game-edit-discord");
  expect(select).toHaveValue("3");
  expect(screen.getByTestId("game-edit-discord-off")).toHaveTextContent("ausgeschaltet – bis dahin gilt: Hauptserver: LION");
  expect([...select.options].map((option) => option.value)).toEqual(["", "1", "2", "3"]);
  fireEvent.change(select, { target: { value: "2" } });
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ discord_guild_id: "2" })));

  fireEvent.click(await screen.findByTestId("game-edit-mario-kart-8"));
  fireEvent.change(screen.getByTestId("game-edit-discord"), { target: { value: "" } });
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/games/g1", expect.objectContaining({ discord_guild_id: null })));
});

// Map-Bibliothek (#1616): je Spiel ein Weg zu seinen Maps.
test("jedes Spiel führt zu seiner Map-Bibliothek", async () => {
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  expect(await screen.findByTestId("game-maps-mario-kart-8")).toHaveAttribute("href", "/admin/games/g1/maps");
});

test("Bearbeiten öffnet das Seitenblatt mit den Werten; Speichern schickt das Spiel und schließt es", async () => {
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  expect(await screen.findByTestId("game-edit-mario-kart-8")).toBeInTheDocument();
  expect(screen.queryByTestId("game-sheet")).toBeNull();

  fireEvent.click(screen.getByTestId("game-edit-mario-kart-8"));
  expect(screen.getByRole("dialog", { name: "Spiel bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("game-edit-name")).toHaveValue("Mario Kart 8 Deluxe");
  // Standardformat, Teamgröße und die Haken Solo/Teams/… wirkten nirgends (#2111, W1) - sie sind weg und gehen nicht mit.
  expect(screen.queryByTestId("game-edit-format")).toBeNull();
  expect(screen.queryByTestId("game-edit-team-size")).toBeNull();
  expect(screen.queryByText("Zeitfahren")).toBeNull();
  expect(screen.queryByTestId("game-edit-discord")).toBeNull();
  // Genre und Plattformen zeigte nichts an (#2129, SP5): raus aus dem Formular; was gespeichert ist, bleibt unangetastet.
  expect(screen.queryByTestId("game-edit-genre")).toBeNull();
  expect(screen.queryByTestId("game-edit-platforms")).toBeNull();
  expect(screen.queryByTestId("game-genre")).toBeNull();
  expect(screen.queryByTestId("game-platforms")).toBeNull();

  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ slug: "mario-kart-8" })));
  const body = apiMock.patch.mock.calls[0][1];
  for (const key of ["supports_solo", "supports_teams", "default_team_size", "default_format", "genre", "platforms"]) expect(body).not.toHaveProperty(key);
  await waitFor(() => expect(screen.queryByTestId("game-sheet")).toBeNull());
});

// Spiel-Rolle im Discord (#629): je Hauptspiel ein Name, leer heißt „<Kurzname>-Spieler“; Editionen haben keine eigene.
test("Discord-Rolle: Vorgabe in Worten, Speichern schickt den Namen, leer heißt Vorgabe", async () => {
  expect(roleNamePlaceholder({ name: "Call of Duty", short_name: "CoD" })).toBe("Discord-Rolle (leer: „CoD-Spieler“)");
  expect(roleNamePlaceholder({ name: "Rocket League", short_name: "" })).toBe("Discord-Rolle (leer: „Rocket League-Spieler“)");
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("game-edit-mario-kart-8"));
  fireEvent.change(screen.getByTestId("game-edit-role"), { target: { value: "  MK-Crew " } });
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ discord_role_name: "MK-Crew" })));

  fireEvent.click(await screen.findByTestId("game-edit-mario-kart-8"));
  fireEvent.change(screen.getByTestId("game-edit-role"), { target: { value: "" } });
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/games/g1", expect.objectContaining({ discord_role_name: null })));
  fireEvent.change(screen.getByTestId("game-kind"), { target: { value: "edition" } });
  expect(screen.queryByTestId("game-role")).toBeNull();
});

// Spiel-Daten für Turniere (#1554): Dauer je Modus, Spieler je Lauf, Geräte, Aufbauzeit, Punktetabelle, Best-of.
test("ein altes Spiel ohne Spiel-Daten: leere Modus-Liste mit Hinweis, Speichern schickt „keine Vorgabe“", async () => {
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("game-edit-mario-kart-8"));
  expect(screen.getByTestId("game-edit-match-data")).toHaveTextContent("Für Turniere");
  expect(screen.getByTestId("game-edit-modes-empty")).toHaveTextContent("Noch kein Modus");
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({
    match_modes: [], station_devices: [], points_table: [], players_per_run_local: null, setup_minutes: null, default_best_of: null,
  })));
});

test("Modi, Laufgröße, Geräte, Aufbauzeit, Punkte und Best-of gehen beim Speichern mit", async () => {
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("game-edit-mario-kart-8"));
  fireEvent.click(screen.getByTestId("game-edit-mode-add"));
  fireEvent.change(screen.getByTestId("game-edit-mode-label-0"), { target: { value: "Grand Prix 4 Rennen" } });
  fireEvent.change(screen.getByTestId("game-edit-mode-minutes-0"), { target: { value: "12" } });
  fireEvent.click(screen.getByTestId("game-edit-mode-add"));
  fireEvent.change(screen.getByTestId("game-edit-mode-label-1"), { target: { value: "Einzelrennen" } });
  fireEvent.change(screen.getByTestId("game-edit-mode-minutes-1"), { target: { value: "4" } });
  fireEvent.click(screen.getByTestId("game-edit-mode-per-game-1"));
  fireEvent.change(screen.getByTestId("game-edit-run-local"), { target: { value: "4" } });
  fireEvent.change(screen.getByTestId("game-edit-run-online"), { target: { value: "12" } });
  fireEvent.click(screen.getByTestId("game-edit-device-switch"));
  fireEvent.change(screen.getByTestId("game-edit-setup"), { target: { value: "3" } });
  fireEvent.change(screen.getByTestId("game-edit-points"), { target: { value: "15-12-10-9" } });
  expect(screen.getByTestId("game-edit-points-preview")).toHaveTextContent("4 Plätze");
  fireEvent.change(screen.getByTestId("game-edit-best-of"), { target: { value: "3" } });
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({
    match_modes: [
      { label: "Grand Prix 4 Rennen", minutes: 12, per_game: false },
      { label: "Einzelrennen", minutes: 4, per_game: true },
    ],
    players_per_run_local: 4, players_per_run_online: 12, station_devices: ["switch"], setup_minutes: 3,
    points_table: [15, 12, 10, 9], default_best_of: 3,
  })));
});

test("eine kaputte Punktetabelle wird genannt und nicht gespeichert", async () => {
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("game-edit-mario-kart-8"));
  fireEvent.change(screen.getByTestId("game-edit-points"), { target: { value: "15, zwölf" } });
  expect(screen.getByTestId("game-edit-points-error")).toHaveTextContent("„zwölf“ ist keine ganze Zahl.");
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(apiMock.patch).not.toHaveBeenCalled();
});

// Archivieren statt löschen (#2129, SP1).
describe("Spiele archivieren", () => {
  const withUsage = (usage, games = GAMES) => apiMock.get.mockImplementation(async (url) => {
    if (url === "/games/discord-servers") return { data: [] };
    if (url.endsWith("/usage")) return { data: usage };
    return { data: games };
  });

  beforeEach(() => {
    apiMock.delete.mockReset();
    apiMock.delete.mockResolvedValue({ data: { ok: true } });
    confirmMock.mockClear();
  });

  test("ein verwendetes Spiel: der Dialog nennt die Zählung und archiviert statt zu löschen", async () => {
    withUsage({ total: 3, text: "2 Turniere, 1 Map" });
    render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("game-delete-mario-kart-8"));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining("2 Turniere, 1 Map"), confirmLabel: "Archivieren",
    })));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", { status: "archived" }));
    expect(apiMock.delete).not.toHaveBeenCalled();
  });

  test("ein unbenutztes Spiel wird nach Rückfrage gelöscht", async () => {
    withUsage({ total: 0, text: "" });
    render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("game-delete-mario-kart-8"));
    await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/games/g1"));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Löschen" }));
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  test("Archivierte sind ausgeblendet, lassen sich zeigen und zurückholen und stehen nicht zur Wahl", async () => {
    const archived = { id: "g2", name: "Altspiel", slug: "altspiel", kind: "series", status: "archived" };
    withUsage({ total: 0 }, [GAMES[0], archived]);
    render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
    await screen.findByTestId("game-edit-mario-kart-8");
    expect(screen.queryByTestId("game-edit-altspiel")).toBeNull();

    fireEvent.change(screen.getByTestId("game-kind"), { target: { value: "edition" } });
    expect([...screen.getByTestId("game-parent").options].map((option) => option.value)).not.toContain("g2");

    fireEvent.click(screen.getByTestId("games-show-archived"));
    expect(screen.getByTestId("game-archived-altspiel")).toHaveTextContent("Archiviert");
    fireEvent.click(screen.getByTestId("game-archive-altspiel"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g2", { status: "active" }));
  });
});

test("ein Modus lässt sich wieder entfernen", async () => {
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/games/discord-servers" ? [] : [{ ...GAMES[0], match_modes: [{ mode: "gp4", label: "Grand Prix", minutes: 12 }] }] }));
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("game-edit-mario-kart-8"));
  expect(screen.getByTestId("game-edit-mode-label-0")).toHaveValue("Grand Prix");
  fireEvent.click(screen.getByTestId("game-edit-mode-remove-0"));
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ match_modes: [] })));
});
