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
// GitHub-Abgleich (#309).
const GITHUB = {
  github_repo: "Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite", github_sync_enabled: true, github_rollout_betas: true, github_token_configured: true, github_token_unreadable: false,
  github_last_checked_at: "2026-09-24T20:00:00Z", github_last_release: "mobile-v0.9.0-beta-build77", github_last_error: null, sync_interval_minutes: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  tokenStatus = { configured: true, length: 48, min_length: 24, env: "APP_RELEASE_UPLOAD_TOKEN" };
  apiMock.get.mockImplementation((url) => Promise.resolve(String(url).endsWith("/status") ? { data: { upload_token: tokenStatus } } : String(url).endsWith("/github") ? { data: GITHUB } : { data: RELEASES }));
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

// Server-Updater an/aus (#421): der Schalter zeigt den Stand vom Server und schaltet ihn um.
test("der Server-Updater lässt sich abschalten, sobald die App im Play Store ist", async () => {
  apiMock.get.mockImplementation((url) => Promise.resolve(
    String(url).endsWith("/status") ? { data: { upload_token: tokenStatus } }
      : String(url).endsWith("/settings") ? { data: { server_updater_enabled: true } }
        : { data: RELEASES },
  ));
  apiMock.patch.mockResolvedValue({ data: { server_updater_enabled: false } });
  render(<MemoryRouter><AdminAppReleasesPage /></MemoryRouter>);
  const toggle = await screen.findByTestId("app-release-server-updater-toggle");
  expect(toggle).toBeChecked();
  await userEvent.click(toggle);
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/app-releases/settings", { server_updater_enabled: false }));
  await waitFor(() => expect(screen.getByTestId("app-release-server-updater-toggle")).not.toBeChecked());
  expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("Google Play"));
});

// GitHub-Abgleich (#309): Stand, Token nur hin, Schalter, „Jetzt abgleichen“; je Release der Kanal.
test("der GitHub-Kasten zeigt den Stand, speichert das Token und gleicht auf Knopfdruck ab", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockResolvedValue({ data: GITHUB });
  apiMock.post.mockResolvedValue({ data: { imported: [{ build: 78, version: "0.9.1-beta", channel: "beta" }], errors: [], settings: GITHUB } });
  render(<MemoryRouter><AdminAppReleasesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("app-release-github")).toBeInTheDocument());
  expect(screen.getByTestId("app-release-github-status")).toHaveTextContent("Verbunden mit Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite");
  expect(screen.getByTestId("app-release-github-status")).toHaveTextContent("mobile-v0.9.0-beta-build77");
  expect(screen.getByTestId("app-release-63")).toHaveTextContent("Beta");
  await user.type(screen.getByTestId("app-release-github-token"), "github_pat_geheim");
  await user.click(screen.getByTestId("app-release-github-save"));
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/app-releases/github", { github_token: "github_pat_geheim" });
  await user.click(screen.getByTestId("app-release-github-betas"));
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/app-releases/github", { github_rollout_betas: false });
  await user.click(screen.getByTestId("app-release-github-sync"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/app-releases/github/sync");
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("Build 78")));
});

test("ohne Token sagt der Kasten, was zu tun ist, und der Abgleich-Knopf ist gesperrt", async () => {
  apiMock.get.mockImplementation((url) => Promise.resolve(String(url).endsWith("/status") ? { data: { upload_token: tokenStatus } } : String(url).endsWith("/github") ? { data: { ...GITHUB, github_token_configured: false, github_last_release: null, github_last_error: "kein GitHub-Token hinterlegt" } } : { data: RELEASES }));
  render(<MemoryRouter><AdminAppReleasesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("app-release-github-status")).toHaveTextContent("Kein Token"));
  expect(screen.getByTestId("app-release-github-sync")).toBeDisabled();
  expect(screen.getByTestId("app-release-github-error")).toHaveTextContent("kein GitHub-Token");
  expect(screen.queryByTestId("app-release-github-clear")).toBeNull();
});
