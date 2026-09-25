import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Konten verknüpfen: „Discord prüfen“ fragt den Server, ob Client ID, Secret und Rückrufadresse
// passen, und zeigt jede Prüfung mit Ergebnis - damit der Betreiber sieht, was noch fehlt. Die
// Übersicht im Reiter Login & Konten zeigt je Plattform nur den Stand und führt zur eigenen Seite
// unter Verbindungen - nichts doppelt.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { PlatformAppCard, PlatformLinkOverview } = await import("./PlatformLinkSettings");
const { PLATFORM_APPS } = await import("@/lib/platformLinks");
const appFor = (key) => PLATFORM_APPS.find((app) => app.key === key);

test("Discord prüfen zeigt jede Prüfung mit Ergebnis", async () => {
  apiMock.post.mockResolvedValue({ data: { platform: "discord", ok: false, redirect_uri: "https://lionsquad.at/api/platform-links/discord/callback", checks: [
    { key: "credentials", state: "ok", text: "Client ID und Client Secret passen zusammen." },
    { key: "app", state: "ok", text: "Client ID gehört zur Bot-App." },
    { key: "redirect", state: "fail", text: "Rückrufadresse fehlt in der App: https://lionsquad.at/api/platform-links/discord/callback unter OAuth2 → Redirects hinzufügen." },
  ] } });
  render(<MemoryRouter><PlatformAppCard app={appFor("discord")} brand={{ discord_client_id: "123", discord_client_secret_masked: "****" }} setBrandField={vi.fn()} onClearSecret={vi.fn()} onSave={vi.fn()} /></MemoryRouter>);
  fireEvent.click(screen.getByTestId("platform-check-discord"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/platform-links/discord/check"));
  const result = await screen.findByTestId("platform-check-result-discord");
  expect(result).toHaveTextContent("Client ID und Client Secret passen zusammen.");
  expect(result).toHaveTextContent("Rückrufadresse fehlt in der App");
  expect(screen.getByTestId("platform-check-discord-redirect")).toHaveTextContent("fehlt");
  expect(screen.getByTestId("setup-guide-discord_app")).toBeInTheDocument();
});

test("ohne Felder zeigt die Karte nur Stand, prüfen und Rückrufadresse", () => {
  render(<MemoryRouter><PlatformAppCard app={appFor("twitch")} brand={{}} setBrandField={vi.fn()} onClearSecret={vi.fn()} onSave={vi.fn()} showGuide={false} showFields={false} fieldsNote="Client ID und Secret stehen unten." /></MemoryRouter>);
  expect(screen.getByTestId("platform-app-twitch-elsewhere")).toHaveTextContent("stehen unten");
  expect(screen.queryByTestId("twitch-client-id")).toBeNull();
  expect(screen.queryByTestId("platform-app-save-twitch")).toBeNull();
  expect(screen.getByTestId("platform-check-twitch")).toBeInTheDocument();
  expect(screen.getByTestId("platform-app-twitch")).toHaveTextContent("/api/platform-links/twitch/callback");
});

test("die Übersicht nennt je Plattform den Stand und führt zur eigenen Seite - ohne Felder", () => {
  render(<MemoryRouter><PlatformLinkOverview brand={{ discord_client_id: "123", discord_client_secret_masked: "****" }} /></MemoryRouter>);
  // Discord (eingerichtet), Steam, Lichess, Mastodon und Bluesky (brauchen keine App) sind bereit.
  expect(screen.getByTestId("platform-link-ready-count")).toHaveTextContent(`5 / ${PLATFORM_APPS.length} bereit`);
  expect(screen.getByTestId("platform-link-discord-state")).toHaveTextContent("bereit");
  expect(screen.getByTestId("platform-link-steam-state")).toHaveTextContent("bereit");
  expect(screen.getByTestId("platform-link-lichess-state")).toHaveTextContent("bereit");
  expect(screen.getByTestId("platform-link-open-tiktok")).toHaveAttribute("href", "/admin/integrations/tiktok");
  expect(screen.getByTestId("platform-link-open-discord")).toHaveAttribute("href", "/admin/integrations/discord");
  expect(screen.queryByTestId("discord-client-id")).toBeNull();
  expect(screen.queryByTestId("platform-check-discord")).toBeNull();
});
