import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Weitergabe (#631): Ankündigungen folgen (Sammelkanal, Quelle je Unterserver, Stand in Worten) und „Mitteilung
// verteilen“ (erst Vorschau, dann Senden - eine Änderung verwirft die Vorschau).

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DistributeBox, FollowBox, channelLabel } = await import("./DiscordForwardPanel");

const CHANNELS = [{ id: "c1", name: "allgemein", category: "", can_webhooks: false }, { id: "c9", name: "aus-den-servern", category: "Verein", can_webhooks: true }];
const FORWARD = {
  online: true, manual: "Von Hand geht es immer: …",
  collector: { channel_id: "c9", name: "aus-den-servern", can_webhooks: true }, channels: CHANNELS,
  servers: [
    { guild_id: "2", name: "Rocket League", news_channels: [{ id: "n1", name: "ankündigungen", category: "" }, { id: "n2", name: "patchnotes", category: "" }],
      source_channel_id: "", state: "ready", text: "Noch nicht eingerichtet.", can_setup: true },
    { guild_id: "3", name: "F1", news_channels: [], source_channel_id: "", state: "no_news_channel", text: "Auf diesem Server gibt es keinen Ankündigungskanal.", can_setup: false },
  ],
};
const OPTIONS = {
  servers: [{ guild_id: "1", name: "LION", main: true }, { guild_id: "2", name: "Rocket League", main: false }],
  targets: [{ key: "community", label: "Community" }, { key: "news", label: "News" }], max_text: 1800, default_title: "Mitteilung",
};
const PLAN = {
  preview: true, title: "Mitteilung", text: "Server-Wartung ab 20 Uhr", target: "news", footer: "verteilt von Vera über die Website",
  servers: [{ guild_id: "1", name: "LION", ready: true, fallback: false }, { guild_id: "2", name: "Rocket League", ready: true, fallback: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

test("Sammelkanal wählen, Quelle wählen, einrichten - und der Stand steht in Worten", async () => {
  const user = userEvent.setup();
  apiMock.get.mockResolvedValue({ data: FORWARD });
  apiMock.put.mockResolvedValue({ data: { ...FORWARD, collector: { channel_id: "c1", name: "allgemein", can_webhooks: false } } });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  render(<FollowBox />);

  expect(await screen.findByTestId("discord-follow-state-2")).toHaveTextContent("bereit");
  expect(apiMock.get).toHaveBeenCalledWith("/settings/discord/forward");
  expect(screen.getByTestId("discord-follow-state-3")).toHaveTextContent("kein Ankündigungskanal");
  expect(screen.getByTestId("discord-follow-server-3")).toHaveTextContent("keinen Ankündigungskanal");
  expect(screen.queryByTestId("discord-follow-setup-3")).toBeNull();
  expect(screen.getByTestId("discord-follow-manual")).toHaveTextContent("Von Hand geht es immer");
  expect(channelLabel(CHANNELS[1])).toBe("#aus-den-servern · Verein");

  // Die zweite Quelle wählen und einrichten.
  await user.selectOptions(screen.getByTestId("discord-follow-source-2"), "n2");
  await user.click(screen.getByTestId("discord-follow-setup-2"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/forward/2", { source_channel_id: "n2" }));
  expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("Rocket League"));

  // Ein Kanal ohne „Webhooks verwalten“ als Sammelkanal: der Hinweis nennt das Recht.
  await user.selectOptions(screen.getByTestId("discord-follow-collector"), "c1");
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord/forward", { channel_id: "c1" }));
  expect(await screen.findByTestId("discord-follow-right")).toHaveTextContent("Webhooks verwalten");
});

test("eingerichtet heißt: kein Knopf mehr; eine Absage von Discord kommt als Satz", async () => {
  const user = userEvent.setup();
  const followed = { ...FORWARD, servers: [{ ...FORWARD.servers[0], state: "followed", text: "Eingerichtet.", source_channel_id: "n1", can_setup: false }] };
  apiMock.get.mockResolvedValue({ data: followed });
  const { unmount } = render(<FollowBox />);
  expect(await screen.findByTestId("discord-follow-state-2")).toHaveTextContent("eingerichtet");
  expect(screen.queryByTestId("discord-follow-setup-2")).toBeNull();
  expect(screen.getByTestId("discord-follow-source-2")).toBeDisabled();
  unmount();

  apiMock.get.mockResolvedValue({ data: FORWARD });
  apiMock.post.mockResolvedValue({ data: { ok: false, error: "Dem Bot fehlt im Sammelkanal das Recht „Webhooks verwalten“." } });
  render(<FollowBox />);
  await user.click(await screen.findByTestId("discord-follow-setup-2"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Webhooks verwalten")));
});

test("verteilen: erst die Vorschau, dann das Senden - und jede Änderung verwirft die Vorschau", async () => {
  const user = userEvent.setup();
  apiMock.get.mockResolvedValue({ data: OPTIONS });
  apiMock.post.mockImplementation(async (_url, body) => ({
    data: body.preview ? PLAN : { ok: true, sent: 1, failed: 1, servers: [{ guild_id: "1", name: "LION", ok: true }, { guild_id: "2", name: "Rocket League", ok: false, error: "Kein Kanal gewählt." }] },
  }));
  render(<DistributeBox />);

  const previewButton = await screen.findByTestId("discord-distribute-preview");
  expect(apiMock.get).toHaveBeenCalledWith("/settings/discord/distribute");
  expect(previewButton).toBeDisabled();
  await user.type(screen.getByTestId("discord-distribute-text"), "Server-Wartung ab 20 Uhr");
  await user.selectOptions(screen.getByTestId("discord-distribute-target"), "news");
  expect(screen.getByTestId("discord-distribute-count")).toHaveTextContent("24 / 1800");
  await user.click(previewButton);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/distribute",
    { text: "Server-Wartung ab 20 Uhr", title: "", target: "news", guild_ids: ["1", "2"], preview: true }));

  // Die Vorschau zeigt die Nachricht mit Fußzeile und je Server, wohin es geht.
  expect(await screen.findByTestId("discord-distribute-message")).toHaveTextContent("verteilt von Vera über die Website");
  expect(screen.getByTestId("discord-distribute-plan-1")).toHaveTextContent("LION: Kanal gewählt");
  expect(screen.getByTestId("discord-distribute-plan-2")).toHaveTextContent("geht in Community");
  expect(screen.getByTestId("discord-distribute-send")).toHaveTextContent("An 2 Server senden");

  // Ein Server weniger: die Vorschau ist weg - erst neu ansehen.
  await user.click(screen.getByTestId("discord-distribute-server-2"));
  expect(screen.queryByTestId("discord-distribute-plan")).toBeNull();
  await user.click(screen.getByTestId("discord-distribute-server-1"));
  expect(screen.getByTestId("discord-distribute-preview")).toBeDisabled();   // ohne Server geht nichts hinaus
  await user.click(screen.getByTestId("discord-distribute-server-1"));
  await user.click(screen.getByTestId("discord-distribute-preview"));
  await user.click(await screen.findByTestId("discord-distribute-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/settings/discord/distribute",
    { text: "Server-Wartung ab 20 Uhr", title: "", target: "news", guild_ids: ["1"] }));
  expect(await screen.findByTestId("discord-distribute-result-1")).toHaveTextContent("LION: gesendet");
  expect(screen.getByTestId("discord-distribute-result-2")).toHaveTextContent("Rocket League: Kein Kanal gewählt.");
  expect(toastMock.success).toHaveBeenCalledWith("Gesendet an 1 Server.");
});
