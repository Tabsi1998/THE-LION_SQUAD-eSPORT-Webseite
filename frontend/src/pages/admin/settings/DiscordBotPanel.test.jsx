import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Discord-Bot (#302) im Admin: Einrichtungsschritte ohne Token, Speichern schickt nur Getipptes,
// Verbinden ist ein eigener Schalter, „Rollen jetzt abgleichen“ erst online.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { DiscordBotPanel } = await import("./DiscordBotPanel");

function botState(overrides = {}) {
  return { bot: { enabled: false, configured: false, guild_id: "", roles: { member: "Mitglied", board: "Vorstand", tournament: "Turnierleitung" }, count_messages: true, connected: false, linked_count: 2, ...overrides } };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: botState() });
  apiMock.put.mockResolvedValue({ data: { ok: true, changed: true } });
  apiMock.post.mockResolvedValue({ data: { ok: true, changes: 3, linked: 2 } });
});

test("ohne Token: Anleitung, Speichern schickt Token, Server und Rollen; Verbinden ist gesperrt", async () => {
  const user = userEvent.setup();
  render(<DiscordBotPanel canSystem />);
  expect(await screen.findByTestId("discord-bot-setup")).toHaveTextContent("Server Members Intent");
  expect(screen.getByTestId("discord-bot-state")).toHaveTextContent("aus");
  expect(screen.getByTestId("discord-bot-enabled")).toBeDisabled();
  expect(screen.getByTestId("discord-bot-sync")).toBeDisabled();

  await user.type(screen.getByTestId("discord-bot-token"), "MTIz.token.wert");
  await user.type(screen.getByTestId("discord-bot-guild"), "12ab34");
  await user.clear(screen.getByTestId("discord-bot-role-member"));
  await user.type(screen.getByTestId("discord-bot-role-member"), "Mitglied:in");
  await user.click(screen.getByTestId("discord-bot-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", {
    bot_token: "MTIz.token.wert", bot_guild_id: "1234", bot_roles: { member: "Mitglied:in", board: "Vorstand", tournament: "Turnierleitung" }, bot_count_messages: true,
  }));
});

test("mit Token online: kein Setup-Kasten, Verbinden schaltet, Rollenabgleich läuft", async () => {
  apiMock.get.mockResolvedValue({ data: botState({ configured: true, enabled: true, connected: true, guild_name: "LION", missing_roles: ["Turnierleitung"] }) });
  const user = userEvent.setup();
  render(<DiscordBotPanel canSystem={false} />);
  expect(await screen.findByTestId("discord-bot-state")).toHaveTextContent("online · LION");
  expect(screen.queryByTestId("discord-bot-setup")).not.toBeInTheDocument();
  expect(screen.getByTestId("discord-bot-missing-roles")).toHaveTextContent("Turnierleitung");
  expect(screen.queryByText("Gespeicherten Token entfernen")).not.toBeInTheDocument();

  await user.click(screen.getByTestId("discord-bot-enabled"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { bot_enabled: false }));
  await user.click(screen.getByTestId("discord-bot-sync"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/bot/sync"));
});

test("eingeschaltet, aber abgelehnt: Fehler mit Klickweg und der Hinweis, dass der Bot es von selbst wieder versucht", async () => {
  apiMock.get.mockResolvedValue({ data: botState({ configured: true, enabled: true, connected: false, last_error: "Discord lässt den Bot nicht verbinden: Im Developer Portal fehlt der Schalter „Server Members Intent“" }) });
  render(<DiscordBotPanel canSystem />);
  expect(await screen.findByTestId("discord-bot-state")).toHaveTextContent("eingeschaltet, nicht verbunden");
  expect(screen.getByTestId("discord-bot-log")).toHaveTextContent("Server Members Intent");
  expect(screen.getByTestId("discord-bot-retry")).toHaveTextContent("alle fünf Minuten");
});
