import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Fast Lap bearbeiten (#434): die Einstellungen liegen im Formular-Rahmen (Inhalt links,
// Veröffentlichung rechts, Speichern-Leiste unten) und schicken nur die Änderung.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/lib/api", () => ({
  API: "http://test.local/api",
  api: apiMock,
  formatRequestError: (_err, fallback) => fallback,
  parseTimeStr: (value) => value,
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: ({ testId }) => <textarea data-testid={testId} readOnly /> }));
vi.mock("@/components/tls/AccessLinksPanel", () => ({ AccessLinksPanel: () => <div data-testid="access-links" /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminF1EditPage = (await import("./AdminF1EditPage")).default;

const CHALLENGE = { id: "c-1", slug: "monza", title: "Monza Sprint", status: "draft", visibility: "public", tracks: [], platform: "PS5" };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/f1/c-1"]}>
      <Routes><Route path="/admin/f1/:id" element={<AdminF1EditPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (String(url).startsWith("/f1/challenges/c-1?")) return { data: CHALLENGE };
    return { data: [] };
  });
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: CHALLENGE });
  toastMock.info.mockReset();
});

test("die Einstellungen stehen im Rahmen: Inhalt links, Veröffentlichung rechts, Speichern-Leiste", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { name: "Monza Sprint" })).toBeInTheDocument();
  const settings = screen.getByTestId("f1-edit-settings");
  expect(settings).toContainElement(screen.getByTestId("admin-form-main"));
  expect(screen.getByTestId("admin-form-aside")).toContainElement(screen.getByTestId("f1-edit-visibility"));
  expect(screen.getByTestId("f1-edit-title")).toHaveValue("Monza Sprint");
  expect(screen.getByTestId("f1-edit-save")).toBeInTheDocument();
});

test("Speichern schickt nur die Änderung; ohne Änderung nur ein Hinweis", async () => {
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });

  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Keine Änderungen zum Speichern."));
  expect(apiMock.patch).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("f1-edit-title"), { target: { value: "Monza Sprint 2026" } });
  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [url, patch] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/f1/challenges/c-1");
  expect(patch).toEqual(expect.objectContaining({ title: "Monza Sprint 2026" }));
  expect(patch).not.toHaveProperty("visibility");
});

test("Neue Strecke mit Zielzeit (#613): der Text wird zu Millisekunden, leer heißt keine Zielzeit, Unsinn wird gemeldet", async () => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { id: "tr-1" } });
  toastMock.error.mockReset();
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  fireEvent.change(screen.getByTestId("f1-new-track-name"), { target: { value: "Monza" } });
  fireEvent.change(screen.getByTestId("f1-new-track-target"), { target: { value: "1:32,450" } });
  fireEvent.click(screen.getByTestId("f1-add-track-btn"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
  const [url, body] = apiMock.post.mock.calls[0];
  expect(url).toBe("/f1/challenges/c-1/tracks");
  expect(body).toEqual(expect.objectContaining({ name: "Monza", target_time_ms: 92450, order_index: 0 }));
  expect(body).not.toHaveProperty("target_time");
  // Nach dem Speichern ist das Formular leer; ohne Zielzeit geht null mit.
  expect(screen.getByTestId("f1-new-track-target")).toHaveValue("");
  fireEvent.change(screen.getByTestId("f1-new-track-name"), { target: { value: "Spa" } });
  fireEvent.click(screen.getByTestId("f1-add-track-btn"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
  expect(apiMock.post.mock.calls[1][1]).toEqual(expect.objectContaining({ name: "Spa", target_time_ms: null }));
  // Unlesbare Zielzeit: Hinweis, kein Aufruf.
  fireEvent.change(screen.getByTestId("f1-new-track-name"), { target: { value: "Suzuka" } });
  fireEvent.change(screen.getByTestId("f1-new-track-target"), { target: { value: "schnell" } });
  fireEvent.click(screen.getByTestId("f1-add-track-btn"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Zielzeit bitte als m:ss.mmm angeben, z. B. 1:32.450."));
  expect(apiMock.post).toHaveBeenCalledTimes(2);
});
