import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Twitch-Einstellungen auf der Twitch-Seite unter Verbindungen (statt Reiter): lädt Vereinskanal,
// Client ID, die Secret-Marke und den Stand der Abfrage; speichert nur die geänderten Twitch-Felder;
// „Jetzt prüfen“ stößt die Abfrage an.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));

const { TwitchSettings, twitchPayload } = await import("./TwitchSettings");

beforeEach(() => {
  apiMock.put.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/settings/branding") return { data: { club_name: "TLS", twitch_channel: "the_lion_squad", twitch_client_id: "abc", twitch_client_secret_masked: "********", twitch_live_detection: true } };
    if (url === "/admin/streams/status") return { data: { configured: true, enabled: true, client_secret_readable: true, poll: { last_run_at: "2026-09-24T08:00:00+00:00", ok: true, live: 1, checked: 4 }, channels: [], live_count: 1, checked_users: 4, channels_visible: 2 } };
    throw new Error(`unbekannt: ${url}`);
  });
});

test("lädt Kanal, Client ID, Secret-Marke und den Stand; speichert nur die Änderung", async () => {
  apiMock.put.mockResolvedValue({ data: {} });
  render(<TwitchSettings />);
  expect(await screen.findByDisplayValue("the_lion_squad")).toBeInTheDocument();
  expect(screen.getByTestId("twitch-client-secret")).toHaveAttribute("placeholder", "Leer lassen, um Secret beizubehalten");
  await waitFor(() => expect(screen.getByTestId("twitch-card-api")).toHaveTextContent("Credentials gespeichert"));
  fireEvent.change(screen.getByTestId("twitch-channel"), { target: { value: "lion_squad_live" } });
  fireEvent.click(screen.getByTestId("twitch-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/branding", { twitch_channel: "lion_squad_live" }));
  expect(toastMock.success).toHaveBeenCalledWith("Twitch-Einstellungen gespeichert.");
});

test("„Jetzt prüfen“ stößt die Abfrage an; das Secret geht nur mit, wenn neu eingetippt", async () => {
  apiMock.post.mockResolvedValue({ data: { ok: true, live: 1, checked: 4 } });
  render(<TwitchSettings />);
  await screen.findByDisplayValue("the_lion_squad");
  await waitFor(() => expect(screen.getByTestId("twitch-refresh")).not.toBeDisabled());
  fireEvent.click(screen.getByTestId("twitch-refresh"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/streams/refresh"));
  expect(toastMock.success).toHaveBeenCalledWith("Twitch geprüft: 1 live von 4 Kanälen.");
  expect(twitchPayload({ twitch_channel: "a", twitch_client_id: "b", twitch_client_secret: "" })).toEqual({ twitch_channel: "a", twitch_client_id: "b", twitch_live_detection: true, twitch_clips_enabled: false });
  expect(twitchPayload({ twitch_client_secret: "neu" }).twitch_client_secret).toBe("neu");
});
