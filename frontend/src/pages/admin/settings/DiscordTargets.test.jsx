import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Kanäle je Zweck (#566): der Bot schickt, je Ziel ein Kanal aus der Liste. Die Seite sagt ehrlich,
// wohin etwas geht – und dass der Vorstand ohne eigenen Kanal nichts bekommt, statt still in der
// Community zu landen. Bot aus steht groß dran; ohne Kanal-Liste gibt es das ID-Feld.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordTargets, deliveryText, lastAttemptText, channelOptionLabel } = await import("./DiscordTargets");

const FORBIDDEN = "Der Bot darf in diesem Kanal nicht schreiben: Kanal → Bearbeiten → Berechtigungen → Bot-Rolle: „Kanal ansehen“, „Nachrichten senden“, „Links einbetten“.";
const DATA = {
  channels: { community: "100000000000000001", news: "100000000000000002", events: "", board: "", ops: "" },
  bot: { enabled: true, configured: true },
  events: [
    { key: "news.published", label: "News veröffentlicht", target: "news", enabled: false },
    { key: "tournament.live", label: "Turnier: jetzt live", target: "events", enabled: true },
    { key: "membership.application", label: "Neuer Mitgliedsantrag", target: "board", enabled: false },
  ],
  target_status: {
    community: { label: "Community (Standard)", private: false, configured: true, channel_id: "100000000000000001", channel_name: "allgemein", delivers_to: "community", last: null },
    news: { label: "News", private: false, configured: true, channel_id: "100000000000000002", channel_name: "news", delivers_to: "news", last: { status: "failed", reason: "forbidden", error: FORBIDDEN, created_at: "2026-09-21T10:00:00+00:00" } },
    events: { label: "Events und Turniere", private: false, configured: false, channel_id: "", channel_name: null, delivers_to: "community", last: null },
    board: { label: "Vorstand (privat)", private: true, configured: false, channel_id: "", channel_name: null, delivers_to: null, last: null },
    ops: { label: "Betrieb (privat)", private: true, configured: false, channel_id: "", channel_name: null, delivers_to: null, last: null },
  },
};
const CHANNELS = {
  ok: true,
  channels: [
    { id: "100000000000000001", name: "allgemein", category: "Community", can_send: true, can_embed: true },
    { id: "100000000000000002", name: "news", category: "Community", can_send: true, can_embed: true },
    { id: "100000000000000003", name: "vorstand", category: "Intern", can_send: true, can_embed: false },
    { id: "100000000000000009", name: "regeln", category: "Info", can_send: false, can_embed: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => (url === "/settings/discord/channels" ? { data: CHANNELS } : { data: DATA }));
  apiMock.put.mockResolvedValue({ data: { ok: true } });
  apiMock.post.mockResolvedValue({ data: { ok: true, target: "community" } });
});

test("wohin ein Ziel wirklich liefert, steht in Worten da", () => {
  expect(deliveryText("news", DATA.target_status)).toBe("#news");
  expect(deliveryText("events", DATA.target_status)).toBe("kein eigener Kanal – geht an Community");
  expect(deliveryText("board", DATA.target_status)).toBe("kein Kanal – es wird nichts gesendet");
  expect(lastAttemptText(DATA.target_status.news.last)).toContain("fehlgeschlagen");
  expect(lastAttemptText(DATA.target_status.news.last)).toContain("Berechtigungen");
  expect(channelOptionLabel(CHANNELS.channels[2])).toBe("#vorstand (Intern) – ohne „Links einbetten“");
  expect(channelOptionLabel(CHANNELS.channels[3])).toBe("#regeln (Info) – Bot darf hier nicht schreiben");
});

test("Vorstand ist als privat erkennbar; ein Kanal ohne Recht steht beim Ziel mit dem Klickweg", async () => {
  render(<DiscordTargets />);
  const board = await screen.findByTestId("discord-target-board");
  expect(board).toHaveTextContent("kein Kanal – es wird nichts gesendet");
  expect(board).toHaveTextContent("ohne Namen");
  expect(screen.getByTestId("discord-target-news-last")).toHaveTextContent("Berechtigungen");
  const select = await screen.findByTestId("discord-target-board-channel");
  const locked = Array.from(select.querySelectorAll("option")).find((option) => option.textContent.includes("#regeln"));
  expect(locked.disabled).toBe(true);
  expect(screen.queryByTestId("discord-targets-bot-off")).toBeNull();
});

test("Kanal aus der Liste wählen und speichern, Schalter umlegen, Test sagt, wenn er in der Community gelandet ist", async () => {
  const user = userEvent.setup();
  render(<DiscordTargets />);
  await user.selectOptions(await screen.findByTestId("discord-target-board-channel"), "100000000000000003");
  await user.click(screen.getByTestId("discord-target-board-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { channels: { board: "100000000000000003" } }));
  expect(toastMock.success).toHaveBeenLastCalledWith("Kanal gespeichert.");

  await user.click(screen.getByTestId("discord-event-news.published").querySelector("input"));
  await waitFor(() => expect(apiMock.put).toHaveBeenLastCalledWith("/settings/discord", { events: { "news.published": true } }));

  await user.click(screen.getByTestId("discord-target-events-test"));
  await waitFor(() => expect(toastMock.success).toHaveBeenLastCalledWith("Test gesendet – ging an Community, weil kein eigener Kanal gewählt ist."));

  apiMock.post.mockResolvedValueOnce({ data: { ok: false, reason: "board_channel_missing", error: "Kein Kanal gewählt (Verbindungen → Discord → Kanäle je Zweck)." } });
  await user.click(screen.getByTestId("discord-target-board-test"));
  await waitFor(() => expect(toastMock.success).toHaveBeenLastCalledWith("Nicht gesendet: Kein Kanal gewählt (Verbindungen → Discord → Kanäle je Zweck)."));
});

test("Bot aus steht dran; ohne Kanal-Liste gibt es das ID-Feld", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation(async (url) => (url === "/settings/discord/channels"
    ? { data: { ok: false, reason: "offline", text: "Der Bot ist nicht verbunden – die Kanal-Liste kommt, sobald er online ist.", channels: [] } }
    : { data: { ...DATA, bot: { enabled: false, configured: true } } }));
  render(<DiscordTargets />);
  expect(await screen.findByTestId("discord-targets-bot-off")).toHaveTextContent("ohne Bot wird nichts gesendet");
  expect(screen.getByTestId("discord-channels-offline")).toHaveTextContent("nicht verbunden");
  const field = await screen.findByTestId("discord-target-ops-id");
  await user.type(field, "1000000000000000a4");
  expect(field).toHaveValue("10000000000000004");
  await user.click(screen.getByTestId("discord-target-ops-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { channels: { ops: "10000000000000004" } }));
});
