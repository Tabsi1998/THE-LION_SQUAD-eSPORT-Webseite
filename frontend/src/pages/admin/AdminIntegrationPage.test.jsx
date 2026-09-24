import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Verbindungen: je Dienst eine eigene Seite - TikTok zeigt Stand, Felder, Rückrufadresse, „prüfen“
// und die Anleitung aufgeklappt; Speichern schickt nur die eigenen Felder; E-Mail hat keine eigene
// Seite mehr, sondern führt direkt auf den Reiter mit den Feldern (#508).

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));
// Discord und Twitch tragen ihre laufenden Einstellungen selbst (eigene Tests); hier nur, dass sie da sind.
vi.mock("@/pages/admin/settings/DiscordSettings", () => ({ DiscordSettings: () => <div data-testid="discord-settings-stub" /> }));
vi.mock("@/pages/admin/settings/TwitchSettings", () => ({ TwitchSettings: () => <div data-testid="twitch-settings-stub" /> }));

const AdminIntegrationPage = (await import("./AdminIntegrationPage")).default;

function mockApi(branding = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/settings/branding") return { data: branding };
    if (url === "/me/platform-links") return { data: { available: { tiktok: Boolean(branding.tiktok_client_key && branding.tiktok_client_secret_masked), discord: true, twitch: true, steam: true } } };
    if (url === "/settings/email") return { data: { resend_api_key_masked: "", enabled: false } };
    if (url === "/settings/smtp") return { data: {} };
    return { data: {} };
  });
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/admin/integrations/:key" element={<AdminIntegrationPage />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => { apiMock.put.mockReset(); apiMock.post.mockReset(); toastMock.success.mockReset(); });

test("TikTok: Stand, Felder, Rückrufadresse, Anleitung offen - Speichern schickt nur die TikTok-Felder", async () => {
  mockApi({ tiktok_client_key: "", tiktok_client_secret_masked: "" });
  apiMock.put.mockResolvedValue({ data: {} });
  apiMock.post.mockResolvedValue({ data: { platform: "tiktok", ok: false, checks: [{ key: "credentials", state: "fail", text: "Client ID oder Client Secret fehlt" }] } });
  renderAt("/admin/integrations/tiktok");
  expect(await screen.findByTestId("integration-title")).toHaveTextContent("TikTok");
  await waitFor(() => expect(screen.getByTestId("integration-title")).toHaveTextContent("Optional"));
  expect(screen.getByTestId("setup-guide-tiktok")).not.toHaveAttribute("open");
  expect(screen.getByTestId("integration-app")).toHaveTextContent(`${window.location.origin}/api/platform-links/tiktok/callback`);

  fireEvent.change(screen.getByTestId("tiktok-client-key"), { target: { value: "aw123" } });
  fireEvent.change(screen.getByTestId("tiktok-client-secret"), { target: { value: "geheim" } });
  fireEvent.click(screen.getByTestId("platform-app-save-tiktok"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/branding", { tiktok_client_key: "aw123", tiktok_client_secret: "geheim" }));
  expect(toastMock.success).toHaveBeenCalledWith("TikTok: gespeichert.");

  fireEvent.click(screen.getByTestId("platform-check-tiktok"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/platform-links/tiktok/check"));
  expect(await screen.findByTestId("platform-check-result-tiktok")).toHaveTextContent("Client ID oder Client Secret fehlt");
  expect(screen.getByTestId("integration-next")).toHaveTextContent("Riot Games");
  expect(screen.getByTestId("integration-prev")).toHaveTextContent("YouTube");
});

test("E-Mail-Versand, Google-Login, Analytics, Google Play und Dolibarr führen direkt auf ihren Reiter - keine Seite, die nur verlinkt (#508)", async () => {
  mockApi();
  for (const [key, target] of [["resend", "/admin/settings/resend"], ["smtp", "/admin/settings/smtp"], ["google", "/admin/settings/google"], ["analytics", "/admin/settings/seo"], ["play", "/admin/settings/branding"], ["dolibarr", "/admin/dolibarr?tab=connection"]]) {
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/admin/integrations/${key}`]}>
        <Routes>
          <Route path="/admin/integrations/:key" element={<AdminIntegrationPage />} />
          <Route path="/admin/settings/*" element={<div data-testid="settings-page" />} />
          <Route path="/admin/dolibarr" element={<div data-testid="dolibarr-page" />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByTestId(target.startsWith("/admin/dolibarr") ? "dolibarr-page" : "settings-page")).toBeInTheDocument();
    expect(screen.queryByTestId("integration-title")).toBeNull();
    unmount();
  }
});

test("unbekannte Verbindung führt zur Einrichtung", async () => {
  mockApi();
  renderAt("/admin/integrations/gibtsnicht");
  expect(await screen.findByTestId("integration-missing")).toHaveTextContent("Zur Einrichtung");
});

test("Discord trägt seine laufenden Einstellungen selbst - kein Reiter mehr, nichts doppelt", async () => {
  mockApi();
  renderAt("/admin/integrations/discord");
  expect(await screen.findByTestId("integration-title")).toHaveTextContent("Discord");
  expect(screen.getByTestId("integration-settings")).toContainElement(screen.getByTestId("discord-settings-stub"));
  expect(screen.queryByTestId("integration-tab-link")).toBeNull();
  expect(screen.getByTestId("discord-client-id")).toBeInTheDocument();
});

test("Twitch: Client ID und Secret stehen nur bei der Live-Erkennung; die Karte behält Stand, prüfen und Rückrufadresse", async () => {
  mockApi({ twitch_client_id: "abc", twitch_client_secret_masked: "****" });
  renderAt("/admin/integrations/twitch");
  expect(await screen.findByTestId("integration-title")).toHaveTextContent("Twitch");
  expect(screen.getByTestId("twitch-settings-stub")).toBeInTheDocument();
  expect(screen.getByTestId("platform-app-twitch-elsewhere")).toHaveTextContent("Live-Erkennung");
  expect(screen.queryByTestId("twitch-client-id")).toBeNull();
  expect(screen.queryByTestId("platform-app-save-twitch")).toBeNull();
  expect(screen.getByTestId("platform-check-twitch")).toBeInTheDocument();
  expect(screen.getByTestId("integration-app")).toHaveTextContent("/api/platform-links/twitch/callback");
});
