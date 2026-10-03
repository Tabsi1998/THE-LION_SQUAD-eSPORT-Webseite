import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// Server-Verzeichnis (#624): Hauptserver mit Krone und ohne Aus-Schalter, Unterserver an/aus und „Zum Hauptserver“
// mit Rückfrage, fehlende Rechte in Worten, Prüfen, Einladungslink, Notiz, Test am Unterserver nur mit Bestätigung.

const apiMock = { get: vi.fn(), patch: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordGuildsPanel, guildStatusText } = await import("./DiscordGuildsPanel");

const MAIN = { guild_id: "1", name: "THE LION SQUAD", role: "main", enabled: true, member_count: 120, missing_permissions: [], invite_url: "https://discord.gg/lions", note: "" };
const SUB = { guild_id: "2", name: "Rocket League", role: "sub", enabled: false, member_count: 30, invite_url: null, note: "",
  missing_permissions: [{ key: "manage_roles", label: "Rollen verwalten", why: "Rollen" }] };
const GONE = { guild_id: "3", name: "Alter Server", role: "sub", enabled: false, left_at: "2026-10-01T10:00:00Z", missing_permissions: [] };

function renderPanel() {
  return render(<ConfirmDialogProvider><DiscordGuildsPanel /></ConfirmDialogProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: { guilds: [MAIN, SUB, GONE], connected: true, bot_invite_url: "https://discord.com/oauth2/authorize?client_id=9" } });
  apiMock.patch.mockResolvedValue({ data: {} });
  apiMock.post.mockImplementation(async (url) => {
    if (url.endsWith("/health")) return { data: { ok: false, checks: [{ key: "present", ok: true, text: "Der Bot ist auf diesem Server." }, { key: "permissions", ok: false, text: "Dem Bot fehlen: „Rollen verwalten“." }] } };
    if (url.endsWith("/invite")) return { data: { ok: true, url: "https://discord.gg/rl" } };
    return { data: { ok: true } };
  });
});

test("Stand in Worten", () => {
  expect(guildStatusText(MAIN)).toBe("Hauptserver · an");
  expect(guildStatusText(SUB)).toBe("Unterserver · aus");
  expect(guildStatusText(GONE)).toBe("Bot nicht mehr auf dem Server");
});

test("Hauptserver ohne Aus-Schalter; Unterserver mit Schalter, fehlenden Rechten und „Zum Hauptserver“ nach Rückfrage", async () => {
  const user = userEvent.setup();
  renderPanel();
  expect(await screen.findByTestId("discord-guild-1")).toHaveTextContent("Hauptserver · an · 120 Mitglieder");
  expect(screen.queryByTestId("discord-guild-1-enabled")).toBeNull();
  expect(screen.getByTestId("discord-guilds-invite-bot").querySelector("a")).toHaveAttribute("href", "https://discord.com/oauth2/authorize?client_id=9");
  expect(screen.getByTestId("discord-guild-2-missing")).toHaveTextContent("„Rollen verwalten“");
  expect(screen.queryByTestId("discord-guild-3-test")).toBeNull();

  await user.click(screen.getByTestId("discord-guild-2-enabled"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/settings/discord/guilds/2", { enabled: true }));

  await user.click(screen.getByTestId("discord-guild-2-main"));
  await user.click(await screen.findByRole("button", { name: "Hauptserver" }));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/settings/discord/guilds/2", { role: "main" }));
});

test("Prüfen zeigt den Bericht, Einladung erzeugen, Notiz speichern", async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(await screen.findByTestId("discord-guild-2-health"));
  expect(await screen.findByTestId("discord-guild-2-report")).toHaveTextContent("Dem Bot fehlen: „Rollen verwalten“.");
  await user.click(screen.getByTestId("discord-guild-2-invite"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Einladungslink erzeugt."));
  await user.type(screen.getByTestId("discord-guild-2-note"), "Server für Rocket League");
  await user.click(screen.getByTestId("discord-guild-2-note-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/settings/discord/guilds/2", { note: "Server für Rocket League" }));
});

test("Test: am Hauptserver sofort, am Unterserver erst nach Bestätigung (Systemkanal ist öffentlich)", async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(await screen.findByTestId("discord-guild-1-test"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/guilds/1/test", {}));
  await user.click(screen.getByTestId("discord-guild-2-test"));
  expect(await screen.findByText(/den sehen alle auf diesem Server/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Senden" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/guilds/2/test", { confirm: true }));
});

test("ohne bekannte Server ein ruhiger Satz", async () => {
  apiMock.get.mockResolvedValue({ data: { guilds: [], connected: false, bot_invite_url: null } });
  renderPanel();
  expect(await screen.findByTestId("discord-guilds-empty")).toHaveTextContent("Noch kein Server bekannt");
  expect(screen.getByTestId("discord-guilds")).toHaveTextContent("nicht verbunden");
});

// Kanäle je Server (#625): ein Unterserver wählt Community, News und Events aus seiner eigenen Kanalliste.
test("Unterserver: Kanäle aus seiner Liste wählen und speichern; der Hauptserver hat hier keine Kanalwahl", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/settings/discord/guilds/2/channels") return { data: { ok: true, channels: [{ id: "200000000000000001", name: "allgemein", can_send: true }, { id: "200000000000000002", name: "regeln", can_send: false }] } };
    return { data: { guilds: [MAIN, { ...SUB, channels: {} }], connected: true, bot_invite_url: null } };
  });
  renderPanel();
  const select = await screen.findByTestId("discord-guild-2-channel-community");
  await waitFor(() => expect(select.querySelectorAll("option")).toHaveLength(3));
  expect(select.querySelector("option[value='200000000000000002']").disabled).toBe(true);
  expect(screen.queryByTestId("discord-guild-1-channels")).toBeNull();
  expect(screen.getByTestId("discord-guild-2-channels")).toHaveTextContent("nur am Hauptserver");
  await user.selectOptions(select, "200000000000000001");
  await user.click(screen.getByTestId("discord-guild-2-channels-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/settings/discord/guilds/2", { channels: { community: "200000000000000001", news: "", events: "" } }));
});
