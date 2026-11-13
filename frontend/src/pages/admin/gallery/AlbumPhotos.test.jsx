import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Galerie (#2112): Beschriftung und Reihenfolge eines Mediums lassen sich nach dem Hochladen ändern.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  uploadApi: { post: vi.fn() },
  formatApiError: (detail) => detail || "Fehler",
  formatRequestError: (_err, fallback) => fallback,
  formatUploadError: (_err, fallback) => fallback,
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => null, prepareImageForUpload: async (file) => file }));
const confirmMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { AlbumPhotos } = await import("./AlbumPhotos");

const ALBUM = { id: "a-1", title: "Herbst-LAN", slug: "herbst-lan" };
const PHOTO = { id: "ph-1", album_id: "a-1", media_type: "image", source_type: "upload", image_url: "/api/static/uploads/x.webp",
  thumbnail_url: "/api/static/uploads/x.webp", caption: "IMG_0042", order_index: 3, section_id: null };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: { sections: [], photos: [PHOTO] } });
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: {} });
  toastMock.error.mockReset();
});

test("Beschriftung und Reihenfolge ändern", async () => {
  render(<AlbumPhotos album={ALBUM} onBack={() => {}} />);
  fireEvent.click(await screen.findByTestId("gallery-photo-edit-ph-1"));
  expect(screen.getByTestId("gallery-photo-caption")).toHaveValue("IMG_0042");
  expect(screen.getByTestId("gallery-photo-order")).toHaveValue(3);
  fireEvent.change(screen.getByTestId("gallery-photo-caption"), { target: { value: " Siegerehrung " } });
  fireEvent.change(screen.getByTestId("gallery-photo-order"), { target: { value: "1" } });
  fireEvent.click(screen.getByTestId("gallery-photo-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/gallery/photos/ph-1", { caption: "Siegerehrung", order_index: 1 }));
  await waitFor(() => expect(screen.queryByTestId("gallery-photo-sheet")).not.toBeInTheDocument());
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

// Häkchen-Auswahl und Suche (#2122).
const PHOTO_2 = { ...PHOTO, id: "ph-2", caption: "IMG_0043" };
const albumWith = (photos, sections = [{ id: "s-1", title: "Siegerehrung", order_index: 1 }]) => ({ data: { sections, photos } });

test("Häkchen: mehrere aus dem Album nehmen, mit Rückfrage und ehrlichem Text", async () => {
  apiMock.get.mockResolvedValue(albumWith([PHOTO, PHOTO_2]));
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { ok: true, count: 2 } });
  render(<AlbumPhotos album={ALBUM} onBack={() => {}} />);
  fireEvent.click(await screen.findByTestId("gallery-photo-check-ph-1"));
  expect(screen.getByTestId("gallery-bulk-count")).toHaveTextContent("1 von 2 ausgewählt");
  fireEvent.click(screen.getByTestId("gallery-bulk-all"));
  expect(screen.getByTestId("gallery-bulk-count")).toHaveTextContent("2 von 2 ausgewählt");

  fireEvent.click(screen.getByTestId("gallery-bulk-remove"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/gallery/a-1/photos/bulk", { ids: ["ph-1", "ph-2"], action: "delete" }));
  const asked = confirmMock.mock.calls.at(-1)[0];
  expect(asked.title).toBe("2 Einträge aus dem Album nehmen?");
  expect(asked.description).toContain("Dateien bleiben in den Medien");
  await waitFor(() => expect(screen.getByTestId("gallery-bulk-count")).toHaveTextContent("0 von 2 ausgewählt"));
});

test("Häkchen: Auswahl in einen Abschnitt verschieben", async () => {
  apiMock.get.mockResolvedValue(albumWith([PHOTO, PHOTO_2]));
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { ok: true, count: 1 } });
  render(<AlbumPhotos album={ALBUM} onBack={() => {}} />);
  fireEvent.click(await screen.findByTestId("gallery-photo-check-ph-2"));
  fireEvent.change(screen.getByTestId("gallery-bulk-move"), { target: { value: "s-1" } });
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/gallery/a-1/photos/bulk", { ids: ["ph-2"], action: "move", section_id: "s-1" }));
  expect(confirmMock.mock.calls.at(-1)[0].description).toContain("Siegerehrung");
});

test("die Medienauswahl sucht am Server und behält die Auswahl über die Suche hinweg", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/admin/media")) {
      return { data: url.includes("q=uralt")
        ? { items: [{ filename: "uralt.webp", url: "/api/static/uploads/uralt.webp", media_type: "image" }], total: 1 }
        : { items: [{ filename: "neu.webp", url: "/api/static/uploads/neu.webp", media_type: "image" }], total: 2 } };
    }
    return albumWith([PHOTO]);
  });
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: {} });
  render(<AlbumPhotos album={ALBUM} onBack={() => {}} />);
  fireEvent.click(await screen.findByTestId("photo-media-picker"));
  fireEvent.click(await screen.findByTitle("neu.webp"));
  fireEvent.change(screen.getByTestId("gallery-media-search"), { target: { value: "uralt" } });
  fireEvent.click(await screen.findByTitle("uralt.webp"));
  expect(screen.getByText("2 ausgewählt")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("photo-media-add"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
});

test("eine Reihenfolge, die keine ganze Zahl ist, wird gemeldet", async () => {
  render(<AlbumPhotos album={ALBUM} onBack={() => {}} />);
  fireEvent.click(await screen.findByTestId("gallery-photo-edit-ph-1"));
  fireEvent.change(screen.getByTestId("gallery-photo-order"), { target: { value: "1.5" } });
  fireEvent.click(screen.getByTestId("gallery-photo-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Reihenfolge bitte als ganze Zahl."));
  expect(apiMock.patch).not.toHaveBeenCalled();
});

// Tastatur (#937): die Medienauswahl ist ein echter Dialog - Fokus hinein, Tab bleibt drin, Leertaste wählt (und sagt
// „ausgewählt“), Escape schließt und gibt den Fokus an den Knopf zurück; der Klick daneben schließt weiter.
test("Medienauswahl per Tastatur: Fokus im Dialog, Leertaste wählt, Escape schließt mit Fokus zurück", async () => {
  apiMock.get.mockImplementation(async (url) => (url.startsWith("/admin/media")
    ? { data: { items: [{ filename: "neu.webp", url: "/api/static/uploads/neu.webp", media_type: "image" }], total: 1 } }
    : albumWith([PHOTO])));
  const user = userEvent.setup();
  render(<AlbumPhotos album={ALBUM} onBack={() => {}} />);
  const opener = await screen.findByTestId("photo-media-picker");
  opener.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "Medienbibliothek" });
  expect(dialog).toContainElement(document.activeElement);
  const tile = await screen.findByTitle("neu.webp");
  tile.focus();
  await user.keyboard(" ");
  expect(tile).toHaveAttribute("aria-pressed", "true");
  for (let i = 0; i < 8; i += 1) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement);
  }
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Medienbibliothek" })).toBeNull();
  expect(opener).toHaveFocus();
});

test("Medienauswahl: Klick daneben schließt, ein Klick im Fenster nicht", async () => {
  apiMock.get.mockImplementation(async (url) => (url.startsWith("/admin/media") ? { data: { items: [], total: 0 } } : albumWith([PHOTO])));
  render(<AlbumPhotos album={ALBUM} onBack={() => {}} />);
  fireEvent.click(await screen.findByTestId("photo-media-picker"));
  fireEvent.click(screen.getByRole("heading", { name: "Medienbibliothek" }));
  expect(screen.getByRole("dialog", { name: "Medienbibliothek" })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("photo-media-backdrop"));
  expect(screen.queryByRole("dialog", { name: "Medienbibliothek" })).toBeNull();
});
