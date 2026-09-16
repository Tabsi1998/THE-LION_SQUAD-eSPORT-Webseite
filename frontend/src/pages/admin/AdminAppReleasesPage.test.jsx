import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// App-Versionen (#250): Liste der Releases am Server, aktuelles markieren,
// Pflicht-Grenze setzen, APK von Hand hochladen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminAppReleasesPage = (await import("./AdminAppReleasesPage")).default;
const { formatSize } = await import("./AdminAppReleasesPage");

const RELEASES = [
  { build: 63, version: "0.5.0-beta", size: 52_428_800, sha256: "abcdef1234567890", published_at: "2026-09-17T10:00:00Z", min_build: null, is_current: true, download_url: "/api/mobile/app-download/63" },
  { build: 62, version: "0.4.1-beta", size: 51_000_000, sha256: "1234567890abcdef", published_at: "2026-09-16T10:00:00Z", min_build: 60, is_current: false, download_url: "/api/mobile/app-download/62" },
];

let tokenStatus = { configured: true, length: 48, min_length: 24, env: "APP_RELEASE_UPLOAD_TOKEN" };

beforeEach(() => {
  vi.clearAllMocks();
  tokenStatus = { configured: true, length: 48, min_length: 24, env: "APP_RELEASE_UPLOAD_TOKEN" };
  apiMock.get.mockImplementation((url) => Promise.resolve(String(url).endsWith("/status") ? { data: { upload_token: tokenStatus } } : { data: RELEASES }));
  apiMock.patch.mockResolvedValue({ data: {} });
  apiMock.post.mockResolvedValue({ data: RELEASES[0] });
});

test("die Liste zeigt Builds, das aktuelle Release und die Pflicht-Grenze", async () => {
  render(<MemoryRouter><AdminAppReleasesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("app-release-63")).toBeInTheDocument());
  expect(screen.getByTestId("app-release-63")).toHaveTextContent("aktuell");
  expect(screen.getByTestId("app-release-62")).toHaveTextContent("Build 60");
  expect(screen.getByTestId("app-release-63")).toHaveTextContent("50.0 MB");
});

test("ein älteres Release lässt sich als aktuell setzen", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminAppReleasesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("app-release-62")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /als aktuell setzen/ }));
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/app-releases/62", { is_current: true });
  await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
});

test("der Upload schickt APK, Version und Build als Formular", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminAppReleasesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("app-release-form")).toBeInTheDocument());

  await user.type(screen.getByTestId("app-release-version"), "0.5.0-beta");
  await user.type(screen.getByTestId("app-release-build"), "63");
  const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], "LionsAPP.apk", { type: "application/vnd.android.package-archive" });
  await user.upload(screen.getByTestId("app-release-file"), file);
  await user.click(screen.getByTestId("app-release-submit"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const [url, body] = apiMock.post.mock.calls[0];
  expect(url).toBe("/admin/app-releases");
  expect(body.get("version")).toBe("0.5.0-beta");
  expect(body.get("build")).toBe("63");
  expect(body.get("file").name).toBe("LionsAPP.apk");
});

test("Größen sind lesbar", () => {
  expect(formatSize(0)).toBe("-");
  expect(formatSize(2048)).toBe("2 KB");
  expect(formatSize(52_428_800)).toBe("50.0 MB");
});

test("die Seite sagt, ob das Release-Skript hochladen kann", async () => {
  render(<MemoryRouter><AdminAppReleasesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("app-release-token-status")).toHaveTextContent("eingerichtet (48 Zeichen)"));
});

test("ohne Token am Server steht, was zu tun ist", async () => {
  tokenStatus = { configured: false, length: 0, min_length: 24, env: "APP_RELEASE_UPLOAD_TOKEN" };
  render(<MemoryRouter><AdminAppReleasesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("app-release-token-status")).toHaveTextContent("fehlt"));
  expect(screen.getByTestId("app-release-token-status")).toHaveTextContent(/APP_RELEASE_UPLOAD_TOKEN in der Server-.env setzen/);
});
