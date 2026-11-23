import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { seasonTarget } from "@/lib/seasonTabs";

// Liga im Discord je Season (#1642): Vorgabe aus, Kanal aus der Liste (ein unbekannter bleibt wählbar), Speichern schickt Schalter und
// ganze Zahlen, Hinweis bei nicht öffentlicher Season, nur lesen ohne Recht. Erfundene Kanäle.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonDiscordPanel, channelOptions, discordPayload } = await import("./SeasonDiscordPanel");

const DEFAULTS = { matchday: false, season_end: false, channel_id: "", wait_hours: 48, late: true, table_rows: 5 };
const CHANNELS = [{ id: "111", name: "liga-ergebnisse", category: "Liga", can_send: true }, { id: "222", name: "regeln", category: "", can_send: false }];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
});

test("ohne Einstellung aus; Einschalten mit Kanal speichert Schalter und Zahlen", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: DEFAULTS, active: false, defaults: DEFAULTS, public: true, channels: CHANNELS, channels_ok: true } });
  apiMock.put.mockResolvedValue({ data: { settings: { ...DEFAULTS, matchday: true, channel_id: "111", table_rows: 8 }, active: true, public: true, channels: CHANNELS } });
  render(<SeasonDiscordPanel seasonId="s1" />);
  expect(await screen.findByTestId("season-discord-matchday")).not.toBeChecked();
  expect(screen.getByTestId("season-discord-end")).not.toBeChecked();
  expect(screen.getByTestId("season-discord-wait")).toBeDisabled();
  fireEvent.click(screen.getByTestId("season-discord-matchday"));
  expect(screen.getByTestId("season-discord-channel-missing")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("season-discord-channel"), { target: { value: "111" } });
  expect(screen.queryByTestId("season-discord-channel-missing")).toBeNull();
  fireEvent.change(screen.getByTestId("season-discord-rows"), { target: { value: "8" } });
  fireEvent.click(screen.getByTestId("season-discord-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/discord",
    { matchday: true, season_end: false, late: true, channel_id: "111", wait_hours: 48, table_rows: 8 }));
});

test("Fehler des Servers am Kasten; nicht öffentliche Season mit Hinweis; ohne Liste die Kanal-ID zum Eintragen", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: { ...DEFAULTS, season_end: true, channel_id: "999" }, active: true, public: false, channels: [],
    channels_ok: false, channels_text: "Der Bot ist offline." } });
  apiMock.put.mockRejectedValue({ response: { data: { detail: "Bitte einen Kanal wählen - ohne Kanal geht nichts hinaus." } } });
  render(<SeasonDiscordPanel seasonId="s1" />);
  expect(await screen.findByTestId("season-discord-hidden")).toBeInTheDocument();
  expect(screen.getByTestId("season-discord-channel-id")).toHaveValue("999");
  expect(screen.getByTestId("season-discord")).toHaveTextContent("Der Bot ist offline.");
  fireEvent.click(screen.getByTestId("season-discord-save"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Bitte einen Kanal wählen");
});

test("ohne Recht nur lesen", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: DEFAULTS, active: false, public: true, channels: CHANNELS } });
  render(<SeasonDiscordPanel seasonId="s1" canEdit={false} />);
  expect(await screen.findByTestId("season-discord-readonly")).toBeInTheDocument();
  expect(screen.getByTestId("season-discord-matchday")).toBeDisabled();
  expect(screen.queryByTestId("season-discord-save")).toBeNull();
});

test("Helfer: Kanäle mit Kategorie, unbekannter Kanal bleibt; Zahlen leer nehmen die Vorgabe; Sprungmarke", () => {
  expect(channelOptions(CHANNELS, "333")).toEqual([
    ["", "– kein Kanal –"], ["333", "Kanal 333"], ["111", "Liga › #liga-ergebnisse"], ["222", "#regeln (Bot darf dort nicht schreiben)"]]);
  expect(discordPayload({ matchday: 1, season_end: 0, late: true, channel_id: " 111 ", wait_hours: "", table_rows: "3" }))
    .toEqual({ matchday: true, season_end: false, late: true, channel_id: "111", wait_hours: null, table_rows: 3 });
  expect(seasonTarget("#discord")).toEqual({ tab: "termine", section: "discord" });
  expect(seasonTarget("#tv-finale")).toEqual({ tab: "abschluss", section: "tv-finale" });
});
