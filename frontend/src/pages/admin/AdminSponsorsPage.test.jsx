import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Sponsoren aus Dolibarr (#405, Schalter seit #510 unter Dolibarr → Funktionen): der Block über der
// Liste zeigt den Stand und lädt nach; bei einem Sponsor aus Dolibarr sind Name, Stufe, Laufzeit und
// Kontakt gesperrt, Beschreibung und Platzierung bleiben frei.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/GermanDateField", () => ({
  GermanDateField: ({ label, value, onChange, testId, disabled }) => <label>{label}<input data-testid={testId} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></label>,
}));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminSponsorsPage = (await import("./AdminSponsorsPage")).default;

const SOURCE_OFF = { from_dolibarr: false, connected: true, sponsor_category: "Sponsor", partner_category: "Partner", categories: {}, counts: { sponsors: 0, partners: 0 }, locked: { sponsors: ["name", "tier", "contract_start", "contract_end", "contact_email", "contact_phone"], partners: ["name", "kind"] } };
const SOURCE_ON = { ...SOURCE_OFF, from_dolibarr: true, fetched_at: "2026-09-23T10:00:00Z", counts: { sponsors: 2, partners: 1 }, categories: { sponsor: { label: "Sponsor", found: true, sub: ["Gold"] }, partner: { label: "Partner", found: true, sub: [] } } };
const SPONSORS = [
  { id: "s1", name: "Alpha Energy", tier: "gold", source: "dolibarr", contract_start: "2024-01-01", contract_end: "2026-12-31", contact_email: "office@alpha.test", description: "Handtext", is_active: true, effective_status: "active",
    // Bilder aus dem Vereinsmodul (#880): das Vorschaubild ist das, was die Website zeigt - nicht das Upload.
    logo_url: "/uploads/alpha.png", dolibarr_images: { logo: { dark: { url: "/api/static/uploads/dolibarr-partner-7-logo-dark-abc.png" } } },
    dolibarr_image_summary: { logo: { variants: ["dark"], shown: "dolibarr-dark" }, banner: { variants: [], shown: null } } },
  { id: "s2", name: "Handfirma", tier: "bronze", is_active: true, effective_status: "active" },
];

function mockApi(source) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/dolibarr/sponsors") return { data: source };
    if (url === "/sponsors/admin") return { data: SPONSORS };
    return { data: [] };
  });
}

beforeEach(() => {
  apiMock.patch.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

// Seit #510 liegt der Schalter unter Dolibarr → Funktionen: aus = ein Satz mit dem Weg, an = Stand und „Jetzt nachlesen“.
test("aus: nur der Weg zum Schalter; an: Stand, Nachlesen lädt die Liste neu", async () => {
  mockApi(SOURCE_OFF);
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  expect(await screen.findByTestId("dolibarr-source-off")).toHaveTextContent("Dolibarr → Funktionen");
  expect(screen.getByTestId("dolibarr-source-features")).toHaveAttribute("href", "/admin/dolibarr?tab=features");
  expect(screen.queryByTestId("dolibarr-source-switch")).toBeNull();
  expect(screen.queryByTestId("dolibarr-source-refresh")).toBeNull();

  mockApi(SOURCE_ON);
  apiMock.post.mockResolvedValue({ data: { ok: true, sponsors: { total: 2 }, partners: { total: 1 }, view: SOURCE_ON } });
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  const state = (await screen.findAllByTestId("dolibarr-source-state")).at(-1);
  expect(state).toHaveTextContent("2 Sponsoren, 1 Partner");
  expect(screen.getAllByTestId("dolibarr-source").at(-1)).toHaveTextContent("Kategorie „Sponsor“");
  fireEvent.click(screen.getAllByTestId("dolibarr-source-refresh").at(-1));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/dolibarr/sponsors/refresh"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  expect(apiMock.get.mock.calls.filter(([url]) => url === "/sponsors/admin").length).toBeGreaterThanOrEqual(3);
});

test("Sponsor aus Dolibarr: Dolibarr-Felder gesperrt, Website-Felder frei; Handeintrag bleibt ganz frei", async () => {
  mockApi(SOURCE_ON);
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  expect(await screen.findByTestId("sponsor-dolibarr-s1")).toBeInTheDocument();
  expect(screen.queryByTestId("sponsor-dolibarr-s2")).toBeNull();
  expect(screen.getByTestId("sponsor-images-s1")).toHaveAttribute("title", "Logo aus Dolibarr (dunkel)");
  expect(screen.queryByTestId("sponsor-images-s2")).toBeNull();
  expect(screen.getByTestId("sponsor-card-s1").querySelector("img")).toHaveAttribute("src", "/api/static/uploads/dolibarr-partner-7-logo-dark-abc.png");

  fireEvent.click(screen.getByTestId("sponsor-card-s1").querySelector("button"));
  expect(screen.getByTestId("sponsor-locked-hint")).toBeInTheDocument();
  expect(screen.getByTestId("sponsor-images-hint")).toHaveTextContent("Logo aus Dolibarr (dunkel). Die Website und die App zeigen die Fassung für dunklen Hintergrund");
  expect(screen.getByTestId("sponsor-name")).toBeDisabled();
  expect(screen.getByTestId("sponsor-tier")).toBeDisabled();
  expect(screen.getByTestId("sponsor-contract-end")).toBeDisabled();
  expect(screen.getByTestId("sponsor-contact-email")).toBeDisabled();
  expect(screen.getByTestId("sponsor-description")).not.toBeDisabled();
  expect(screen.getByTestId("sponsor-show-home")).not.toBeDisabled();
  fireEvent.click(screen.getByTestId("sponsor-sheet-cancel"));

  fireEvent.click(screen.getByTestId("sponsor-card-s2").querySelector("button"));
  expect(screen.queryByTestId("sponsor-locked-hint")).toBeNull();
  expect(screen.getByTestId("sponsor-name")).not.toBeDisabled();
});

test("Sponsor aus Dolibarr lässt sich nicht löschen, solange der Schalter an ist (#2130)", async () => {
  mockApi(SOURCE_ON);
  const on = render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  expect(await screen.findByTestId("sponsor-delete-s1")).toBeDisabled();
  expect(screen.getByTestId("sponsor-delete-s1")).toHaveAttribute("title", expect.stringContaining("aus der Kategorie"));
  expect(screen.getByTestId("sponsor-delete-s2")).not.toBeDisabled();
  on.unmount();
  mockApi(SOURCE_OFF);
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  await screen.findByTestId("dolibarr-source-off");
  expect(screen.getByTestId("sponsor-delete-s1")).not.toBeDisabled();
});

test("Archivieren und Zurückholen schalten „Aktiv“; ein Sponsor in Verwendung zeigt den Grund beim Löschen (#2130)", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/dolibarr/sponsors") return { data: SOURCE_OFF };
    if (url === "/sponsors/admin") return { data: [{ id: "s4", name: "Archiv GmbH", tier: "gold", is_active: false, effective_status: "inactive" }, { id: "s5", name: "Laufend GmbH", tier: "gold", is_active: true, effective_status: "active" }] };
    return { data: [] };
  });
  apiMock.patch.mockResolvedValue({ data: {} });
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  expect(await screen.findByTestId("sponsor-card-s4")).toHaveTextContent("Archiviert");
  fireEvent.click(screen.getByTestId("sponsor-archive-s5"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/sponsors/s5", { is_active: false }));
  fireEvent.click(screen.getByTestId("sponsor-restore-s4"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/sponsors/s4", { is_active: true }));

  apiMock.delete.mockRejectedValue({ response: { data: { detail: "Dieser Sponsor wird noch verwendet: 1 Event." } } });
  fireEvent.click(screen.getByTestId("sponsor-delete-s5"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Dieser Sponsor wird noch verwendet: 1 Event."));
});

test("ein Schalter: kein Vertragsstatus mehr, die Vorschau rechnet mit Schalter und Laufzeit (#2130)", async () => {
  mockApi(SOURCE_OFF);
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  fireEvent.click((await screen.findByTestId("sponsor-card-s2")).querySelector("button"));
  expect(screen.queryByTestId("sponsor-contract-status")).toBeNull();
  const preview = screen.getByTestId("sponsor-placement-preview");
  expect(preview).toHaveTextContent("Wird ausgespielt");
  fireEvent.click(screen.getByTestId("sponsor-active"));
  expect(preview).toHaveTextContent("Nicht öffentlich");
  fireEvent.click(screen.getByTestId("sponsor-active"));
  fireEvent.change(screen.getByTestId("sponsor-contract-end"), { target: { value: "2020-01-01" } });
  expect(preview).toHaveTextContent("Nicht öffentlich");
  apiMock.patch.mockResolvedValue({ data: {} });
  fireEvent.click(screen.getByTestId("sponsor-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1]).not.toHaveProperty("contract_status");
});

// Event-Sponsoren (#1371): nur der Sponsor sagt, wo er erscheint - „bei allen Events“ oder „bei ausgewählten Events“.
test("Events: bei allen leert die Auswahl, bei ausgewählten verlangt mindestens ein Event", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/dolibarr/sponsors") return { data: SOURCE_OFF };
    if (url === "/sponsors/admin") return { data: [{ id: "s3", name: "Pixelbäckerei", tier: "gold", is_active: true, show_on_events: true, event_ids: ["e1"] }] };
    if (url.startsWith("/events")) return { data: [{ id: "e1", name: "Herbst-LAN" }, { id: "e2", name: "Winter-LAN" }] };
    return { data: [] };
  });
  apiMock.patch.mockResolvedValue({ data: {} });
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  fireEvent.click((await screen.findByTestId("sponsor-card-s3")).querySelector("button"));
  expect(screen.getByTestId("sponsor-event-scope-selected")).toBeChecked();
  expect(await screen.findByTestId("sponsor-event-list")).toHaveTextContent("Herbst-LAN");

  fireEvent.click(screen.getByLabelText("Herbst-LAN"));
  fireEvent.click(screen.getByTestId("sponsor-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Wähle mindestens ein Event – oder „bei allen Events“."));
  expect(apiMock.patch).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("sponsor-event-scope-all"));
  expect(screen.queryByTestId("sponsor-event-list")).toBeNull();
  fireEvent.click(screen.getByTestId("sponsor-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/sponsors/s3", expect.objectContaining({ show_on_events: true, event_ids: [] })));
});
