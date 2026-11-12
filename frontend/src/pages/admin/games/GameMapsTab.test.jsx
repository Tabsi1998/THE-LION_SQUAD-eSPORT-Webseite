import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Reiter Maps der Spielseite (#2249, vorher eigene Map-Seite aus #1616): Tabelle Map × Modus, ein Häkchen gibt frei und speichert
// sofort; Zustand, Bild, Pool-Zählung, Reihenfolge, anlegen und bearbeiten im Seitenblatt, archivieren statt löschen, sobald eine
// Map in einem Pool stand. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/tls/ImageUpload", () => ({
  ImageUpload: ({ value, onChange, testId }) => <input data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} />,
}));

const { GameMapsTab, matrixModes, toggledModes } = await import("./GameMapsTab");

const MODES = [{ mode: "stellung", label: "Stellung" }, { mode: "snd", label: "Suchen & Zerstören" }];
const BODY = {
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: MODES },
  limit: 200,
  maps: [
    { id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: "/api/static/uploads/hafen.webp", modes: ["stellung", "snd"], status: "active", in_pools: 2, order: 1 },
    { id: "nebel", slug: "nebelwerk", name: "Nebelwerk", image_url: null, modes: [], status: "active", in_pools: 0, order: 2 },
    { id: "glut", slug: "glutsenke", name: "Glutsenke", image_url: null, modes: ["snd"], status: "archived", in_pools: 1, order: 3 },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  apiMock.get.mockResolvedValue({ data: BODY });
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockResolvedValue({ data: {} });
  apiMock.put.mockResolvedValue({ data: { maps: [] } });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
});

function renderTab(props = {}) {
  return render(<MemoryRouter><GameMapsTab gameId="g1" {...props} /></MemoryRouter>);
}

test("Spalten: alle Modi außer archivierten, die keine Map mehr hat; Umschalten kennt nur Modi des Spiels", () => {
  const modes = [...MODES, { mode: "alt", label: "Alt", status: "archived" }, { mode: "jagd", label: "Jagd", status: "inactive" }];
  expect(matrixModes(modes, BODY.maps).map(({ mode }) => mode)).toEqual(["stellung", "snd", "jagd"]);
  expect(matrixModes(modes, [{ modes: ["alt"] }]).map(({ mode }) => mode)).toEqual(["stellung", "snd", "alt", "jagd"]);
  expect(toggledModes({ modes: ["stellung", "weg"] }, "snd", ["stellung", "snd"])).toEqual(["stellung", "snd"]);
  expect(toggledModes({ modes: ["stellung", "snd"] }, "stellung", ["stellung", "snd"])).toEqual(["snd"]);
});

test("Tabelle Map × Modus: Häkchen = freigegeben, Zustand und Pool-Zählung, archivierte erst auf Wunsch", async () => {
  const { container } = renderTab();
  const rows = await screen.findAllByTestId(/^game-map-row-/);
  expect(apiMock.get).toHaveBeenCalledWith("/games/g1/maps");
  expect(rows.map((row) => row.dataset.slug)).toEqual(["hafenkante", "nebelwerk"]);
  expect(screen.getByRole("checkbox", { name: "Hafenkante in Stellung freigeben" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Nebelwerk in Suchen & Zerstören freigeben" })).not.toBeChecked();
  expect(screen.getByTestId("game-maps-mode-snd")).toHaveTextContent("1 Map");
  expect(screen.getByTestId("game-map-state-hafenkante")).toHaveTextContent("Aktiv");
  expect(screen.getByTestId("game-map-state-hafenkante")).toHaveTextContent("in 2 Pools");
  expect(container.querySelector("img")).toHaveAttribute("sizes", "64px");
  // In einem Pool gespeichert: nur archivieren, nicht löschen.
  expect(screen.getByTestId("game-map-delete-hafenkante")).toBeDisabled();
  expect(screen.getByTestId("game-map-delete-nebelwerk")).toBeEnabled();

  fireEvent.click(screen.getByTestId("game-maps-show-archived"));
  expect(screen.getByTestId("game-map-state-glutsenke")).toHaveTextContent("Archiviert");
  expect(screen.getByTestId("game-map-mode-glutsenke-snd")).toBeDisabled();
});

test("ein Häkchen gibt die Map in diesem Modus frei und speichert sofort", async () => {
  renderTab();
  const box = await screen.findByRole("checkbox", { name: "Nebelwerk in Stellung freigeben" });
  fireEvent.click(box);
  expect(box).toBeChecked();
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/nebel", { modes: ["stellung"] }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Nebelwerk: in Stellung freigegeben."));
  fireEvent.click(screen.getByRole("checkbox", { name: "Hafenkante in Suchen & Zerstören freigeben" }));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/hafen", { modes: ["stellung"] }));
});

test("lehnt der Server ab, steht wieder der gespeicherte Stand da", async () => {
  apiMock.patch.mockRejectedValue({ response: { data: { detail: "Der Modus ist archiviert." } } });
  renderTab();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Nebelwerk in Stellung freigeben" }));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Der Modus ist archiviert."));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Nebelwerk in Stellung freigeben" })).not.toBeChecked());
});

test("ein Modus, den das Spiel nicht mehr hat: keine Spalte, keine rohe Kennung, das Umschalten scheitert nicht daran", async () => {
  const maps = [{ ...BODY.maps[0], modes: ["stellung", "alter_modus"] }, { ...BODY.maps[1], modes: ["alter_modus"] }];
  apiMock.get.mockResolvedValue({ data: { ...BODY, maps } });
  renderTab();
  const row = await screen.findByTestId("game-map-row-hafenkante");
  expect(row).not.toHaveTextContent("alter_modus");
  expect(await screen.findByTestId("game-maps-without-mode")).toHaveTextContent("Nebelwerk");
  fireEvent.click(screen.getByRole("checkbox", { name: "Hafenkante in Suchen & Zerstören freigeben" }));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/hafen", { modes: ["stellung", "snd"] }));
});

// #2129, SP3: Der Standard-Pool wird bei den Maps gepflegt.
test("Standard-Pool speichern und entfernen", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, default_pool: { id: "d1", version: 2, origin: "game_default", stale: false, outdated_map_ids: [],
    modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "hafen", name: "Hafenkante" }] }] } } });
  renderTab();
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

// #2129, SP2: Maps ohne Modus werden benannt und lassen sich gesammelt zuordnen.
describe("Maps ohne Modus", () => {
  test("der Hinweis nennt sie, ein Klick ordnet sie allen gewählten Modi zu", async () => {
    apiMock.post.mockResolvedValue({ data: { updated: 1 } });
    renderTab();
    const notice = await screen.findByTestId("game-maps-without-mode");
    expect(notice).toHaveTextContent("Diese Maps haben noch keinen Modus");
    expect(notice).toHaveTextContent("Nebelwerk");
    expect(notice).not.toHaveTextContent("Glutsenke");
    fireEvent.click(within(notice).getByTestId("game-maps-assign-stellung"));
    fireEvent.click(within(notice).getByTestId("game-maps-assign"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/maps/assign-modes", { modes: ["snd"] }));
  });

  test("ohne gewählten Modus geht es nicht; ein Spiel ohne Modi braucht den Hinweis nicht, sagt aber, wo Modi entstehen", async () => {
    const { unmount } = renderTab();
    const notice = await screen.findByTestId("game-maps-without-mode");
    fireEvent.click(within(notice).getByTestId("game-maps-assign-stellung"));
    fireEvent.click(within(notice).getByTestId("game-maps-assign-snd"));
    expect(within(notice).getByTestId("game-maps-assign")).toBeDisabled();
    unmount();

    apiMock.get.mockResolvedValue({ data: { ...BODY, game: { ...BODY.game, modes: [] } } });
    const onOpenModes = vi.fn();
    renderTab({ onOpenModes });
    fireEvent.click(within(await screen.findByTestId("game-maps-no-modes")).getByRole("button", { name: "Modi anlegen" }));
    expect(onOpenModes).toHaveBeenCalled();
    expect(screen.queryByTestId("game-maps-without-mode")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /in Stellung freigeben/ })).toBeNull();
  });
});

test("legt eine Map im Seitenblatt an – Name, Bild, Modi, ohne JSON", async () => {
  renderTab();
  fireEvent.click(await screen.findByTestId("game-maps-add"));
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

test("bearbeiten (ohne Modi - die stehen nur in der Tabelle), verschieben, archivieren und löschen", async () => {
  renderTab();
  fireEvent.click(await screen.findByTestId("game-map-edit-hafenkante"));
  const sheet = screen.getByRole("dialog", { name: "Map bearbeiten" });
  expect(within(sheet).queryByRole("checkbox", { name: "Stellung" })).toBeNull();
  fireEvent.change(within(sheet).getByTestId("game-map-name"), { target: { value: "Hafenkante Nacht" } });
  fireEvent.click(within(sheet).getByTestId("game-map-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/hafen", expect.objectContaining({ name: "Hafenkante Nacht" })));
  expect(apiMock.patch.mock.calls[0][1]).not.toHaveProperty("modes");

  fireEvent.click(screen.getByTestId("game-map-up-nebelwerk"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/games/g1/maps/order", { ids: ["nebel", "hafen", "glut"] }));

  fireEvent.click(screen.getByTestId("game-map-archive-hafenkante"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/maps/hafen", { status: "archived" }));

  fireEvent.click(screen.getByTestId("game-map-delete-nebelwerk"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/games/g1/maps/nebel"));
});
