import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Partner (#435): „Neuer Partner“ öffnet ein Seitenblatt statt eines Fensters; Speichern legt an,
// schließt das Blatt und lädt die Liste neu.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AdminPartnersPage = (await import("./AdminPartnersPage")).default;

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    // Sponsoren und Partner aus Dolibarr (#405): der Block über der Liste fragt den Schalter ab.
    if (url === "/admin/dolibarr/sponsors") return { data: { from_dolibarr: false, connected: false } };
    return { data: [{ id: "p1", name: "Gamers Heaven", kind: "Messe", is_active: true }] };
  });
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { id: "p2" } });
});

test("Neuer Partner öffnet das Seitenblatt, Speichern legt an und schließt es", async () => {
  render(<MemoryRouter><AdminPartnersPage /></MemoryRouter>);
  expect(await screen.findByText("Gamers Heaven")).toBeInTheDocument();
  expect(screen.queryByTestId("partner-sheet")).toBeNull();

  fireEvent.click(screen.getByTestId("partner-new"));
  expect(screen.getByRole("dialog", { name: "Neuer Partner" })).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("partner-name"), { target: { value: "IT-Tabelander" } });
  fireEvent.change(screen.getByTestId("partner-kind"), { target: { value: "Community" } });
  fireEvent.submit(screen.getByTestId("partner-sheet"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/partners", expect.objectContaining({ name: "IT-Tabelander", kind: "Community", is_active: true })));
  await waitFor(() => expect(screen.queryByTestId("partner-sheet")).toBeNull());
  expect(apiMock.get.mock.calls.filter(([url]) => url === "/partners/admin")).toHaveLength(2);
});

test("Bearbeiten öffnet das Blatt mit den Werten des Partners", async () => {
  render(<MemoryRouter><AdminPartnersPage /></MemoryRouter>);
  await screen.findByText("Gamers Heaven");
  fireEvent.click(screen.getAllByRole("button").find((button) => button.querySelector("svg.lucide-pencil")));
  expect(screen.getByRole("dialog", { name: "Partner bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("partner-name")).toHaveValue("Gamers Heaven");
  fireEvent.click(screen.getByTestId("partner-sheet-cancel"));
  expect(screen.queryByTestId("partner-sheet")).toBeNull();
});
