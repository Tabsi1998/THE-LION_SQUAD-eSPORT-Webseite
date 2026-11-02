import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Game-Server (#2129, SP6 und SP7): Alltagsdeutsch, Technik eingeklappt, Demo-Knopf nur in Testumgebungen, echter Fehler in der
// roten Box, Löschen-Fehler sichtbar, Server-Icon per Upload. Erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (detail ? String(detail) : ""), resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({
  ImageUpload: ({ value, onChange, label, testId }) => <label>{label}<input data-testid={testId} value={value || ""} onChange={(event) => onChange(event.target.value)} /></label>,
}));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("./gameServers/AmpPanelCard", () => ({ AmpPanelCard: () => null }));
const toastMock = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminGameServersPage } = await import("./AdminGameServersPage");

const SERVER = { id: "s1", slug: "probe", name: "Probe Server", status: "offline", visibility: "public", sync_provider: "steam_a2s", last_sync_error: "connection refused von probe.example", last_sync_note: "Die Website konnte den Server nicht erreichen." };

function mockApi({ meta = { demo_tools: false }, servers = [SERVER] } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/game-servers/admin/meta") return { data: meta };
    if (url === "/game-servers/admin") return { data: servers };
    return { data: [] };
  });
}

function renderPage() {
  return render(<MemoryRouter><AdminGameServersPage /></MemoryRouter>);
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  mockApi();
});

test("die rote Box zeigt den echten Fehler", async () => {
  renderPage();
  expect(await screen.findByTestId("server-sync-error-probe")).toHaveTextContent("Letzter Abruf fehlgeschlagen: connection refused von probe.example");
});

test("kein Fachwort mehr: Kopf wie im Menü, Knöpfe und Angaben auf Deutsch", async () => {
  renderPage();
  await screen.findByRole("heading", { name: "Probe Server" });
  expect(screen.getByText("eSports")).toBeInTheDocument();
  expect(screen.queryByText("Community")).toBeNull();
  expect(screen.getByTestId("server-sync-all")).toHaveTextContent("Alle aktualisieren");
  expect(screen.getByText("Steam-Server abfragen")).toBeInTheDocument();
  expect(screen.queryByText(/sync/i)).toBeNull();
});

test("den Demo-Knopf gibt es nur, wenn der Server es erlaubt", async () => {
  const { unmount } = renderPage();
  await screen.findByRole("heading", { name: "Probe Server" });
  expect(screen.queryByTestId("server-demo-remove")).toBeNull();
  unmount();

  mockApi({ meta: { demo_tools: true } });
  renderPage();
  expect(await screen.findByTestId("server-demo-remove")).toBeInTheDocument();
});

test("ein fehlgeschlagenes Löschen wird gemeldet", async () => {
  apiMock.delete.mockRejectedValue({ response: { data: { detail: "Server nicht gefunden." } } });
  renderPage();
  await screen.findByRole("heading", { name: "Probe Server" });
  fireEvent.click(screen.getByTitle("Löschen"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Server nicht gefunden."));
  expect(toastMock.success).not.toHaveBeenCalled();
});

test("im Formular liegt die Technik eingeklappt, das Server-Icon kommt per Upload", async () => {
  apiMock.post.mockResolvedValue({ data: {} });
  renderPage();
  await screen.findByRole("heading", { name: "Probe Server" });
  fireEvent.click(screen.getByRole("button", { name: "Server anlegen" }));
  const technik = screen.getByTestId("server-technik");
  expect(technik.open).toBe(false);
  expect(technik).toHaveTextContent("Abfrage-Adresse");
  expect(screen.queryByText(/host\.docker\.internal/)).toBeNull();

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Neuer Server" } });
  fireEvent.change(screen.getByTestId("server-icon"), { target: { value: "/api/static/uploads/icon.png" } });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/game-servers", expect.objectContaining({ server_icon_url: "/api/static/uploads/icon.png" })));
});

test("die AMP-Instanz steht nur beim AMP-Panel im Vordergrund", async () => {
  renderPage();
  await screen.findByRole("heading", { name: "Probe Server" });
  fireEvent.click(screen.getByRole("button", { name: "Server anlegen" }));
  expect(screen.getByTestId("server-technik")).toHaveTextContent("AMP-Instanz");
  fireEvent.change(screen.getByLabelText("Live-Daten von"), { target: { value: "amp" } });
  expect(screen.getByTestId("server-technik")).not.toHaveTextContent("AMP-Instanz");
  expect(screen.getByLabelText("AMP-Instanz")).toBeInTheDocument();
});
