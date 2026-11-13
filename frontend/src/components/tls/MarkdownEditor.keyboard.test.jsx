import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

// Tastatur (#937): „Bild einfügen“ ist ein echter Dialog - der Fokus springt hinein und bleibt darin, Escape schließt
// und gibt ihn an den Werkzeugknopf zurück. Der Klick daneben schließt weiter, ein Klick im Dialog nicht.

const { apiMock } = vi.hoisted(() => ({ apiMock: { post: vi.fn(), get: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || ""), resolveMediaUrl: (value) => value || "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { MarkdownEditor } = await import("./MarkdownEditor");
const { ConfirmDialogProvider } = await import("./ConfirmDialog");

const renderEditor = () => render(<ConfirmDialogProvider><MarkdownEditor value="" onChange={vi.fn()} /></ConfirmDialogProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: { items: [], total: 0 } });
});

test("„Bild einfügen“ per Tastatur: Fokus im Dialog, Tab bleibt drin, Escape schließt mit Fokus zurück", async () => {
  const user = userEvent.setup();
  renderEditor();
  const opener = screen.getByTitle("Bild aus Medienbibliothek");
  opener.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "Bild einfügen" });
  expect(dialog).toContainElement(document.activeElement);
  for (let i = 0; i < 5; i += 1) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement);
  }
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
});

test("Klick daneben schließt „Bild einfügen“, ein Klick darin nicht", () => {
  renderEditor();
  fireEvent.click(screen.getByTitle("Bild aus Medienbibliothek"));
  fireEvent.click(screen.getByRole("heading", { name: "Bild einfügen" }));
  expect(screen.getByRole("dialog", { name: "Bild einfügen" })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("markdown-media-backdrop"));
  expect(screen.queryByRole("dialog")).toBeNull();
});
