import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Spieleliste (#2249): je Spiel ein Zahnrad zur Spielseite, Archiv und Löschen bleiben. Neu anlegen geht schnell im
// Seitenblatt mit Name und Art, danach öffnet die Spielseite.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminGamesPage } = await import("./AdminGamesPage");

const GAMES = [
  { id: "g1", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8", kind: "standalone", match_modes: [{ mode: "gp", label: "GP" }] },
];

function renderList() {
  return render(
    <MemoryRouter initialEntries={["/admin/games"]}>
      <Routes>
        <Route path="/admin/games" element={<AdminGamesPage />} />
        <Route path="/admin/games/:gameId" element={<div data-testid="game-page">Spielseite</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/games/discord-servers" ? [] : GAMES }));
  apiMock.patch.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockResolvedValue({ data: GAMES[0] });
});

test("ein Zahnrad „Einstellungen“ statt Stift und Karte; Name und Zahnrad führen zur Spielseite", async () => {
  renderList();
  const settings = await screen.findByTestId("game-settings-mario-kart-8");
  expect(settings).toHaveAttribute("href", "/admin/games/g1");
  expect(settings).toHaveAccessibleName("Einstellungen von Mario Kart 8 Deluxe");
  expect(screen.getByTestId("game-open-mario-kart-8")).toHaveAttribute("href", "/admin/games/g1");
  expect(screen.queryByTestId("game-edit-mario-kart-8")).toBeNull();
  expect(screen.queryByTestId("game-maps-mario-kart-8")).toBeNull();
  expect(screen.getByTestId("game-archive-mario-kart-8")).toBeInTheDocument();
  expect(screen.getByTestId("game-delete-mario-kart-8")).toBeInTheDocument();
  expect(screen.getByTestId("game-row-mario-kart-8")).toHaveTextContent("Einzelspiel");
  fireEvent.click(settings);
  expect(await screen.findByTestId("game-page")).toBeInTheDocument();
});

test("Neues Spiel: Name und Art genügen, danach öffnet die Spielseite", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "g9", slug: "straßen-rennen" } });
  renderList();
  fireEvent.click(await screen.findByTestId("game-new"));
  expect(screen.getByRole("dialog", { name: "Neues Spiel" })).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("game-name"), { target: { value: "Straßen Rennen" } });
  fireEvent.submit(screen.getByTestId("game-new-sheet"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games", { name: "Straßen Rennen", slug: "strassen-rennen", kind: "standalone", parent_game_id: null }));
  expect(await screen.findByTestId("game-page")).toBeInTheDocument();
});

test("ohne Spiele sagt die Liste, wie es weitergeht", async () => {
  apiMock.get.mockImplementation(async () => ({ data: [] }));
  renderList();
  expect(await screen.findByTestId("games-empty")).toHaveTextContent("Neues Spiel");
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
    renderList();
    fireEvent.click(await screen.findByTestId("game-delete-mario-kart-8"));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining("2 Turniere, 1 Map"), confirmLabel: "Archivieren",
    })));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", { status: "archived" }));
    expect(apiMock.delete).not.toHaveBeenCalled();
  });

  test("ein unbenutztes Spiel wird nach Rückfrage gelöscht", async () => {
    withUsage({ total: 0, text: "" });
    renderList();
    fireEvent.click(await screen.findByTestId("game-delete-mario-kart-8"));
    await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/games/g1"));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Löschen" }));
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  test("Archivierte sind ausgeblendet, lassen sich zeigen und zurückholen und stehen beim Anlegen nicht zur Wahl", async () => {
    const archived = { id: "g2", name: "Altspiel", slug: "altspiel", kind: "series", status: "archived" };
    withUsage({ total: 0 }, [GAMES[0], archived]);
    renderList();
    await screen.findByTestId("game-settings-mario-kart-8");
    expect(screen.queryByTestId("game-settings-altspiel")).toBeNull();

    fireEvent.click(screen.getByTestId("game-new"));
    fireEvent.change(screen.getByTestId("game-kind"), { target: { value: "edition" } });
    expect([...screen.getByTestId("game-parent").options].map((option) => option.value)).not.toContain("g2");
    fireEvent.click(screen.getByText("Abbrechen"));

    fireEvent.click(screen.getByTestId("games-show-archived"));
    expect(screen.getByTestId("game-archived-altspiel")).toHaveTextContent("Archiviert");
    fireEvent.click(screen.getByTestId("game-archive-altspiel"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g2", { status: "active" }));
  });
});
