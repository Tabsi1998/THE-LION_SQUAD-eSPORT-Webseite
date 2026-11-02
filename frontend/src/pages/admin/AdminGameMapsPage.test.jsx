import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Map-Bibliothek eines Spiels (#1616): Karten mit Bild, Modi und „in N Pools“; anlegen und bearbeiten im Seitenblatt
// ohne JSON, Reihenfolge per Pfeil, archivieren statt löschen, sobald eine Map in einem Pool stand. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/tls/ImageUpload", () => ({
  ImageUpload: ({ value, onChange, testId }) => <input data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} />,
}));

const { default: AdminGameMapsPage } = await import("./AdminGameMapsPage");

const BODY = {
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [{ mode: "stellung", label: "Stellung" }, { mode: "snd", label: "Suchen & Zerstören" }] },
  limit: 200,
  maps: [
    { id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: "/api/static/uploads/hafen.webp", modes: ["stellung", "snd"], status: "active", in_pools: 2, order: 1 },
    { id: "nebel", slug: "nebelwerk", name: "Nebelwerk", image_url: null, modes: [], status: "active", in_pools: 0, order: 2 },
    { id: "glut", slug: "glutsenke", name: "Glutsenke", image_url: null, modes: ["snd"], status: "archived", in_pools: 1, order: 3 },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: BODY });
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockResolvedValue({ data: {} });
  apiMock.put.mockResolvedValue({ data: { maps: [] } });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/games/g1/maps"]}>
      <Routes><Route path="/admin/games/:gameId/maps" element={<AdminGameMapsPage />} /></Routes>
    </MemoryRouter>,
  );
}

// #2129, SP3: Der Standard-Pool wird auf der Map-Seite gepflegt.
test("Standard-Pool speichern und entfernen", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, default_pool: { id: "d1", version: 2, origin: "game_default", stale: false, outdated_map_ids: [],
    modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "hafen", name: "Hafenkante" }] }] } } });
  renderPage();
  const box = await screen.findByTestId("game-default-pool-box");
  expect(box).toHaveTextContent("Standard-Pool · Version 2");
  fireEvent.click(within(box).getByRole("checkbox", { name: "Hafenkante in Stellung" }));
  fireEvent.click(within(box).getByTestId("game-default-pool-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/games/g1/default-pool", expect.objectContaining({
    expected_version: 2, modes: [{ mode: "stellung", map_ids: ["hafen"] }, { mode: "snd", map_ids: ["hafen"] }],
  })));
  fireEvent.click(within(box).getByTestId("game-default-pool-clear"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/games/g1/default-pool"));
});

// #2129, SP2: Maps ohne Modus werden benannt und lassen sich gesammelt zuordnen; ein alter Modus blockiert nichts.
describe("Maps ohne Modus", () => {
  test("der Hinweis nennt sie, ein Klick ordnet sie allen gewählten Modi zu", async () => {
    apiMock.post.mockResolvedValue({ data: { updated: 1 } });
    renderPage();
    const notice = await screen.findByTestId("game-maps-without-mode");
    expect(notice).toHaveTextContent("Diese Maps haben noch keinen Modus");
    expect(notice).toHaveTextContent("Nebelwerk");
    expect(notice).not.toHaveTextContent("Glutsenke");
    fireEvent.click(within(notice).getByTestId("game-maps-assign-stellung"));
    fireEvent.click(within(notice).getByTestId("game-maps-assign"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/maps/assign-modes", { modes: ["snd"] }));
  });

  test("ohne gewählten Modus geht es nicht; ein Spiel ohne Modi braucht den Hinweis nicht", async () => {
    const { unmount } = renderPage();
    const notice = await screen.findByTestId("game-maps-without-mode");
    fireEvent.click(within(notice).getByTestId("game-maps-assign-stellung"));
    fireEvent.click(within(notice).getByTestId("game-maps-assign-snd"));
    expect(within(notice).getByTestId("game-maps-assign")).toBeDisabled();
    unmount();

    apiMock.get.mockResolvedValue({ data: { ...BODY, game: { ...BODY.game, modes: [] } } });
    renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("game-maps-without-mode")).toBeNull();
  });

  test("ein Modus, den das Spiel nicht mehr hat: keine rohe Kennung, das Speichern scheitert nicht daran", async () => {
    const maps = [{ ...BODY.maps[0], modes: ["stellung", "alter_modus"] }, { ...BODY.maps[1], modes: ["alter_modus"] }];
    apiMock.get.mockResolvedValue({ data: { ...BODY, maps } });
    renderPage();
    const card = await screen.findByTestId("game-map-card-hafenkante");
    expect(card).not.toHaveTextContent("alter_modus");
    expect(await screen.findByTestId("game-maps-without-mode")).toHaveTextContent("Nebelwerk");

    fireEvent.click(screen.getByTestId("game-map-edit-hafenkante"));
    fireEvent.submit(screen.getByTestId("game-map-sheet"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/hafen", expect.objectContaining({ modes: ["stellung"] })));
  });
});

test("zeigt die aktiven Maps mit Modi und Pool-Zählung, archivierte erst auf Wunsch", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Maps · Probe Shooter");
  expect(apiMock.get).toHaveBeenCalledWith("/games/g1/maps");
  const cards = screen.getAllByTestId(/^game-map-card-/);
  expect(cards.map((card) => card.dataset.slug)).toEqual(["hafenkante", "nebelwerk"]);
  expect(cards[0]).toHaveTextContent("Stellung");
  expect(cards[0]).toHaveTextContent("in 2 Pools");
  expect(cards[1]).toHaveTextContent("keinem Modus zugeordnet");
  // In einem Pool gespeichert: nur archivieren, nicht löschen.
  expect(within(cards[0]).getByTestId("game-map-delete-hafenkante")).toBeDisabled();
  expect(within(cards[1]).getByTestId("game-map-delete-nebelwerk")).toBeEnabled();

  fireEvent.click(screen.getByTestId("game-maps-show-archived"));
  expect(screen.getByTestId("game-map-card-glutsenke")).toHaveTextContent("Archiviert");
});

test("legt eine Map im Seitenblatt an – Name, Bild, Modi, ohne JSON", async () => {
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  fireEvent.click(screen.getByTestId("game-maps-add"));
  const sheet = screen.getByRole("dialog", { name: "Map hinzufügen" });
  fireEvent.change(within(sheet).getByTestId("game-map-name"), { target: { value: "Sturmdeck" } });
  fireEvent.change(within(sheet).getByTestId("game-map-image"), { target: { value: "/api/static/uploads/sturm.webp" } });
  fireEvent.click(within(sheet).getByRole("checkbox", { name: "Suchen & Zerstören" }));
  // Weitere Schreibweisen (#1616 an #1931): darüber ordnet das Ergebnisblatt der Team-Liga einen Namen zu.
  fireEvent.change(within(sheet).getByTestId("game-map-aliases"), { target: { value: "Storm Deck" } });
  fireEvent.click(within(sheet).getByTestId("game-map-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/maps", {
    name: "Sturmdeck", slug: null, image_url: "/api/static/uploads/sturm.webp", modes: ["snd"], note: null, external_ref: null, aliases: ["Storm Deck"],
  }));
});

test("bearbeiten, verschieben, archivieren und löschen gehen an die passenden Adressen", async () => {
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  fireEvent.click(screen.getByTestId("game-map-edit-hafenkante"));
  const sheet = screen.getByRole("dialog", { name: "Map bearbeiten" });
  fireEvent.change(within(sheet).getByTestId("game-map-name"), { target: { value: "Hafenkante Nacht" } });
  fireEvent.click(within(sheet).getByTestId("game-map-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/hafen", expect.objectContaining({ name: "Hafenkante Nacht" })));

  fireEvent.click(screen.getByTestId("game-map-up-nebelwerk"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/games/g1/maps/order", { ids: ["nebel", "hafen", "glut"] }));

  fireEvent.click(screen.getByTestId("game-map-archive-hafenkante"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/hafen", { status: "archived" }));

  fireEvent.click(screen.getByTestId("game-map-delete-nebelwerk"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/games/g1/maps/nebel"));
});
