import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Spiele (#435): „Spiel bearbeiten“ öffnet ein Seitenblatt statt eines Fensters; Speichern
// schickt das Spiel mit Slug und Plattformen und schließt das Blatt.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
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

test("Bearbeiten öffnet das Seitenblatt mit den Werten; Speichern schickt das Spiel und schließt es", async () => {
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>);
  expect(await screen.findByTestId("game-edit-mario-kart-8")).toBeInTheDocument();
  expect(screen.queryByTestId("game-sheet")).toBeNull();

  fireEvent.click(screen.getByTestId("game-edit-mario-kart-8"));
  expect(screen.getByRole("dialog", { name: "Spiel bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("game-edit-name")).toHaveValue("Mario Kart 8 Deluxe");
  expect(screen.getByTestId("game-edit-platforms")).toHaveValue("Switch");
  expect(screen.getByTestId("game-edit-format")).toHaveValue("single_elim");
  expect(screen.queryByTestId("game-edit-discord")).toBeNull();

  fireEvent.change(screen.getByTestId("game-edit-platforms"), { target: { value: "Switch, Switch 2" } });
  fireEvent.submit(screen.getByTestId("game-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ slug: "mario-kart-8", platforms: ["Switch", "Switch 2"] })));
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
