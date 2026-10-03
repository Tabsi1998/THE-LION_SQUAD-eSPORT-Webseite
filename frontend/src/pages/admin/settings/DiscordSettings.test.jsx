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
vi.mock("./DiscordScheduledPanel", () => ({ DiscordScheduledPanel: () => <div data-testid="discord-scheduled" /> }));
vi.mock("./DiscordWelcomePanel", () => ({ DiscordWelcomePanel: () => <div data-testid="discord-welcome" /> }));
vi.mock("./DiscordGuildsPanel", () => ({ DiscordGuildsPanel: () => <div data-testid="discord-guilds" /> }));
vi.mock("./DiscordStreamsPanel", () => ({ DiscordStreamsPanel: ({ onDesign }) => <button type="button" data-testid="discord-streams" onClick={onDesign}>Streams</button> }));
vi.mock("./DiscordDesignPanel", () => ({ DiscordDesignPanel: () => <div data-testid="discord-design" /> }));

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

test("lädt Stand und Zähler; der Schalter „Versand aktiv“ speichert sofort; Reiter zeigen je ihre Kästen (#624)", async () => {
  render(<DiscordSettings />);
  // Reiter „Meldungen“: Schalter, letzte Meldung, Kanäle, Vorschau.
  expect(await screen.findByTestId("discord-last-status")).toHaveTextContent("tournament.live");
  expect(screen.getByTestId("discord-tab-messages")).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("discord-targets")).toBeInTheDocument();
  expect(screen.getByTestId("discord-samples")).toBeInTheDocument();
  expect(screen.queryByTestId("discord-embeds")).toBeNull();
  expect(screen.queryByTestId("discord-not-configured")).toBeNull();
  expect(screen.getByTestId("discord-settings")).not.toHaveTextContent("Webhook");

  fireEvent.click(screen.getByTestId("discord-enabled"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { enabled: false }));
  expect(toastMock.success).toHaveBeenCalledWith("Discord-Meldungen aus – es wird nichts mehr gesendet.");

  fireEvent.click(screen.getByTestId("discord-tab-embeds"));
  expect(screen.getByTestId("discord-embeds")).toBeInTheDocument();
  expect(screen.getByTestId("discord-scheduled")).toBeInTheDocument();
  expect(screen.queryByTestId("discord-targets")).toBeNull();
  // Stream-Meldungen (#866) stehen bei den Einbettungen; „Aussehen gestalten“ führt in den Reiter „Gestaltung“.
  fireEvent.click(screen.getByTestId("discord-streams"));
  expect(screen.getByTestId("discord-tab-design")).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("discord-design")).toBeInTheDocument();
  expect(screen.queryByTestId("discord-embeds")).toBeNull();
  fireEvent.click(screen.getByTestId("discord-tab-welcome"));
  expect(screen.getByTestId("discord-welcome")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("discord-tab-servers"));
  expect(screen.getByTestId("discord-guilds")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("discord-tab-bot"));
  expect(screen.getByTestId("discord-bot-panel")).toHaveTextContent("system");
  expect(await screen.findByTestId("discord-counter-save-u1")).toBeInTheDocument();
  expect(screen.getByTestId("discord-settings")).toHaveTextContent("12 Nachrichten");
});

test("ohne gewählten Kanal steht der Hinweis; discordPayload lässt nur Einstellbares durch", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/settings/discord" ? { data: { ...SETTINGS, configured: false, channels: {} } } : { data: [] }));
  render(<DiscordSettings />);
  expect(await screen.findByTestId("discord-not-configured")).toHaveTextContent("Noch kein Kanal gewählt");
  expect(discordPayload({ enabled: true, configured: true, channels: {}, target_status: {}, bot: {}, events: [], last_status: "sent" })).toEqual({ enabled: true });
});
