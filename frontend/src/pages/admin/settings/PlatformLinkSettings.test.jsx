import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Konten verknüpfen: „Discord prüfen“ fragt den Server, ob Client ID, Secret und Rückrufadresse
// passen, und zeigt jede Prüfung mit Ergebnis - damit der Betreiber sieht, was noch fehlt.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { PlatformLinkSettings } = await import("./PlatformLinkSettings");

test("Discord prüfen zeigt jede Prüfung mit Ergebnis", async () => {
  apiMock.post.mockResolvedValue({ data: { platform: "discord", ok: false, redirect_uri: "https://lionsquad.at/api/platform-links/discord/callback", checks: [
    { key: "credentials", state: "ok", text: "Client ID und Client Secret passen zusammen." },
    { key: "app", state: "ok", text: "Client ID gehört zur Bot-App." },
    { key: "redirect", state: "fail", text: "Rückrufadresse fehlt in der App: https://lionsquad.at/api/platform-links/discord/callback unter OAuth2 → Redirects hinzufügen." },
  ] } });
  render(<MemoryRouter><PlatformLinkSettings brand={{ discord_client_id: "123", discord_client_secret_masked: "****" }} setBrandField={vi.fn()} saving={false} onSave={vi.fn()} onClearSecret={vi.fn()} /></MemoryRouter>);
  fireEvent.click(screen.getByTestId("platform-check-discord"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/platform-links/discord/check"));
  const result = await screen.findByTestId("platform-check-result-discord");
  expect(result).toHaveTextContent("Client ID und Client Secret passen zusammen.");
  expect(result).toHaveTextContent("Rückrufadresse fehlt in der App");
  expect(screen.getByTestId("platform-check-discord-redirect")).toHaveTextContent("fehlt");
  expect(screen.getByTestId("setup-guide-discord_app")).toBeInTheDocument();
});
