import { act, createRef } from "react";
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

// ProseMirror misst beim Fokussieren die Auswahl - jsdom kann das nicht, also leere Maße.
const EMPTY_RECT = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
const { Range: DomRange } = window;
DomRange.prototype.getClientRects ??= () => [];
DomRange.prototype.getBoundingClientRect ??= () => EMPTY_RECT;

// @-Vorschläge im Editor (#937): Pfeil nach unten wählt den nächsten Vorschlag - das Loslassen der Taste setzt die Wahl
// nicht mehr auf den ersten zurück; Escape schließt die Liste und öffnet sie beim Loslassen nicht gleich wieder.
test("@-Vorschläge im Editor: Pfeil wählt weiter, Escape schließt", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/users/mention-search"
    ? { data: [{ id: "u1", username: "leo", display_name: "Leo" }, { id: "u2", username: "lea", display_name: "Lea" }] }
    : { data: { items: [], total: 0 } }));
  const ref = createRef();
  render(<ConfirmDialogProvider><MarkdownEditor ref={ref} value="" onChange={vi.fn()} /></ConfirmDialogProvider>);
  // Die Tasten gehen an die Hülle, die sie aus dem Editor sammelt - ProseMirror selbst misst in jsdom keine Zeilen.
  const wrap = screen.getByTestId("markdown-editor-visual").closest("[role='presentation']");
  act(() => ref.current.insertText("@le"));
  fireEvent.keyUp(wrap, { key: "e" });
  const options = await screen.findAllByRole("option");
  expect(options[0]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(wrap, { key: "ArrowDown" });
  fireEvent.keyUp(wrap, { key: "ArrowDown" });
  expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(wrap, { key: "Escape" });
  fireEvent.keyUp(wrap, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
});
