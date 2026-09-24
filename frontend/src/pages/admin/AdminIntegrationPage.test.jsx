import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Verbindungen: je Dienst eine eigene Seite - TikTok zeigt Stand, Felder, Rückrufadresse, „prüfen“
// und die Anleitung aufgeklappt; Speichern schickt nur die eigenen Felder; E-Mail hat keine App,
// aber zwei Anleitungen und den Weg zum Reiter.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));

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
  expect(screen.getByTestId("setup-guide-tiktok")).toHaveAttribute("open");
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

test("E-Mail-Versand: keine App, zwei Anleitungen und der Weg zum Reiter", async () => {
  mockApi();
  renderAt("/admin/integrations/mail");
  expect(await screen.findByTestId("integration-title")).toHaveTextContent("E-Mail-Versand");
  expect(screen.queryByTestId("integration-app")).toBeNull();
  expect(screen.getByTestId("setup-guide-resend")).toBeInTheDocument();
  expect(screen.getByTestId("setup-guide-smtp")).toBeInTheDocument();
  expect(screen.getByTestId("integration-tab-link")).toHaveAttribute("href", "/admin/settings?tab=email");
  await waitFor(() => expect(screen.getByTestId("integration-title")).toHaveTextContent("Fehlt"));
});

test("unbekannte Verbindung führt zur Einrichtung", async () => {
  mockApi();
  renderAt("/admin/integrations/gibtsnicht");
  expect(await screen.findByTestId("integration-missing")).toHaveTextContent("Zur Einrichtung");
});
