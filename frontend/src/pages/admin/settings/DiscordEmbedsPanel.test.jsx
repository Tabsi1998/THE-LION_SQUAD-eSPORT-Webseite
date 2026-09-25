import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Live-Einbettungen (#569): Schalter und Kanal je Einbettung speichern sofort; der Stand steht in Worten;
// „Jetzt aktualisieren“ sagt, ob gepostet, bearbeitet oder unverändert.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordEmbedsPanel, refreshResultText, stateText } = await import("./DiscordEmbedsPanel");

const DATA = {
  embeds: {
    ranking: { label: "Rangliste", hint: "Top 10", enabled: false, channel_id: "", channel_name: null, message_id: null, updated_at: null, error: null, pending: false },
    events: { label: "Nächste Events", hint: "Fünf Termine", enabled: true, channel_id: "100000000000000001", channel_name: "termine", message_id: "m1", updated_at: "2026-09-25T10:00:00+00:00", error: null, pending: true },
    live: { label: "Live jetzt", hint: "Wer streamt", enabled: true, channel_id: "", channel_name: null, message_id: null, updated_at: null, error: "Der Bot darf in diesem Kanal nicht schreiben", pending: false },
  },
};
const CHANNELS = { ok: true, channels: [{ id: "100000000000000001", name: "termine", category: "Community", can_send: true, can_embed: true }, { id: "100000000000000002", name: "live", category: "", can_send: true, can_embed: true }] };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => (url === "/settings/discord/channels" ? { data: CHANNELS } : { data: DATA }));
  apiMock.put.mockResolvedValue({ data: { ok: true, changed: true } });
  apiMock.post.mockResolvedValue({ data: { ok: true, reason: "posted", message_id: "m9" } });
});

test("Stand und Rückmeldung in Worten", () => {
  expect(stateText(DATA.embeds.ranking)).toBe("aus");
  expect(stateText({ enabled: true, channel_id: "" })).toContain("kein Kanal");
  expect(stateText({ enabled: true, channel_id: "1", message_id: null })).toContain("nächsten Lauf");
  expect(stateText(DATA.embeds.events)).toContain("Änderung vorgemerkt");
  expect(stateText(DATA.embeds.live)).toBe("Fehler: Der Bot darf in diesem Kanal nicht schreiben");
  expect(refreshResultText({ ok: true, reason: "posted" })).toBe("Nachricht gepostet und angepinnt.");
  expect(refreshResultText({ ok: true, reason: "unchanged" })).toBe("Inhalt unverändert.");
  expect(refreshResultText({ ok: false, reason: "throttled", error: "kommt gleich" })).toBe("Nicht aktualisiert: kommt gleich");
});

test("drei Einbettungen: Schalter, Kanal aus der Liste, Speichern, Jetzt aktualisieren", async () => {
  const user = userEvent.setup();
  render(<DiscordEmbedsPanel />);
  expect(await screen.findByTestId("discord-embed-events-state")).toHaveTextContent("Nachricht steht");
  expect(screen.getByTestId("discord-embed-live-state")).toHaveTextContent("Fehler");
  expect(screen.getByTestId("discord-embed-ranking-refresh")).toBeDisabled();

  await user.click(screen.getByTestId("discord-embed-ranking-enabled"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { embeds: { ranking: { enabled: true } } }));
  expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("Einbettung an"));

  await user.selectOptions(screen.getByTestId("discord-embed-live-channel"), "100000000000000002");
  await user.click(screen.getByTestId("discord-embed-live-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { embeds: { live: { channel_id: "100000000000000002" } } }));

  await user.click(screen.getByTestId("discord-embed-events-refresh"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/embeds/events/refresh"));
  expect(toastMock.success).toHaveBeenCalledWith("Nachricht gepostet und angepinnt.");

  apiMock.post.mockResolvedValueOnce({ data: { ok: false, reason: "throttled", error: "Höchstens eine Bearbeitung pro Minute – kommt gleich." } });
  await user.click(screen.getByTestId("discord-embed-events-refresh"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Nicht aktualisiert: Höchstens eine Bearbeitung pro Minute – kommt gleich."));
});

test("ohne Kanal-Liste das ID-Feld", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/settings/discord/channels" ? { data: { ok: false, channels: [], text: "Bot offline" } } : { data: DATA }));
  const user = userEvent.setup();
  render(<DiscordEmbedsPanel />);
  const field = await screen.findByTestId("discord-embed-ranking-id");
  await user.type(field, "1234abc");
  expect(field).toHaveValue("1234");
});
