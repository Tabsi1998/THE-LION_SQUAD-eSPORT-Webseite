import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Event als eigene Seite (#434): Anlegen unter /admin/events/new, Bearbeiten unter
// /admin/events/:id mit den Daten aus der Liste; Speichern führt zurück zur Liste.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/DiscordPreview", () => ({ DiscordPreview: () => <div data-testid="discord-preview" /> }));
vi.mock("@/components/tls/SharePreviewToggle", () => ({ SharePreviewToggle: () => null }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: ({ testId }) => <textarea data-testid={testId} readOnly /> }));
vi.mock("@/components/tls/AccessLinksPanel", () => ({ AccessLinksPanel: () => <div data-testid="access-links" /> }));
vi.mock("@/components/tls/EventBillingSection", () => ({ EventBillingSection: () => null }));
vi.mock("@/components/tls/EventLocationsSection", () => ({
  EventLocationsSection: () => null,
  locationsToForm: () => [],
  formToLocations: (value) => value,
  locationsFormError: () => "",
}));
vi.mock("@/components/tls/RichContent", () => ({ appendEmbedToken: (text) => text }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ can: () => false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const AdminEventEditPage = (await import("./AdminEventEditPage")).default;

const META = {
  types: [{ k: "general", l: "Allgemein" }, { k: "lan", l: "LAN" }],
  statuses: [{ k: "draft", l: "Entwurf" }, { k: "live", l: "Live" }],
  visibilities: [{ k: "public", l: "Öffentlich" }, { k: "members", l: "Mitglieder" }],
};
const EVENTS = [
  { id: "ev-1", name: "Halloween Night", slug: "halloween", status: "draft", event_type: "general", visibility: "public", start_date: "2026-10-31T14:00:00Z" },
];

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/events" element={<div data-testid="events-list" />} />
        <Route path="/admin/events/new" element={<AdminEventEditPage />} />
        <Route path="/admin/events/:id" element={<AdminEventEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url.startsWith("/events?")) return { data: EVENTS };
    return { data: [] };
  });
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
});

test("Neues Event: Seite mit Seitenleiste, Slug aus dem Namen, Speichern legt an und führt zur Liste", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "ev-2" } });
  renderAt("/admin/events/new");
  expect(await screen.findByRole("heading", { name: "Neues Event" })).toBeInTheDocument();
  expect(screen.getByTestId("admin-form-aside")).toBeInTheDocument();
  expect(screen.getByTestId("admin-form-back")).toHaveAttribute("href", "/admin/events");
  expect(screen.queryByTestId("access-links")).toBeNull();
  expect(await screen.findByRole("option", { name: "LAN" })).toBeInTheDocument();

  fireEvent.change(screen.getByTestId("event-name"), { target: { value: "Weihnachtsfeier 2026" } });
  expect(screen.getByTestId("event-slug")).toHaveValue("weihnachtsfeier-2026");
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/events", expect.objectContaining({ name: "Weihnachtsfeier 2026", slug: "weihnachtsfeier-2026", status: "draft" })));
  expect(await screen.findByTestId("events-list")).toBeInTheDocument();
});

test("Bearbeiten lädt das Event aus der Liste und schickt nur die Änderung", async () => {
  apiMock.patch.mockResolvedValue({ data: { ...EVENTS[0], name: "Halloween Night 2026" } });
  renderAt("/admin/events/ev-1");
  expect(await screen.findByRole("heading", { name: "Event bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("event-name")).toHaveValue("Halloween Night");
  expect(screen.getByTestId("access-links")).toBeInTheDocument();
  expect(screen.getByTestId("event-status")).toHaveValue("draft");

  fireEvent.change(screen.getByTestId("event-name"), { target: { value: "Halloween Night 2026" } });
  fireEvent.submit(screen.getByTestId("event-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [url, patch] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/events/ev-1");
  expect(patch).toEqual(expect.objectContaining({ name: "Halloween Night 2026" }));
  expect(patch).not.toHaveProperty("slug");
  expect(await screen.findByTestId("events-list")).toBeInTheDocument();
});

test("unbekannte Kennung: Hinweis mit Weg zurück statt leerem Formular", async () => {
  renderAt("/admin/events/gibt-es-nicht");
  expect(await screen.findByTestId("event-missing")).toHaveTextContent("Event nicht gefunden");
  expect(screen.queryByTestId("event-form")).toBeNull();
});
