import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Beitrag als eigene Seite (#434): Anlegen unter /admin/news/new, Bearbeiten unter /admin/news/:id
// mit den Daten aus der Admin-Liste; Speichern führt zurück zur Liste.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/DiscordPreview", () => ({ DiscordPreview: () => <div data-testid="discord-preview" /> }));
vi.mock("@/components/tls/SharePreviewToggle", () => ({ SharePreviewToggle: () => null }));
vi.mock("@/components/tls/EditorialChecklist", () => ({ EditorialChecklist: () => <div data-testid="checklist" /> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: ({ testId }) => <textarea data-testid={testId} readOnly /> }));
vi.mock("@/components/tls/SeoPreviewPanel", () => ({ SeoPreviewPanel: () => <div data-testid="seo-preview" /> }));
vi.mock("@/components/tls/RichContent", () => ({ appendEmbedToken: (text) => text }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const AdminNewsEditPage = (await import("./AdminNewsEditPage")).default;

const META = {
  categories: [{ k: "club", l: "Verein" }, { k: "announcement", l: "Ankündigung" }],
  visibilities: [{ k: "public", l: "Öffentlich" }, { k: "members", l: "Mitglieder" }],
};
const POSTS = [
  { id: "n1", title: "Cup abgesagt", slug: "cup-abgesagt", excerpt: "Zu wenige Anmeldungen.", content: "Text", category: "announcement", visibility: "public", published: true, linked_event_ids: ["ev-1"] },
];

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/news" element={<div data-testid="news-list" />} />
        <Route path="/admin/news/new" element={<AdminNewsEditPage />} />
        <Route path="/admin/news/:id" element={<AdminNewsEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news-meta") return { data: META };
    if (url === "/admin/news") return { data: POSTS };
    return { data: [] };
  });
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
});

test("Neuer Beitrag: Seite mit Veröffentlichung rechts, Slug aus dem Titel, Speichern legt an", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "n2" } });
  renderAt("/admin/news/new");
  expect(await screen.findByRole("heading", { name: "Neuer Beitrag" })).toBeInTheDocument();
  expect(screen.getByTestId("admin-form-aside")).toContainElement(screen.getByTestId("news-category"));
  expect(screen.getByTestId("checklist")).toBeInTheDocument();
  expect(await screen.findByRole("option", { name: "Ankündigung" })).toBeInTheDocument();

  fireEvent.change(screen.getByTestId("news-title"), { target: { value: "Weihnachtsfeier: Anmeldung offen" } });
  expect(screen.getByTestId("news-slug")).toHaveValue("weihnachtsfeier-anmeldung-offen");
  fireEvent.submit(screen.getByTestId("news-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/news", expect.objectContaining({ title: "Weihnachtsfeier: Anmeldung offen", slug: "weihnachtsfeier-anmeldung-offen", published: true, linked_event_ids: [] })));
  expect(await screen.findByTestId("news-list")).toBeInTheDocument();
});

test("Bearbeiten lädt den Beitrag aus der Admin-Liste und schickt nur die Änderung", async () => {
  apiMock.patch.mockResolvedValue({ data: { ...POSTS[0], excerpt: "Neuer Termin 2027." } });
  renderAt("/admin/news/n1");
  expect(await screen.findByRole("heading", { name: "Beitrag bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("news-title")).toHaveValue("Cup abgesagt");
  expect(screen.getByTestId("news-category")).toHaveValue("announcement");

  fireEvent.change(screen.getByTestId("news-excerpt"), { target: { value: "Neuer Termin 2027." } });
  fireEvent.submit(screen.getByTestId("news-form"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [url, patch] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/news/n1");
  expect(patch).toEqual(expect.objectContaining({ excerpt: "Neuer Termin 2027." }));
  expect(patch).not.toHaveProperty("title");
  expect(await screen.findByTestId("news-list")).toBeInTheDocument();
});

test("unbekannte Kennung: Hinweis mit Weg zurück", async () => {
  renderAt("/admin/news/gibt-es-nicht");
  expect(await screen.findByTestId("news-missing")).toHaveTextContent("Beitrag nicht gefunden");
});
