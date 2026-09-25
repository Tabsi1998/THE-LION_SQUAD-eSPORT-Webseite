import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Discord-Einstellungen auf der Discord-Seite unter Verbindungen: Meldungen laufen über den Bot (#566).
// Die Seite lädt den Stand und die Zähler; der Schalter „Versand aktiv“ speichert sofort; ohne
// gewählten Kanal steht der Hinweis, was zu tun ist.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), resolveMediaUrl: (v) => v || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));
vi.mock("./DiscordBotPanel", () => ({ DiscordBotPanel: ({ canSystem }) => <div data-testid="discord-bot-panel">{canSystem ? "system" : "-"}</div> }));
vi.mock("./DiscordTargets", () => ({ DiscordTargets: () => <div data-testid="discord-targets" /> }));
vi.mock("./DiscordSamplesPanel", () => ({ DiscordSamplesPanel: () => <div data-testid="discord-samples" /> }));
vi.mock("./DiscordEmbedsPanel", () => ({ DiscordEmbedsPanel: () => <div data-testid="discord-embeds" /> }));

const { DiscordSettings, discordPayload } = await import("./DiscordSettings");

const SETTINGS = {
  enabled: true, configured: true, channels: { community: "100000000000000001" }, events: [], target_status: {}, bot: { enabled: true },
  last_status: "sent", last_error: "", last_event_key: "tournament.live", last_checked_at: "2026-09-25T10:00:00+00:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.put.mockResolvedValue({ data: { ok: true, changed: true } });
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/settings/discord") return { data: SETTINGS };
    if (url.startsWith("/admin/discord/counters")) return { data: [{ id: "u1", username: "paula", display_name: "Paula", discord_messages_count: 12 }] };
    throw new Error(`unbekannt: ${url}`);
  });
});

test("lädt Stand und Zähler; der Schalter „Versand aktiv“ speichert sofort", async () => {
  render(<DiscordSettings />);
  expect(await screen.findByTestId("discord-counter-save-u1")).toBeInTheDocument();
  expect(screen.getByTestId("discord-settings")).toHaveTextContent("12 Nachrichten");
  expect(screen.getByTestId("discord-bot-panel")).toHaveTextContent("system");
  expect(screen.getByTestId("discord-targets")).toBeInTheDocument();
  expect(screen.getByTestId("discord-samples")).toBeInTheDocument();
  expect(screen.getByTestId("discord-embeds")).toBeInTheDocument();
  expect(screen.getByTestId("discord-last-status")).toHaveTextContent("tournament.live");
  expect(screen.queryByTestId("discord-not-configured")).toBeNull();
  expect(screen.getByTestId("discord-settings")).not.toHaveTextContent("Webhook");

  fireEvent.click(screen.getByTestId("discord-enabled"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { enabled: false }));
  expect(toastMock.success).toHaveBeenCalledWith("Discord-Meldungen aus – es wird nichts mehr gesendet.");
});

test("ohne gewählten Kanal steht der Hinweis; discordPayload lässt nur Einstellbares durch", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/settings/discord" ? { data: { ...SETTINGS, configured: false, channels: {} } } : { data: [] }));
  render(<DiscordSettings />);
  expect(await screen.findByTestId("discord-not-configured")).toHaveTextContent("Noch kein Kanal gewählt");
  expect(discordPayload({ enabled: true, configured: true, channels: {}, target_status: {}, bot: {}, events: [], last_status: "sent" })).toEqual({ enabled: true });
});
