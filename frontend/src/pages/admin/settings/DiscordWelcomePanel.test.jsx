import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Willkommensnachricht (#574): Schalter (Standard aus), Text mit Vorschau vom Server, Speichern, Vorlage,
// „An mich senden“ und die Zähler.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordWelcomePanel, statsText } = await import("./DiscordWelcomePanel");

const WELCOME = {
  enabled: false, custom: false, max_length: 1500, text: "Hallo {name}, willkommen bei {verein}!",
  preview: { embed: { title: "Willkommen bei THE LION SQUAD!", description: "Hallo Paula, willkommen bei THE LION SQUAD!", color: 0x29b6e8 },
    buttons: [{ label: "Auf der Website anmelden", url: "https://lionsquad.at/register" }, { label: "Konto verknüpfen", url: "https://lionsquad.at/profile?tab=socials" }] },
  stats: { sent: 3, dm_closed: 1, error: 0, last_at: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Der Server merkt sich, was gespeichert wurde - wie im Betrieb.
  let stored = { ...WELCOME };
  apiMock.get.mockImplementation(async () => ({ data: { welcome: stored } }));
  apiMock.put.mockImplementation(async (_url, body) => {
    stored = { ...stored, ...body.welcome, custom: Boolean(body.welcome.text ?? stored.custom) };
    return { data: { ok: true } };
  });
  apiMock.post.mockImplementation(async (url, body) => (url.endsWith("/preview")
    ? { data: { embed: { title: "Willkommen bei THE LION SQUAD!", description: body.text.replace("{name}", "Paula") }, buttons: WELCOME.preview.buttons } }
    : { data: { ok: true } }));
});

test("Zähler in Worten", () => {
  expect(statsText(WELCOME.stats)).toBe("3 gesendet · 1 mit geschlossenen Direktnachrichten");
  expect(statsText({ sent: 0, dm_closed: 0, error: 2, last_at: null })).toContain("2 Fehler");
});

test("aus, bis der Text geprüft ist; Vorschau mit Knöpfen; Schalter speichert", async () => {
  const user = userEvent.setup();
  render(<DiscordWelcomePanel />);
  const toggle = await screen.findByTestId("discord-welcome-enabled");
  expect(toggle).not.toBeChecked();
  expect(screen.getByTestId("discord-welcome")).toHaveTextContent("erst den Text prüfen");
  expect(screen.getByTestId("discord-welcome-message-embed")).toHaveTextContent("Hallo Paula");
  expect(screen.getByTestId("discord-welcome-message-buttons")).toHaveTextContent("Konto verknüpfen");
  expect(screen.getByTestId("discord-welcome-stats")).toHaveTextContent("3 gesendet");
  await user.click(toggle);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { welcome: { enabled: true } }));
});

test("Text ändern zeigt die Vorschau vom Server, Speichern und „An mich senden“ schicken den Entwurf", async () => {
  const user = userEvent.setup();
  render(<DiscordWelcomePanel />);
  const text = await screen.findByTestId("discord-welcome-text");
  expect(screen.getByTestId("discord-welcome-save")).toBeDisabled();
  await user.clear(text);
  await user.type(text, "Servus {{name}!");
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/welcome/preview", { text: "Servus {name}!" }));
  await waitFor(() => expect(screen.getByTestId("discord-welcome-message-embed")).toHaveTextContent("Servus Paula!"));
  expect(screen.getByTestId("discord-welcome-count")).toHaveTextContent("14/1500");

  await user.click(screen.getByTestId("discord-welcome-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { welcome: { text: "Servus {name}!" } }));
  await user.click(screen.getByTestId("discord-welcome-test"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/welcome/test", { text: "Servus {name}!" }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Willkommensnachricht als Direktnachricht an dich gesendet."));
});

test("ohne verknüpftes Konto sagt „An mich senden“, warum nichts ging", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { ok: false, reason: "not_linked", error: "Dein Discord-Konto ist nicht verknüpft." } });
  render(<DiscordWelcomePanel />);
  await user.click(await screen.findByTestId("discord-welcome-test"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Nicht gesendet: Dein Discord-Konto ist nicht verknüpft."));
});
