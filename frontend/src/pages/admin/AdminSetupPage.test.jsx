import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Einrichtung: alle Anleitungen mit Stand aus den Einstellungen - fehlende stehen offen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AdminSetupPage = (await import("./AdminSetupPage")).default;

test("Stand je Dienst: Twitch eingerichtet, Discord-App fehlt, Play Store optional", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/settings/branding") return { data: { twitch_client_id: "abc", twitch_client_secret_masked: "****", twitch_channel: "the_lion_squad", analytics_provider: "google", google_analytics_id: "" } };
    if (url === "/settings/discord") return { data: { configured: true, enabled: true, bot: { configured: false } } };
    if (url === "/settings/auth") return { data: { google_configured: true, google_login_enabled: true } };
    if (url === "/settings/email") return { data: { resend_api_key_masked: "re_****", enabled: true } };
    if (url === "/settings/smtp") return { data: {} };
    if (url === "/admin/dolibarr/status") return { data: { mode: "live" } };
    if (url === "/me/platform-links") return { data: { available: { discord: false, twitch: true, steam: true } } };
    throw new Error("unbekannt");
  });
  render(<MemoryRouter><AdminSetupPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("setup-guide-twitch")).toHaveTextContent("Eingerichtet · App und Kanal the_lion_squad"));
  expect(screen.getByTestId("setup-guide-discord_app")).toHaveTextContent("Fehlt · Client ID oder Secret fehlt");
  expect(screen.getByTestId("setup-guide-discord_app")).toHaveAttribute("open");
  expect(screen.getByTestId("setup-guide-twitch")).not.toHaveAttribute("open");
  expect(screen.getByTestId("setup-guide-analytics")).toHaveTextContent("Fehlt · Google ohne Mess-ID");
  expect(screen.getByTestId("setup-guide-play_store")).toHaveTextContent("Optional");
  expect(screen.getByTestId("setup-guide-dolibarr")).toHaveTextContent("Eingerichtet · Modus Live");
  expect(screen.getByTestId("setup-summary")).toHaveTextContent("5 eingerichtet");
  expect(screen.getByTestId("setup-summary")).toHaveTextContent("3 fehlen");
});
