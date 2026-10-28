import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Sticker bearbeiten (#2112): Name, Suchwörter und Reihenfolge lassen sich nachträglich ändern, das Bild nicht.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatApiError: (detail) => (typeof detail === "string" ? detail : ""),
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminStickersPage = (await import("./AdminStickersPage")).default;

const PACKS = [{
  id: "p-1", name: "Vereinsmomente", builtin: false, active: true,
  stickers: [{ id: "s-1", name: "Pokal", keywords: ["sieg", "gg"], url: "/api/static/uploads/a.png", sort_order: 3 }],
}];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: { packs: PACKS, source: null } });
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: { ok: true } });
  apiMock.post.mockReset();
  toastMock.error.mockReset();
});

test("ein Sticker lässt sich bearbeiten: Name, Suchwörter, Reihenfolge - ohne neues Bild", async () => {
  render(<AdminStickersPage />);
  fireEvent.click(await screen.findByTestId("sticker-edit-s-1"));
  const sheet = await screen.findByTestId("sticker-sheet");
  expect(within(sheet).queryByTestId("image-upload")).not.toBeInTheDocument();
  expect(screen.getByTestId("sticker-name")).toHaveValue("Pokal");
  expect(screen.getByTestId("sticker-keywords")).toHaveValue("sieg, gg");
  expect(screen.getByTestId("sticker-sort-order")).toHaveValue(3);

  fireEvent.change(screen.getByTestId("sticker-name"), { target: { value: "Großer Pokal" } });
  fireEvent.change(screen.getByTestId("sticker-keywords"), { target: { value: "sieg, meister" } });
  fireEvent.change(screen.getByTestId("sticker-sort-order"), { target: { value: "-2" } });
  fireEvent.click(screen.getByTestId("sticker-save"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/stickers/admin/stickers/s-1", {
    name: "Großer Pokal", keywords: ["sieg", "meister"], sort_order: -2,
  }));
  expect(apiMock.post).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByTestId("sticker-sheet")).not.toBeInTheDocument());
});

test("eine ungültige Reihenfolge wird gemeldet statt gespeichert", async () => {
  render(<AdminStickersPage />);
  fireEvent.click(await screen.findByTestId("sticker-edit-s-1"));
  fireEvent.change(await screen.findByTestId("sticker-sort-order"), { target: { value: "5000" } });
  fireEvent.click(screen.getByTestId("sticker-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Reihenfolge bitte als ganze Zahl zwischen -1000 und 1000."));
  expect(apiMock.patch).not.toHaveBeenCalled();
});
