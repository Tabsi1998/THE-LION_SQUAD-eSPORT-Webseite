import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

// Tastatur (#937): die Medienbibliothek ist ein echter Dialog - Enter öffnet, der Fokus springt hinein und bleibt
// darin, Escape schließt und gibt den Fokus an „Medien wählen“ zurück. Der Klick daneben schließt weiter, ein Klick im
// Dialog nicht.

const { apiMock } = vi.hoisted(() => ({ apiMock: { post: vi.fn(), get: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => {
  const { formatUploadError } = await importOriginal();
  return { api: apiMock, formatApiError: (detail) => String(detail || ""), formatUploadError, resolveMediaUrl: (value) => value || "" };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/lib/uploadDiagnostics", () => ({ logUploadClientFailure: vi.fn() }));

const { ImageUpload } = await import("./ImageUpload");

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: { items: [{ filename: "a.png", url: "/uploads/a.png" }], total: 1 } });
});

test("Medienbibliothek per Tastatur: Enter öffnet, Tab bleibt drin, Escape schließt mit Fokus zurück", async () => {
  const user = userEvent.setup();
  render(<ImageUpload value="" onChange={vi.fn()} testId="cover" allowLibrary />);
  const opener = screen.getByTestId("cover-library");
  opener.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "Medienbibliothek" });
  expect(dialog).toContainElement(document.activeElement);
  await screen.findByTitle("a.png");
  for (let i = 0; i < 6; i += 1) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement);
  }
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
});

test("Klick daneben schließt die Medienbibliothek, ein Klick darin nicht", async () => {
  render(<ImageUpload value="" onChange={vi.fn()} testId="cover" allowLibrary />);
  fireEvent.click(screen.getByTestId("cover-library"));
  fireEvent.click(screen.getByRole("heading", { name: "Medienbibliothek" }));
  expect(screen.getByRole("dialog", { name: "Medienbibliothek" })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("cover-library-backdrop"));
  expect(screen.queryByRole("dialog")).toBeNull();
});
