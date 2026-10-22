import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

// Logos als SVG (#1952): Logo-Felder (`logo`) bieten SVG an, laden es ohne Zuschnitt hoch (der Server bereinigt es)
// und zeigen das Logo auf hellem und dunklem Grund. Alle anderen Bildfelder bleiben ohne SVG.

const { apiMock, toastMock } = vi.hoisted(() => ({
  apiMock: { post: vi.fn(), get: vi.fn() },
  toastMock: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || ""), resolveMediaUrl: (value) => value || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/lib/uploadDiagnostics", () => ({ logUploadClientFailure: vi.fn() }));

const { ImageUpload, LOGO_HINT, SVG_REFUSED_MESSAGE } = await import("./ImageUpload");

const SVG_FILE = () => new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'], "logo.svg", { type: "image/svg+xml" });

beforeEach(() => {
  vi.clearAllMocks();
});

async function pick(testId, file) {
  await act(async () => {
    fireEvent.change(screen.getByTestId(`${testId}-file`), { target: { files: [file] } });
  });
}

test("ein Logo-Feld bietet SVG an und lädt es ohne Zuschnitt hoch", async () => {
  apiMock.post.mockResolvedValue({ data: { url: "/api/static/uploads/kiwi.svg" } });
  const onChange = vi.fn();
  render(<ImageUpload value="" onChange={onChange} testId="team-logo" variant="square" crop="square" logo />);
  expect(screen.getByTestId("team-logo-file").getAttribute("accept")).toContain("image/svg+xml");
  expect(screen.getByTestId("team-logo-hint")).toHaveTextContent(LOGO_HINT);
  await pick("team-logo", SVG_FILE());
  await waitFor(() => expect(onChange).toHaveBeenCalledWith("/api/static/uploads/kiwi.svg"));
  const [endpoint, form] = apiMock.post.mock.calls[0];
  expect(endpoint).toBe("/uploads/image?allow_svg=true");
  expect(form.get("file").name).toBe("logo.svg");
  expect(screen.queryByText("Bild bearbeiten")).not.toBeInTheDocument();
});

test("der Logo-Upload sagt dem Server, dass SVG hier geht", async () => {
  apiMock.post.mockResolvedValue({ data: { url: "/api/static/uploads/kiwi.svg" } });
  render(<ImageUpload value="" onChange={vi.fn()} testId="partner-logo" endpoint="/uploads/logo" logo />);
  await pick("partner-logo", SVG_FILE());
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(apiMock.post.mock.calls[0][0]).toBe("/uploads/logo?allow_svg=true");
});

test("Fotos, Avatare und Banner bleiben ohne SVG", async () => {
  render(<ImageUpload value="" onChange={vi.fn()} testId="profile-banner" variant="wide" />);
  expect(screen.getByTestId("profile-banner-file").getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
  expect(screen.getByTestId("profile-banner-hint")).toHaveTextContent("SVG geht nicht.");
  await pick("profile-banner", SVG_FILE());
  expect(toastMock.error).toHaveBeenCalledWith(SVG_REFUSED_MESSAGE);
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("ein zu großes SVG wird gleich im Browser abgewiesen", async () => {
  render(<ImageUpload value="" onChange={vi.fn()} testId="game-logo" logo />);
  const big = new File(["x".repeat(1024 * 1024 + 1)], "riesig.svg", { type: "image/svg+xml" });
  await pick("game-logo", big);
  expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("höchstens 1 MB"));
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("ein gesetztes Logo steht zur Vorschau auf hellem und dunklem Grund", () => {
  render(<ImageUpload value="/api/static/uploads/kiwi.svg" onChange={vi.fn()} testId="sponsor-logo" logo />);
  expect(screen.getByTestId("sponsor-logo-light").querySelector("img")).toHaveAttribute("src", "/api/static/uploads/kiwi.svg");
  expect(screen.getByTestId("sponsor-logo-dark").querySelector("img")).toHaveAttribute("src", "/api/static/uploads/kiwi.svg");
});

test("die Mediathek zeigt SVG nur in Logo-Feldern", async () => {
  apiMock.get.mockResolvedValue({ data: [
    { filename: "kiwi.svg", url: "/api/static/uploads/kiwi.svg" },
    { filename: "foto.webp", url: "/api/static/uploads/foto.webp" },
  ] });
  const { unmount } = render(<ImageUpload value="" onChange={vi.fn()} testId="avatar" allowLibrary />);
  await act(async () => fireEvent.click(screen.getByTestId("avatar-library")));
  await waitFor(() => expect(screen.getByTitle("foto.webp")).toBeInTheDocument());
  expect(screen.queryByTitle("kiwi.svg")).not.toBeInTheDocument();
  unmount();
  render(<ImageUpload value="" onChange={vi.fn()} testId="brand-logo" allowLibrary logo />);
  await act(async () => fireEvent.click(screen.getByTestId("brand-logo-library")));
  await waitFor(() => expect(screen.getByTitle("kiwi.svg")).toBeInTheDocument());
});

test("die Vorschau zeigt ein geladenes Logo und lädt ein neues wieder", () => {
  const { rerender } = render(<ImageUpload value="/api/static/uploads/kiwi.svg" onChange={vi.fn()} testId="brand-logo" logo />);
  const preview = screen.getByTestId("brand-logo-preview");
  fireEvent.load(preview.querySelector("img"));
  expect(preview).not.toHaveTextContent("Lade Vorschau");
  expect(preview.querySelector("img").className).toContain("opacity-100");
  rerender(<ImageUpload value="/api/static/uploads/ananas.svg" onChange={vi.fn()} testId="brand-logo" logo />);
  expect(screen.getByTestId("brand-logo-preview")).toHaveTextContent("Lade Vorschau");
});