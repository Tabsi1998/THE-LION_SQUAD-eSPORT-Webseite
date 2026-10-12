import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Eingesandte Fotos (#1186): Admin → Galerie ist der eine Ort für die Freigabe. Der Vorstand (Vereinsverwaltung) sieht
// dort nur die Einsendungen, die Redaktion dazu die Alben. Freigeben geht erst nach der Bildprüfung; Ablehnen fragt
// nach einem freiwilligen Grund.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
const authState = { user: null };
const promptMock = vi.fn();
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", resolveMediaUrl: (value) => value || "", API_BASE: "" }));
vi.mock("@/lib/chatAttachments", () => ({ chatAttachmentSrc: (url, width) => `${url}?w=${width}` }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true, usePrompt: () => promptMock }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./gallery/AlbumModal", () => ({ AlbumModal: () => null }));
vi.mock("./gallery/AlbumPhotos", () => ({ AlbumPhotos: () => null }));

const { default: AdminGalleryPage } = await import("./AdminGalleryPage");
const { groupSubmissions } = await import("./gallery/SubmissionQueue");

const queue = [
  { id: "s1", album_id: "a1", album_title: "Herbst-LAN Fotos", event_name: "Herbst-LAN", owner_name: "Anna", credit: true, scan_state: "safe", image_url: "/api/gallery/submissions/s1/image", created_at: "2026-10-12T10:00:00Z" },
  { id: "s2", album_id: "a1", album_title: "Herbst-LAN Fotos", event_name: "Herbst-LAN", owner_name: "Bert", credit: false, scan_state: "safe", image_url: "/api/gallery/submissions/s2/image", created_at: "2026-10-12T10:05:00Z" },
  { id: "s3", album_id: "a1", album_title: "Herbst-LAN Fotos", event_name: "Herbst-LAN", owner_name: "Cleo", credit: true, scan_state: "review", image_url: "/api/gallery/submissions/s3/image", created_at: "2026-10-12T10:06:00Z" },
];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  promptMock.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/gallery-submissions") return { data: queue };
    if (url === "/admin/gallery") return { data: [{ id: "a1", title: "Herbst-LAN Fotos", visibility: "public", published: true, media_count: 4 }] };
    return { data: [] };
  });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
});

test("Einsendungen nach Album, mit Name und „Foto: Name“; erst nach der Bildprüfung freigebbar", async () => {
  authState.user = { role: "user", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };
  render(<MemoryRouter><AdminGalleryPage /></MemoryRouter>);
  expect(await screen.findByTestId("gallery-submissions")).toHaveTextContent("3 warten auf Freigabe");
  expect(screen.getByTestId("submission-group-a1")).toHaveTextContent("Event: Herbst-LAN");
  expect(screen.getByTestId("submission-s1")).toHaveTextContent("Zeigt „Foto: Anna“");
  expect(screen.getByTestId("submission-s2")).toHaveTextContent("Ohne Namen");
  expect(screen.getByTestId("submission-approve-s3")).toBeDisabled();
  expect(screen.getByTestId("submission-s3")).toHaveTextContent("Bei der Moderation");
  // Die Redaktion pflegt auch die Alben.
  expect(await screen.findByTestId("album-new")).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("submission-approve-all-a1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/gallery-submissions/decide", { ids: ["s1", "s2"], action: "approve", reason: null }));
});

test("Ablehnen fragt nach dem Grund; Abbrechen schickt nichts", async () => {
  authState.user = { role: "user", areas: ["club"], mfa_enabled: true, auth_mfa_verified: true };
  render(<MemoryRouter><AdminGalleryPage /></MemoryRouter>);
  await screen.findByTestId("gallery-submissions");
  // Der Vorstand sieht nur die Einsendungen - keine Alben-Verwaltung.
  expect(screen.queryByTestId("album-new")).toBeNull();
  expect(apiMock.get.mock.calls.map(([url]) => url)).not.toContain("/admin/gallery");

  promptMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("submission-reject-s1"));
  await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1));
  expect(apiMock.post).not.toHaveBeenCalled();

  promptMock.mockResolvedValueOnce("unscharf");
  fireEvent.click(screen.getByTestId("submission-reject-s1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/gallery-submissions/decide", { ids: ["s1"], action: "reject", reason: "unscharf" }));
});

test("nichts offen: ein Satz statt einer leeren Liste", async () => {
  authState.user = { role: "user", areas: ["club"], mfa_enabled: true, auth_mfa_verified: true };
  apiMock.get.mockImplementation(async () => ({ data: [] }));
  render(<MemoryRouter><AdminGalleryPage /></MemoryRouter>);
  expect(await screen.findByTestId("gallery-submissions")).toHaveTextContent("nichts offen");
  expect(groupSubmissions(queue).map((group) => group.items.length)).toEqual([3]);
});
