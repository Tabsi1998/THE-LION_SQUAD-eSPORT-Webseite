import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
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

test("eine Reihenfolge, die keine ganze Zahl ist, wird gemeldet", async () => {
  render(<AlbumPhotos album={ALBUM} onBack={() => {}} />);
  fireEvent.click(await screen.findByTestId("gallery-photo-edit-ph-1"));
  fireEvent.change(screen.getByTestId("gallery-photo-order"), { target: { value: "1.5" } });
  fireEvent.click(screen.getByTestId("gallery-photo-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Reihenfolge bitte als ganze Zahl."));
  expect(apiMock.patch).not.toHaveBeenCalled();
});
