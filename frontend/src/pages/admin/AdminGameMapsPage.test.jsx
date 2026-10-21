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
  fireEvent.click(within(sheet).getByTestId("game-map-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/maps", {
    name: "Sturmdeck", slug: null, image_url: "/api/static/uploads/sturm.webp", modes: ["snd"], note: null, external_ref: null,
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
