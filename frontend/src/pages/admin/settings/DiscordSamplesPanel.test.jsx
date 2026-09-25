import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Vorschau jeder Meldungsart (#583): Gruppen mit Discord-Nachbildung, Herkunft der Daten, Ereignis-aus-Chip;
// „In den Testkanal senden“ und „An mich“ rufen den Server und sagen ehrlich, ob etwas ankam.
// Ohne Testkanal steht der Klickweg, ohne verknüpftes Konto der Hinweis für „An mich“.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (detail ? String(detail) : "") }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordSamplesPanel, sendResultText } = await import("./DiscordSamplesPanel");

const DATA = {
  groups: [{ key: "public", label: "Öffentliche Kanäle" }, { key: "board", label: "Vorstand (privat)" }, { key: "dm", label: "Direktnachrichten" }],
  entries: [
    { key: "news.published", label: "News veröffentlicht", group: "public", target: "news", source: "latest", source_text: "aus der letzten News", enabled: false, dm: false,
      embed: { title: "📰 Sommerfest", description: "Grillen am Vereinsplatz.", color: 0x29b6e8, url: "https://lionsquad.at/news/sommerfest" } },
    { key: "membership.application", label: "Neuer Mitgliedsantrag", group: "board", target: "board", source: "example", source_text: "Beispiel", enabled: true, dm: false,
      embed: { title: "📝 Neuer Mitgliedsantrag", description: "Ein neuer Antrag wartet.", color: 0xffd700 } },
    { key: "notify.achievement", label: "Erfolg-Gratulation", group: "dm", target: "dm", source: "example", source_text: "Beispiel", dm: true,
      embed: { title: "🏆 Stark, Paula! Erfolg freigeschaltet", description: "• **Erste Bestzeit** · +25 Punkte", color: 0xc0c0c0 } },
  ],
  test_channel: { configured: false, channel_name: null },
  dm: { linked: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: DATA });
  apiMock.post.mockResolvedValue({ data: { ok: true, target: "test", channel_name: "bot-test" } });
});

test("Rückmeldung in Worten", () => {
  expect(sendResultText("test", { ok: true, channel_name: "bot-test" })).toBe("Test gesendet in #bot-test.");
  expect(sendResultText("dm", { ok: true })).toBe("Direktnachricht an dich gesendet.");
  expect(sendResultText("test", { ok: false, reason: "test_channel_missing", error: "Kein Testkanal gewählt." })).toBe("Nicht gesendet: Kein Testkanal gewählt.");
});

test("Gruppen, Nachbildung, Herkunft und „Ereignis aus“; ohne Testkanal und ohne Konto stehen die Hinweise", async () => {
  render(<DiscordSamplesPanel />);
  expect(await screen.findByTestId("discord-sample-news.published")).toHaveTextContent("aus der letzten News");
  expect(screen.getByTestId("discord-sample-news.published-off")).toHaveTextContent("Ereignis aus");
  expect(screen.getByTestId("discord-sample-news.published-message-embed")).toHaveTextContent("Sommerfest");
  expect(screen.getByTestId("discord-samples-group-dm")).toHaveTextContent("Direktnachrichten");
  expect(screen.getByTestId("discord-sample-notify.achievement-message-embed").querySelector("strong")).toHaveTextContent("Erste Bestzeit");
  expect(screen.queryByTestId("discord-sample-membership.application-off")).toBeNull();
  expect(screen.getByTestId("discord-samples-test-channel")).toHaveTextContent("Kein Testkanal gewählt");
  expect(screen.getByTestId("discord-samples-dm-hint")).toHaveTextContent("Profil → Socials");
});

test("Testkanal und Direktnachricht rufen den Server; die Antwort steht als Toast", async () => {
  const user = userEvent.setup();
  apiMock.get.mockResolvedValue({ data: { ...DATA, test_channel: { configured: true, channel_name: "bot-test" }, dm: { linked: true } } });
  render(<DiscordSamplesPanel />);
  await user.click(await screen.findByTestId("discord-sample-news.published-test"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/samples/news.published/send?via=test"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Test gesendet in #bot-test."));
  expect(screen.getByTestId("discord-samples-test-channel")).toHaveTextContent("#bot-test");
  expect(screen.queryByTestId("discord-samples-dm-hint")).toBeNull();

  apiMock.post.mockResolvedValueOnce({ data: { ok: false, reason: "dm_forbidden", error: "Discord lässt keine Direktnachricht zu." } });
  await user.click(screen.getByTestId("discord-sample-notify.achievement-dm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/samples/notify.achievement/send?via=dm"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Nicht gesendet: Discord lässt keine Direktnachricht zu."));
});

test("ohne Antwort vom Server steht der Fehler, nicht eine leere Seite", async () => {
  apiMock.get.mockRejectedValue({ response: { data: { detail: "Nicht erlaubt" } } });
  render(<DiscordSamplesPanel />);
  expect(await screen.findByTestId("discord-samples-error")).toHaveTextContent("Nicht erlaubt");
});
