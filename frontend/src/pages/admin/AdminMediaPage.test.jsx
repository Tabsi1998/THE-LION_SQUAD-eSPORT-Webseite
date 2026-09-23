import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Medien (#435, letzter Rest): die Detailansicht ist ein Seitenblatt mit den Aktionen in der Leiste
// unten - Vorschau, Angaben und „Verwendet in“ im Blatt, die Kacheln bleiben daneben sichtbar.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ API_BASE: "http://backend.test", api: apiMock, formatApiError: (d) => d || "Fehler", formatUploadError: () => "Fehler", uploadApi: { post: vi.fn() } }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ prepareImageForUpload: async (file) => file }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/UploadProgressPanel", () => ({ UploadProgressPanel: () => null }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useUploadProgress", () => ({ useUploadProgress: () => ({ items: [], start: () => {}, update: () => {}, finish: () => {}, fail: () => {}, dismiss: () => {} }) }));
vi.mock("@/lib/uploadDiagnostics", () => ({ logUploadClientFailure: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const AdminMediaPage = (await import("./AdminMediaPage")).default;

const ITEM = {
  filename: "loewe.png", ext: "png", url: "/api/static/uploads/loewe.png", size: 12345, mtime: "2026-09-23T10:00:00Z", media_scope: "branding",
  usage_count: 2, tracked: true, references: [{ collection: "settings", id: "branding", field: "logo_url", label: "Branding" }], duplicate_count: 1,
};

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media?")) return { data: [ITEM] };
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
  expect(sheet).toHaveTextContent("http://backend.test/api/static/uploads/loewe.png");
  for (const id of ["media-rotate-left", "media-rotate-right", "media-copy-url", "media-delete"]) expect(screen.getByTestId(id)).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("media-sheet-close"));
  expect(screen.queryByTestId("media-sheet")).toBeNull();
  expect(screen.getByTestId("media-tile-loewe.png")).toBeInTheDocument();
});
