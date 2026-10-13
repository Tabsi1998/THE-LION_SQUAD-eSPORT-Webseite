import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Profilbild zuschneiden (#1459): Datei wählen → Zuschnitt-Dialog (runde Vorschau, Zoom, Verschieben) → Übernehmen
// lädt ein quadratisches Bild über den bestehenden Weg (`/uploads/image`) hoch. Abbrechen lädt nichts hoch.

const { apiMock, toastMock } = vi.hoisted(() => ({
  apiMock: { post: vi.fn(), get: vi.fn() },
  toastMock: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || ""), resolveMediaUrl: (value) => value || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/lib/uploadDiagnostics", () => ({ logUploadClientFailure: vi.fn() }));

const { ImageUpload } = await import("./ImageUpload");

let drawCalls;
let canvases;

beforeEach(() => {
  vi.clearAllMocks();
  drawCalls = [];
  canvases = [];
  URL.createObjectURL = vi.fn(() => "blob:http://localhost:3000/5d2b8c1e-7f3a-4e6b-9a0d-2c4f6e8a1b3c");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext() {
    canvases.push(this);
    return { drawImage: (...args) => drawCalls.push(args), fillRect: vi.fn(), fillStyle: "", imageSmoothingQuality: "" };
  });
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
    callback(new Blob(["zugeschnitten"], { type }));
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete HTMLCanvasElement.prototype.toBlob;
});

async function openCrop({ width = 1200, height = 800 } = {}) {
  const onChange = vi.fn();
  render(<ImageUpload value="" onChange={onChange} testId="profile-avatar" variant="square" crop="round" />);
  const file = new File(["foto"], "ich.png", { type: "image/png" });
  await act(async () => {
    fireEvent.change(screen.getByTestId("profile-avatar-file"), { target: { files: [file] } });
  });
  const dialog = await screen.findByRole("dialog", { name: "Profilbild zuschneiden" });
  const view = screen.getByTestId("profile-avatar-crop-view");
  const img = view.querySelector("img");
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(img);
  return { onChange, dialog, view };
}

test("Datei wählen öffnet den Zuschnitt; Fokus auf dem Ausschnitt, Regler beschriftet", async () => {
  const { view } = await openCrop();
  expect(view).toHaveFocus();
  expect(screen.getByRole("slider", { name: "Zoom" })).toHaveValue("1");
  expect(screen.getByRole("button", { name: "Übernehmen" })).toBeEnabled();
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Übernehmen lädt ein quadratisches WebP über den bestehenden Upload hoch", async () => {
  apiMock.post.mockResolvedValue({ data: { url: "/api/static/uploads/ich.webp" } });
  const { onChange, view } = await openCrop();
  fireEvent.keyDown(view, { key: "+" });
  fireEvent.keyDown(view, { key: "+" });
  fireEvent.keyDown(view, { key: "ArrowRight", shiftKey: true });
  expect(Number(screen.getByRole("slider", { name: "Zoom" }).value)).toBeGreaterThan(1.3);

  fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith("/api/static/uploads/ich.webp"));

  const [endpoint, form] = apiMock.post.mock.calls[0];
  expect(endpoint).toBe("/uploads/image");
  const uploaded = form.get("file");
  expect(uploaded.type).toBe("image/webp");
  expect(uploaded.name).toBe("ich.webp");

  const canvas = canvases[0];
  expect(canvas.width).toBe(512);
  expect(canvas.height).toBe(512);
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = drawCalls[0];
  expect(sw).toBeCloseTo(sh);
  expect([dx, dy, dw, dh]).toEqual([0, 0, 512, 512]);
  // Nie über das Bild hinaus: keine leeren Ränder.
  expect(sx).toBeGreaterThanOrEqual(0);
  expect(sy).toBeGreaterThanOrEqual(0);
  expect(sx + sw).toBeLessThanOrEqual(1200);
  expect(sy + sh).toBeLessThanOrEqual(800);
  expect(sw).toBeLessThan(800);

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Profilbild zuschneiden" })).not.toBeInTheDocument());
});

test("Ohne WebP im Browser: JPEG, weiterhin quadratisch", async () => {
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
    callback(new Blob(["x"], { type: type === "image/webp" ? "image/png" : type }));
  };
  apiMock.post.mockResolvedValue({ data: { url: "/api/static/uploads/ich.jpg" } });
  await openCrop({ width: 300, height: 900 });
  fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const uploaded = apiMock.post.mock.calls[0][1].get("file");
  expect(uploaded.type).toBe("image/jpeg");
  const last = canvases[canvases.length - 1];
  expect(last.width).toBe(300);
  expect(last.height).toBe(300);
});

test("Abbrechen schließt ohne Hochladen", async () => {
  await openCrop();
  fireEvent.click(screen.getByTestId("profile-avatar-crop-cancel"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Escape schließt ohne Hochladen", async () => {
  await openCrop();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Ziehen verschiebt, der Ausschnitt bleibt im Bild", async () => {
  apiMock.post.mockResolvedValue({ data: { url: "/x.webp" } });
  const { view } = await openCrop();
  view.getBoundingClientRect = () => ({ width: 320, height: 320, left: 0, top: 0, right: 320, bottom: 320, x: 0, y: 0 });
  fireEvent.pointerDown(view, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(view, { pointerId: 1, clientX: 5000, clientY: 100 });
  fireEvent.pointerUp(view, { pointerId: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const [, sx, , sw] = drawCalls[0];
  // Ganz nach rechts gezogen = linker Bildrand.
  expect(sx).toBe(0);
  expect(sw).toBe(800);
});

test("Vorschau übernimmt nur Blob-Adressen: eine andere Adresse wird nicht gesetzt", async () => {
  const { AvatarCropDialog } = await import("./AvatarCropDialog");
  URL.createObjectURL = vi.fn(() => "javascript:alert(1)");
  const onLoadError = vi.fn();
  render(<AvatarCropDialog file={new File(["foto"], "ich.png", { type: "image/png" })} onCancel={vi.fn()} onApply={vi.fn()} onLoadError={onLoadError} />);
  await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("avatar-crop-view").querySelector("img")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("javascript:alert(1)");
});
