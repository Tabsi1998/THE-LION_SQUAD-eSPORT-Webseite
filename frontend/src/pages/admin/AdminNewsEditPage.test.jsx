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
// Verteilen (#1359): der Kasten fragt vor dem Senden nach.
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

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

// Personen markieren (#1354): die Treffer kommen aus der Erwähnungs-Suche, nicht aus der ganzen Kontoliste; schon
// markierte Personen stehen mit Namen da, weil die Admin-Liste sie mitliefert.
test("Personen markieren über die Suche – die ganze Kontoliste wird nie geladen", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news-meta") return { data: META };
    if (url === "/admin/news") return { data: [{ ...POSTS[0], mentioned_user_ids: ["u-1"], mentioned_users: [{ id: "u-1", username: "erika", display_name: "Erika Beispiel" }] }] };
    if (url === "/users/mention-search") return { data: [{ id: "u-2", username: "max", display_name: "Max Muster" }] };
    return { data: [] };
  });
  renderAt("/admin/news/n1");
  expect(await screen.findByText("Erika Beispiel")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("news-mention-search"), { target: { value: "max" } });
  fireEvent.click(await screen.findByRole("button", { name: /Max Muster/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Max Muster entfernen" })).toBeInTheDocument());
  expect(apiMock.get.mock.calls.map(([url]) => url)).not.toContain("/users");
  expect(apiMock.get).toHaveBeenCalledWith("/users/mention-search", { params: { q: "max" } });
});

// Verteilen (#1359): der Kasten im Editor nennt nur die Zahl der Empfänger und sendet nach einer Rückfrage.
const BOX = { kind: "news", source_id: "n1", title: "Cup abgesagt", visibility: "public", state: "ready", recipients: 214, sent_at: null, sent_count: 0,
  can_send: true, can_resend: true, announcement: "Keine eigene Meldung – öffentliche Beiträge gehen über Newsletter und Discord." };

function mockWithBox(box) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news-meta") return { data: META };
    if (url === "/admin/news") return { data: POSTS };
    if (url === "/settings/newsletter/state") {
      if (box instanceof Error) throw box;
      return { data: box };
    }
    return { data: [] };
  });
}

test("Verteilen: nicht gesendet – „Jetzt senden“ mit Rückfrage, danach „gesendet am … an …“", async () => {
  mockWithBox(BOX);
  apiMock.post.mockResolvedValue({ data: { ok: true, queued: 214 } });
  renderAt("/admin/news/n1");
  expect(await screen.findByTestId("distribute-newsletter-line")).toHaveTextContent("Noch nicht verschickt – geht an 214 Personen mit Newsletter-Zustimmung.");
  expect(screen.getByTestId("distribute-box")).toContainElement(screen.getByTestId("discord-preview"));
  mockWithBox({ ...BOX, state: "sent", sent_at: "2026-10-12T16:00:00+00:00", sent_count: 214 });
  fireEvent.click(screen.getByTestId("distribute-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/newsletter/send", { kind: "news", id: "n1", force: false }));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Newsletter jetzt senden?", description: expect.stringContaining("214 Personen") }));
  expect(await screen.findByTestId("distribute-newsletter-line")).toHaveTextContent("Gesendet am 12.10.2026");
  expect(screen.getByTestId("distribute-newsletter-line")).toHaveTextContent("an 214 Personen.");
  expect(screen.getByTestId("distribute-resend")).toBeInTheDocument();
});

test("Verteilen: ohne Recht steht ein Satz statt des Knopfs", async () => {
  mockWithBox(Object.assign(new Error("verboten"), { response: { status: 403 } }));
  renderAt("/admin/news/n1");
  expect(await screen.findByTestId("distribute-error")).toHaveTextContent("Den Newsletter verschickt die Redaktion");
  expect(screen.queryByTestId("distribute-send")).toBeNull();
});
