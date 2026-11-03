import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Ausrüstungs-Bibliothek (#2218): Kategorien mit Art, Einträge mit Bild, Suche, Zustand, Aufsatz zu Waffe, archivieren statt löschen.
// Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/tls/ImageUpload", () => ({
  ImageUpload: ({ value, onChange, testId }) => <input data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} />,
}));

const { default: AdminGameEquipmentPage } = await import("./AdminGameEquipmentPage");

const BODY = {
  game: { id: "g1", name: "Probe Shooter", modes: [] },
  limit: 1000,
  categories_limit: 20,
  suggested_categories: [{ label: "Waffen", role: "weapon" }, { label: "Aufsätze", role: "attachment" }],
  categories: [
    { key: "waffen", label: "Waffen", role: "weapon", count: 2 },
    { key: "aufsaetze", label: "Aufsätze", role: "attachment", count: 2 },
    { key: "perks", label: "Perks", role: "item", count: 1 },
  ],
  items: [
    { id: "w1", category: "waffen", name: "Blitz 9", image_url: "/api/static/uploads/blitz.webp", status: "active", in_lists: 2, weapon_ids: [] },
    { id: "w2", category: "waffen", name: "Donner 4", image_url: null, status: "inactive", in_lists: 0, weapon_ids: [] },
    { id: "a1", category: "aufsaetze", name: "Rotpunkt", status: "active", in_lists: 0, weapon_ids: ["w1"] },
    { id: "a2", category: "aufsaetze", name: "Griff", status: "archived", in_lists: 1, weapon_ids: [] },
    { id: "p1", category: "perks", name: "Leise Sohlen mit einem sehr langen Namen, der umbrechen muss", status: "active", in_lists: 0, weapon_ids: [] },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: BODY });
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockResolvedValue({ data: {} });
  apiMock.put.mockResolvedValue({ data: { categories: [] } });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/games/g1/equipment"]}>
      <Routes><Route path="/admin/games/:gameId/equipment" element={<AdminGameEquipmentPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("je Kategorie die Einträge mit Zustand, Sperrlisten und bei Aufsätzen den Waffen", async () => {
  renderPage();
  expect(await screen.findByTestId("equipment-title")).toHaveTextContent("Ausrüstung · Probe Shooter");
  const weapons = screen.getByTestId("equipment-group-waffen");
  expect(within(weapons).getByTestId("equipment-row-w1")).toHaveTextContent("auf 2 Sperrlisten");
  expect(within(weapons).getByTestId("equipment-row-w2")).toHaveTextContent("Inaktiv · auf keiner Sperrliste");
  expect(screen.getByTestId("equipment-row-a1")).toHaveTextContent("passt zu Blitz 9");
  expect(screen.queryByTestId("equipment-row-a2")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("equipment-show-archived"));
  expect(screen.getByTestId("equipment-row-a2")).toHaveTextContent("Archiviert · auf 1 Sperrliste");
  expect(screen.getByTestId("equipment-row-a2")).toHaveTextContent("passt zu jeder Waffe");
  // Auf einer Sperrliste: archivieren statt löschen.
  expect(screen.getByTestId("equipment-delete-w1")).toBeDisabled();
  expect(screen.getByTestId("equipment-delete-p1")).not.toBeDisabled();
});

test("Suche und Kategorie grenzen ein", async () => {
  renderPage();
  fireEvent.change(await screen.findByTestId("equipment-search"), { target: { value: "blitz" } });
  expect(screen.getByTestId("equipment-row-w1")).toBeInTheDocument();
  expect(screen.queryByTestId("equipment-row-w2")).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId("equipment-search"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("equipment-filter-perks"));
  expect(screen.queryByTestId("equipment-group-waffen")).not.toBeInTheDocument();
  expect(screen.getByTestId("equipment-group-perks")).toBeInTheDocument();
});

test("ein Aufsatz wird mit Kategorie, Bild und Waffen angelegt", async () => {
  renderPage();
  fireEvent.click(await screen.findByTestId("equipment-add-aufsaetze"));
  const sheet = screen.getByTestId("equipment-sheet");
  fireEvent.change(within(sheet).getByTestId("equipment-name"), { target: { value: "  Laser  " } });
  fireEvent.change(within(sheet).getByTestId("equipment-image"), { target: { value: "/api/static/uploads/laser.png" } });
  expect(within(sheet).getByTestId("equipment-weapons")).toHaveTextContent("passt zu jeder Waffe");
  fireEvent.click(within(sheet).getByLabelText(/Donner 4/));
  fireEvent.click(within(sheet).getByTestId("equipment-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/equipment", {
    category: "aufsaetze", name: "Laser", image_url: "/api/static/uploads/laser.png", note: null, weapon_ids: ["w2"] }));
});

test("bearbeiten ändert keine Kategorie, deaktivieren und archivieren setzen den Zustand", async () => {
  renderPage();
  fireEvent.click(await screen.findByTestId("equipment-edit-w1"));
  const sheet = screen.getByTestId("equipment-sheet");
  expect(within(sheet).getByTestId("equipment-category-fixed")).toBeDisabled();
  fireEvent.change(within(sheet).getByTestId("equipment-name"), { target: { value: "Blitz X" } });
  fireEvent.click(within(sheet).getByTestId("equipment-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/equipment/w1", {
    name: "Blitz X", image_url: "/api/static/uploads/blitz.webp", note: null }));
  fireEvent.click(screen.getByTestId("equipment-toggle-w2"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/equipment/w2", { status: "active" }));
  fireEvent.click(screen.getByTestId("equipment-archive-p1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/equipment/p1", { status: "archived" }));
  fireEvent.click(screen.getByTestId("equipment-delete-p1"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/games/g1/equipment/p1"));
});

test("ohne Kategorien gibt es den Vorschlag, gespeichert wird erst auf Knopfdruck", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, categories: [], items: [] } });
  renderPage();
  expect(await screen.findByTestId("equipment-no-categories")).toBeInTheDocument();
  expect(screen.getByTestId("equipment-add")).toBeDisabled();
  fireEvent.click(screen.getByTestId("equipment-categories-start"));
  const sheet = screen.getByTestId("equipment-categories-sheet");
  expect(within(sheet).getByTestId("equipment-categories-suggested")).toBeInTheDocument();
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.click(within(sheet).getByTestId("equipment-category-add"));
  const rows = within(sheet).getAllByTestId("equipment-category-row");
  fireEvent.change(within(rows[2]).getByLabelText("Name der Kategorie 3"), { target: { value: "Abschussserien" } });
  fireEvent.click(within(sheet).getByTestId("equipment-categories-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/games/g1/equipment/categories", { categories: [
    { label: "Waffen", role: "weapon" }, { label: "Aufsätze", role: "attachment" }, { label: "Abschussserien", role: "item" }] }));
});

test("eine Kategorie mit Einträgen behält ihre Art und lässt sich nicht entfernen", async () => {
  renderPage();
  fireEvent.click(await screen.findByTestId("equipment-categories"));
  const sheet = screen.getByTestId("equipment-categories-sheet");
  expect(within(sheet).getByLabelText("Art der Kategorie 1")).toBeDisabled();
  expect(within(sheet).getByLabelText("Waffen entfernen")).toBeDisabled();
});
