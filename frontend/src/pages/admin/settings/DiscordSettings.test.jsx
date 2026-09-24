import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Discord-Einstellungen auf der Discord-Seite unter Verbindungen (statt Reiter): lädt Webhook-Stand,
// Bot-Name und Zähler; speichert nur, was sich geändert hat; ohne Änderung wird nichts geschickt.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), resolveMediaUrl: (v) => v || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: ({ label, testId }) => <div data-testid={testId}>{label}</div>, useImageUploadBusy: () => false }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));
vi.mock("./DiscordBotPanel", () => ({ DiscordBotPanel: ({ canSystem }) => <div data-testid="discord-bot-panel">{canSystem ? "system" : "-"}</div> }));
vi.mock("./DiscordTargets", () => ({ DiscordTargets: () => <div data-testid="discord-targets" /> }));

const { DiscordSettings, discordPayload } = await import("./DiscordSettings");

beforeEach(() => {
  apiMock.put.mockReset();
  toastMock.info.mockReset();
  toastMock.success.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/settings/discord") return { data: { enabled: true, configured: true, webhook_url_masked: "https://discord.com/api/webhooks/…9x", username: "TLS Bot", ops_configured: false, last_status: "sent" } };
    if (url.startsWith("/admin/discord/counters")) return { data: [{ id: "u1", username: "paula", display_name: "Paula", discord_messages_count: 12 }] };
    throw new Error(`unbekannt: ${url}`);
  });
});

test("lädt Stand, Bot-Name und Zähler und speichert nur die Änderung", async () => {
  apiMock.put.mockResolvedValue({ data: {} });
  render(<DiscordSettings />);
  expect(await screen.findByDisplayValue("TLS Bot")).toBeInTheDocument();
  expect(screen.getByTestId("discord-settings")).toHaveTextContent("aktuell: https://discord.com/api/webhooks/…9x");
  expect(screen.getByTestId("discord-bot-panel")).toHaveTextContent("system");
  expect(screen.getByTestId("discord-targets")).toBeInTheDocument();
  expect(await screen.findByTestId("discord-counter-save-u1")).toBeInTheDocument();
  expect(screen.getByTestId("discord-settings")).toHaveTextContent("12 Nachrichten");
  fireEvent.change(screen.getByTestId("discord-username"), { target: { value: "Löwen-Bot" } });
  fireEvent.click(screen.getByTestId("discord-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { username: "Löwen-Bot" }));
  expect(toastMock.success).toHaveBeenCalledWith("Discord gespeichert.");
});

test("ohne Änderung wird nichts geschickt; ein leeres Webhook-Feld überschreibt nichts", async () => {
  render(<DiscordSettings />);
  await screen.findByDisplayValue("TLS Bot");
  fireEvent.click(screen.getByTestId("discord-save"));
  await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Keine Änderungen zum Speichern."));
  expect(apiMock.put).not.toHaveBeenCalled();
  expect(discordPayload({ webhook_url: "", username: "x", configured: true, webhook_url_masked: "…" })).toEqual({ username: "x" });
});
