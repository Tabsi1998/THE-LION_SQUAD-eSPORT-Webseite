import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Ausrüstungs-Bibliothek (#2218): Kategorien mit Art, Einträge mit Bild, Suche, Zustand, Aufsatz zu Waffe, archivieren statt löschen.
// Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/tls/ImageUpload", () => ({
  ImageUpload: ({ value, onChange, testId }) => <input data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} />,
}));

const { EquipmentLibrary } = await import("./EquipmentLibrary");

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
    <MemoryRouter><EquipmentLibrary gameId="g1" /></MemoryRouter>,
  );
}

test("je Kategorie die Einträge mit Zustand, Sperrlisten und bei Aufsätzen den Waffen", async () => {
  renderPage();
  expect(await screen.findByTestId("equipment-library")).toBeInTheDocument();
  const weapons = screen.getByTestId("equipment-group-waffen");
  expect(within(weapons).getByTestId("equipment-row-w1")).toHaveTextContent("auf 2 Sperrlisten");
  expect(within(weapons).getByTestId("equipment-row-w2")).toHaveTextContent("Inaktiv · auf keiner Sperrliste");
  expect(screen.getByTestId("equipment-row-a1")).toHaveTextContent("passt zu Blitz 9");
  expect(screen.queryByTestId("equipment-row-a2")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("equipment-show-archived"));
  expect(screen.getByTestId("equipment-row-a2")).toHaveTextContent("Archiviert · auf 1 Sperrliste");
  expect(screen.getByTestId("equipment-row-a2")).toHaveTextContent("keiner Waffe zugeordnet – passt zu keiner");
  // Auf einer Sperrliste: archivieren statt löschen.
  expect(screen.getByTestId("equipment-delete-w1")).toBeDisabled();
  expect(screen.getByTestId("equipment-delete-p1")).not.toBeDisabled();
});

// Obmann, 03.11.: Ohne Waffe passt ein Aufsatz zu keiner - der Hinweis nennt ihn und ordnet allen die gewählten Waffen zu.
test("Aufsätze ohne Waffe: Hinweis und Zuordnung in einem Schritt", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, attachments_without_weapon: [{ id: "a3", name: "Kompensator" }] } });
  apiMock.post.mockResolvedValue({ data: { updated: 1 } });
  renderPage();
  const notice = await screen.findByTestId("equipment-without-weapon");
  expect(notice).toHaveTextContent("Kompensator");
  expect(within(notice).getByTestId("equipment-assign")).toBeDisabled();
  fireEvent.click(within(notice).getByTestId("equipment-assign-open"));
  fireEvent.click(within(notice).getByTestId("equipment-assign-w1"));
  fireEvent.click(within(notice).getByTestId("equipment-assign"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/equipment/assign-weapons", { weapon_ids: ["w1"], weapon_class_ids: [] }));
});

test("ohne Aufsätze ohne Waffe kein Hinweis", async () => {
  renderPage();
  await screen.findByTestId("equipment-group-waffen");
  expect(screen.queryByTestId("equipment-without-weapon")).not.toBeInTheDocument();
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
  expect(within(sheet).getByTestId("equipment-weapons-count")).toHaveTextContent("passt dann zu keiner Waffe");
  fireEvent.click(within(sheet).getByLabelText(/Donner 4/));
  fireEvent.click(within(sheet).getByTestId("equipment-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/equipment", {
    category: "aufsaetze", subcategory: null, name: "Laser", image_url: "/api/static/uploads/laser.png", note: null, weapon_ids: ["w2"], weapon_class_ids: [] }));
});

test("bearbeiten ändert keine Kategorie, deaktivieren und archivieren setzen den Zustand", async () => {
  renderPage();
  fireEvent.click(await screen.findByTestId("equipment-edit-w1"));
  const sheet = screen.getByTestId("equipment-sheet");
  expect(within(sheet).getByTestId("equipment-category-fixed")).toBeDisabled();
  fireEvent.change(within(sheet).getByTestId("equipment-name"), { target: { value: "Blitz X" } });
  fireEvent.click(within(sheet).getByTestId("equipment-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1/equipment/w1", {
    name: "Blitz X", subcategory: null, image_url: "/api/static/uploads/blitz.webp", note: null }));
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

// #2287: Unterkategorien - gruppiert und einklappbar, eigenes Blatt, Einträge zuordnen und verschieben, Aufsätze zu Waffenklassen.
const GROUPED = {
  ...BODY,
  subcategories_limit: 30,
  subcategory_counts: { sturm: 1 },
  suggested_subcategories: { weapon: ["Sturmgewehr", "Schrotflinte", "Pistole"], attachment: ["Optik"], item: [] },
  categories: [
    { ...BODY.categories[0], subcategories: [{ key: "sturm", label: "Sturmgewehr", icon_url: "/api/static/uploads/sturm.png" }, { key: "schrot", label: "Schrotflinte", icon_url: null }] },
    { ...BODY.categories[1], subcategories: [] },
    { ...BODY.categories[2], subcategories: [] },
  ],
  items: BODY.items.map((item) => (item.id === "w1" ? { ...item, subcategory: "sturm" } : item)),
};

test("gruppiert je Unterkategorie mit Zähler, ohne Unterkategorie zuerst, einklappbar", async () => {
  apiMock.get.mockResolvedValue({ data: GROUPED });
  renderPage();
  const weapons = await screen.findByTestId("equipment-group-waffen");
  const subs = within(weapons).getAllByTestId(/^equipment-sub-(ohne|sturm|schrot)$/);
  expect(subs.map((row) => row.dataset.testid)).toEqual(["equipment-sub-ohne", "equipment-sub-sturm", "equipment-sub-schrot"]);
  expect(within(subs[1]).getByTestId("equipment-sub-count")).toHaveTextContent("1");
  expect(within(subs[1]).getByTestId("equipment-row-w1")).toBeInTheDocument();
  expect(within(subs[2])).toBeTruthy();
  expect(subs[2]).toHaveTextContent("Noch kein Eintrag");
  fireEvent.click(within(subs[1]).getByTestId("equipment-sub-toggle-sturm"));
  expect(within(weapons).queryByTestId("equipment-row-w1")).not.toBeInTheDocument();
  expect(within(subs[1]).getByTestId("equipment-sub-toggle-sturm")).toHaveAttribute("aria-expanded", "false");
  // Suchen: nur Gruppen mit Treffern, aufgeklappt.
  fireEvent.change(screen.getByTestId("equipment-search"), { target: { value: "blitz" } });
  expect(within(weapons).getByTestId("equipment-row-w1")).toBeInTheDocument();
  expect(within(weapons).queryByTestId("equipment-sub-schrot")).not.toBeInTheDocument();
  // Ohne Unterkategorien bleibt eine Kategorie wie bisher.
  expect(within(screen.getByTestId("equipment-group-perks")).queryByTestId("equipment-sub-ohne")).not.toBeInTheDocument();
});

test("Unterkategorien pflegen: Vorschlag einfügen, umbenennen, eine mit Einträgen bleibt", async () => {
  apiMock.get.mockResolvedValue({ data: GROUPED });
  apiMock.put.mockResolvedValue({ data: { subcategories: [] } });
  renderPage();
  fireEvent.click(await screen.findByTestId("equipment-subcategories-waffen"));
  const sheet = screen.getByTestId("equipment-subcategories-sheet");
  expect(within(sheet).getByLabelText("Sturmgewehr entfernen")).toBeDisabled();
  expect(within(sheet).getByLabelText("Schrotflinte entfernen")).not.toBeDisabled();
  expect(within(sheet).getByTestId("equipment-subcategories-suggestion")).toHaveTextContent("Vorschlag: Pistole.");
  fireEvent.click(within(sheet).getByTestId("equipment-subcategories-suggest"));
  fireEvent.change(within(sheet).getByLabelText("Name der Unterkategorie 2"), { target: { value: "Flinte" } });
  fireEvent.click(within(sheet).getByLabelText("Pistole nach oben"));
  fireEvent.click(within(sheet).getByTestId("equipment-subcategories-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/games/g1/equipment/categories/waffen/subcategories", { subcategories: [
    { key: "sturm", label: "Sturmgewehr", icon_url: "/api/static/uploads/sturm.png" }, { label: "Pistole", icon_url: null },
    { key: "schrot", label: "Flinte", icon_url: null }] }));
});

test("ein Eintrag bekommt seine Unterkategorie, ein Aufsatz Waffenklassen", async () => {
  apiMock.get.mockResolvedValue({ data: GROUPED });
  renderPage();
  fireEvent.click(await screen.findByTestId("equipment-sub-add-schrot"));
  let sheet = screen.getByTestId("equipment-sheet");
  expect(within(sheet).getByTestId("equipment-subcategory")).toHaveValue("schrot");
  fireEvent.change(within(sheet).getByTestId("equipment-name"), { target: { value: "Hagel" } });
  fireEvent.click(within(sheet).getByTestId("equipment-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/equipment", {
    category: "waffen", subcategory: "schrot", name: "Hagel", image_url: null, note: null }));
  await waitFor(() => expect(screen.queryByTestId("equipment-sheet")).not.toBeInTheDocument());

  fireEvent.click(screen.getByTestId("equipment-add-aufsaetze"));
  sheet = screen.getByTestId("equipment-sheet");
  fireEvent.change(within(sheet).getByTestId("equipment-name"), { target: { value: "Rotpunkt 2" } });
  fireEvent.click(within(within(sheet).getByTestId("equipment-weapon-classes")).getByLabelText(/Sturmgewehr/));
  expect(within(sheet).getByTestId("equipment-weapons-count")).toHaveTextContent("Passt zu 1 Waffenklasse.");
  // Blitz 9 ist ein Sturmgewehr: er passt schon über die Klasse.
  expect(within(sheet).getByLabelText(/Blitz 9/)).toBeDisabled();
  fireEvent.click(within(sheet).getByTestId("equipment-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/equipment", {
    category: "aufsaetze", subcategory: null, name: "Rotpunkt 2", image_url: null, note: null, weapon_ids: [], weapon_class_ids: ["sturm"] }));
});

test("mehrere Einträge auswählen und verschieben - nur innerhalb einer Kategorie", async () => {
  apiMock.get.mockResolvedValue({ data: GROUPED });
  apiMock.post.mockResolvedValue({ data: { updated: 1 } });
  renderPage();
  fireEvent.click(await screen.findByTestId("equipment-select-mode"));
  fireEvent.click(screen.getByTestId("equipment-select-w2"));
  fireEvent.click(screen.getByTestId("equipment-select-p1"));
  const bar = screen.getByTestId("equipment-move-bar");
  expect(bar).toHaveTextContent("nur innerhalb einer Kategorie");
  expect(within(bar).getByTestId("equipment-move")).toBeDisabled();
  fireEvent.click(screen.getByTestId("equipment-select-p1"));
  fireEvent.change(within(bar).getByTestId("equipment-move-target"), { target: { value: "schrot" } });
  fireEvent.click(within(bar).getByTestId("equipment-move"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/games/g1/equipment/move", { item_ids: ["w2"], subcategory: "schrot" }));
});

test("ein Aufsatz über seine Klasse nennt sie, ohne Waffe und Klasse passt er zu keiner", async () => {
  apiMock.get.mockResolvedValue({ data: { ...GROUPED, items: [...GROUPED.items, { id: "a9", category: "aufsaetze", name: "Laser", status: "active", in_lists: 0, weapon_ids: [], weapon_class_ids: ["schrot"] }] } });
  renderPage();
  expect(await screen.findByTestId("equipment-row-a9")).toHaveTextContent("passt zu Schrotflinte (Klasse)");
});

// Codex Runde 1: Bei vielen Waffen bleibt der Hinweis kurz - die Auswahl ist zugeklappt und hat eine Suche.
test("Aufsätze ohne Waffe: Auswahl zugeklappt, mit Suche", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, attachments_without_weapon: [{ id: "a3", name: "Kompensator" }] } });
  renderPage();
  const notice = await screen.findByTestId("equipment-without-weapon");
  expect(within(notice).queryByTestId("equipment-assign-w1")).not.toBeInTheDocument();
  expect(within(notice).getByTestId("equipment-assign-open")).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(within(notice).getByTestId("equipment-assign-open"));
  fireEvent.change(within(notice).getByTestId("equipment-assign-search"), { target: { value: "donner" } });
  expect(within(notice).queryByTestId("equipment-assign-w1")).not.toBeInTheDocument();
  fireEvent.click(within(notice).getByTestId("equipment-assign-w2"));
  expect(within(notice).getByTestId("equipment-assign-open")).toHaveTextContent("1 gewählt");
});