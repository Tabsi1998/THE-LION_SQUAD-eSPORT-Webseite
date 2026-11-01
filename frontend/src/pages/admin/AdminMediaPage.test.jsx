import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Medien (#435, letzter Rest): die Detailansicht ist ein Seitenblatt mit den Aktionen in der Leiste
// unten - Vorschau, Angaben und „Verwendet in“ im Blatt, die Kacheln bleiben daneben sichtbar.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ API_BASE: "http://backend.test", api: apiMock, formatApiError: (d) => d || "Fehler", formatUploadError: () => "Fehler", uploadApi: { post: vi.fn() } }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ prepareImageForUpload: async (file) => file }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/components/tls/UploadProgressPanel", () => ({ UploadProgressPanel: () => null }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useUploadProgress", () => ({ useUploadProgress: () => ({ items: [], start: () => {}, update: () => {}, finish: () => {}, fail: () => {}, dismiss: () => {} }) }));
vi.mock("@/lib/uploadDiagnostics", () => ({ logUploadClientFailure: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const AdminMediaPage = (await import("./AdminMediaPage")).default;

const ITEM = {
  filename: "loewe.png", ext: "png", url: "/api/static/uploads/loewe.png", size: 12345, mtime: "2026-09-23T10:00:00Z", media_scope: "branding",
  usage_count: 2, tracked: true, duplicate_count: 1, references: [
    { collection: "settings", id: "branding", field: "logo_url", place: "Einstellungen · Logo", label: "Branding" },
    { collection: "tournaments", id: "t-1", field: "award_images.1", place: "Turnier · Gewinnerbild Platz 1", label: "Cup" },
  ],
};
const UNUSED = { ...ITEM, filename: "frei.png", url: "/api/static/uploads/frei.png", usage_count: 0, references: [], is_unused: true };

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: [ITEM, UNUSED] };
    if (url === "/admin/media/audit") return { data: { summary: {} } };
    return { data: [] };
  });
});

test("die Kachel öffnet ein Seitenblatt mit Vorschau, Angaben, Verwendung und den Aktionen", async () => {
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  const tile = await screen.findByTestId("media-tile-loewe.png");
  expect(screen.queryByTestId("media-sheet")).toBeNull();
  fireEvent.click(tile);
  const sheet = screen.getByTestId("media-sheet");
  expect(screen.getByRole("dialog", { name: "loewe.png" })).toBeInTheDocument();
  expect(sheet).toHaveTextContent("Medien · Bild");
  expect(screen.getByTestId("media-sheet-preview")).toBeInTheDocument();
  expect(screen.getByTestId("media-sheet-references")).toHaveTextContent("Branding");
  // Die Verwendungsorte stehen lesbar da, nicht als Feldpfad.
  expect(screen.getByTestId("media-sheet-references")).toHaveTextContent("Turnier · Gewinnerbild Platz 1");
  expect(screen.getByTestId("media-sheet-references")).not.toHaveTextContent("award_images");
  expect(sheet).toHaveTextContent("http://backend.test/api/static/uploads/loewe.png");
  for (const id of ["media-rotate-left", "media-rotate-right", "media-copy-url", "media-delete"]) expect(screen.getByTestId(id)).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("media-sheet-close"));
  expect(screen.queryByTestId("media-sheet")).toBeNull();
  expect(screen.getByTestId("media-tile-loewe.png")).toBeInTheDocument();
});

test("eine verwendete Datei wird nur nach Warnung gelöscht, eine unbenutzte ohne", async () => {
  apiMock.delete.mockResolvedValue({ data: { ok: true, cleared_references: 2, text_references: 0 } });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("media-tile-loewe.png"));
  fireEvent.click(screen.getByTestId("media-delete"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/media/loewe.png?force=true"));
  const warning = confirmMock.mock.calls.at(-1)[0];
  expect(warning.title).toBe("Verwendete Datei löschen?");
  expect(warning.description).toContain("Turnier · Gewinnerbild Platz 1");

  fireEvent.click(await screen.findByTestId("media-tile-frei.png"));
  fireEvent.click(screen.getByTestId("media-delete"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/media/frei.png"));
  expect(confirmMock.mock.calls.at(-1)[0].title).toBe("Datei endgültig löschen?");
});

test("Seiten, Filter und Suche fragt die Mediathek beim Server an (#2122)", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: { items: [ITEM], total: 130, total_size: 2048, limit: 60, offset: 0 } };
    if (url === "/admin/media/audit") return { data: { summary: {} } };
    return { data: [] };
  });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  expect(await screen.findByTestId("media-page-label")).toHaveTextContent("Seite 1 von 3");
  expect(apiMock.get.mock.calls.map(([url]) => url)).toContain("/admin/media?paged=true&limit=60&offset=0&include_user_uploads=false&include_usage=true");

  fireEvent.click(screen.getByTestId("media-page-next"));
  await waitFor(() => expect(screen.getByTestId("media-page-label")).toHaveTextContent("Seite 2 von 3"));
  await waitFor(() => expect(apiMock.get.mock.calls.at(-2)[0]).toContain("offset=60"));

  // Ein neuer Filter beginnt wieder vorne.
  fireEvent.change(screen.getByTestId("media-scope-filter"), { target: { value: "unused" } });
  await waitFor(() => expect(apiMock.get.mock.calls.some(([url]) => url.includes("scope=unused") && url.includes("offset=0"))).toBe(true));
  fireEvent.click(screen.getByTestId("media-filter-videos"));
  await waitFor(() => expect(apiMock.get.mock.calls.some(([url]) => url.includes("type=videos"))).toBe(true));
  fireEvent.change(screen.getByTestId("media-search"), { target: { value: "uralt" } });
  await waitFor(() => expect(apiMock.get.mock.calls.some(([url]) => url.includes("q=uralt"))).toBe(true));
});

test("Drehen fragt nach, nennt die Stellen und übernimmt Adresse und Maße (#2122)", async () => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { url: "/api/static/uploads/loewe.png?v=7", size: 999, width: 500, height: 1000, updated_at: "2026-10-01T10:00:00Z" } });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("media-tile-loewe.png"));

  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("media-rotate-right"));
  await waitFor(() => expect(confirmMock.mock.calls.at(-1)[0].title).toBe("Bild nach rechts drehen?"));
  expect(confirmMock.mock.calls.at(-1)[0].description).toContain("an 2 Stellen");
  expect(apiMock.post).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("media-rotate-left"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/media/loewe.png/rotate", { degrees: -90 }));
  expect(await screen.findByTestId("media-sheet-dimensions")).toHaveTextContent("500 × 1000 px");
  expect(screen.getByTestId("media-sheet")).toHaveTextContent("loewe.png?v=7");
});

test("Original-Bilder der Serien (#1933) zählt die Mediathek mit - privat, ohne Kachel", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: [ITEM] };
    if (url === "/admin/media/audit") return { data: { summary: {}, reference_originals: { count: 5, bytes: 2.5 * 1024 * 1024 } } };
    return { data: [] };
  });
  render(<MemoryRouter><AdminMediaPage /></MemoryRouter>);
  expect(await screen.findByTestId("media-reference-originals")).toHaveTextContent("5 Original-Bilder der Serien · 2.50 MB");
  expect(screen.queryByTestId("media-tile-reference")).toBeNull();
});