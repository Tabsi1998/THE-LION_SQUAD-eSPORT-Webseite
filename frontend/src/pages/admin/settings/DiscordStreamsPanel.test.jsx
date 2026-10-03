import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Stream-Meldungen (#866): Schalter, Kanal, Ende, Rolle - gespeichert erst mit „Speichern“; der Stand sagt in Worten,
// was los ist; „Aussehen gestalten“ führt zur Gestaltung.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordStreamsPanel, streamStateText } = await import("./DiscordStreamsPanel");

const STATE = { enabled: false, channel_id: "", on_end: "edit", role_id: "", open: 0, last_run_at: null, last_error: null,
  reason: "disabled", reason_text: "Stream-Meldungen sind aus.", roles: [{ id: "300000000000000001", name: "Stream-Ping" }], roles_available: true };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => (url === "/settings/discord/streams" ? { data: STATE }
    : { data: { channels: [{ id: "100000000000000011", name: "live", can_send: true, can_embed: true }, { id: "100000000000000012", name: "regeln", can_send: false }] } }));
  apiMock.put.mockImplementation(async (url, body) => ({ data: { ...STATE, ...body, reason: null, reason_text: null, open: 0 } }));
});

test("der Stand in Worten", () => {
  expect(streamStateText({ reason_text: "aus" })).toBe("aus");
  expect(streamStateText({ open: 2, last_error: "kein Recht" })).toBe("2 Streams werden gerade gemeldet · letzter Fehler: kein Recht");
  expect(streamStateText({ open: 0 })).toBe("gerade niemand live");
});

test("Schalter, Kanal, Ende und Rolle gehen gemeinsam an den Server", async () => {
  const onDesign = vi.fn();
  render(<DiscordStreamsPanel onDesign={onDesign} />);
  expect(await screen.findByTestId("discord-streams-state")).toHaveTextContent("Stream-Meldungen sind aus.");
  expect(screen.getByTestId("discord-streams-save")).toBeDisabled();
  fireEvent.click(screen.getByTestId("discord-streams-enabled"));
  await screen.findByRole("option", { name: "#live" });
  expect(screen.getByRole("option", { name: "#regeln – Bot darf hier nicht schreiben" })).toBeDisabled();
  fireEvent.change(screen.getByTestId("discord-streams-channel"), { target: { value: "100000000000000011" } });
  fireEvent.change(screen.getByTestId("discord-streams-end"), { target: { value: "delete" } });
  fireEvent.change(screen.getByTestId("discord-streams-role"), { target: { value: "300000000000000001" } });
  fireEvent.click(screen.getByTestId("discord-streams-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord/streams", { enabled: true, channel_id: "100000000000000011", on_end: "delete", role_id: "300000000000000001" }));
  expect(toastMock.success).toHaveBeenCalledWith("Stream-Meldungen gespeichert – der nächste Stream wird gemeldet.");
  fireEvent.click(screen.getByTestId("discord-streams-design"));
  expect(onDesign).toHaveBeenCalled();
});

test("ohne Bot-Verbindung wird die Rolle als Nummer eingetragen", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/settings/discord/streams" ? { data: { ...STATE, roles: [], roles_available: false } } : { data: { channels: [] } }));
  render(<DiscordStreamsPanel />);
  const role = await screen.findByTestId("discord-streams-role");
  fireEvent.change(role, { target: { value: "ab300" } });
  expect(role).toHaveValue("300");
  expect(screen.queryByTestId("discord-streams-design")).toBeNull();
});
