import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { seasonTarget } from "@/lib/seasonTabs";

// Liga im Discord je Season (#1642): Vorgabe aus, Kanal nur aus den freigegebenen Kanälen (Nr. 234; ein gespeicherter, nicht mehr
// freigegebener bleibt sichtbar - mit Hinweis), Speichern schickt Schalter und ganze Zahlen, Hinweis bei nicht öffentlicher Season,
// Hinweise zu unklaren bzw. aufgegebenen Meldungen, nur lesen ohne Recht. Erfundene Kanäle.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
const live = { callback: null, options: null };
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback, _resources, options) => { live.callback = callback; live.options = options; } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonDiscordPanel, channelOptions, discordPayload } = await import("./SeasonDiscordPanel");

const DEFAULTS = { matchday: false, season_end: false, channel_id: "", wait_hours: 48, late: true, table_rows: 5 };
const CHANNELS = [{ id: "111", purpose: "Events und Turniere", name: "liga-ergebnisse", category: "Liga", can_send: true },
  { id: "222", purpose: "News", name: "", category: "", can_send: false }];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
  apiMock.post.mockReset();
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

test("Fehler des Servers am Kasten; nicht öffentliche Season mit Hinweis; kein Kanal freigegeben: kein freies Feld, sondern der Weg dorthin", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: { ...DEFAULTS, season_end: true, channel_id: "999" }, active: true, public: false, channels: [],
    channel_approved: false, channels_ok: false, channels_text: "Der Bot ist offline." } });
  apiMock.put.mockRejectedValue({ response: { data: { detail: "Dieser Kanal ist nicht freigegeben." } } });
  render(<SeasonDiscordPanel seasonId="s1" />);
  expect(await screen.findByTestId("season-discord-hidden")).toBeInTheDocument();
  expect(screen.queryByTestId("season-discord-channel-id")).toBeNull();
  expect(screen.getByTestId("season-discord-no-channels")).toHaveTextContent("Kanäle je Zweck");
  expect(screen.getByTestId("season-discord-not-approved")).toHaveTextContent("nicht freigegeben");
  expect(screen.getByTestId("season-discord-channel")).toHaveValue("999");
  expect(screen.getByTestId("season-discord")).toHaveTextContent("Der Bot ist offline.");
  fireEvent.click(screen.getByTestId("season-discord-save"));
  expect(await screen.findByRole("alert")).toHaveTextContent("nicht freigegeben");
});

test("Hinweise: unklare Zustellung und aufgegebene Meldungen stehen im Kasten; das Wartefeld nennt die Spielwoche", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: { ...DEFAULTS, matchday: true, channel_id: "111" }, active: true, public: true, channels: CHANNELS,
    channel_approved: true, problems: [
      { kind: "season_end", label: "Saisonende", status: "unclear", text: "Unklar, ob die Meldung ankam - bitte im Kanal nachsehen.", at: "2026-11-23T10:00:00+00:00" },
      { kind: "matchday", label: "Spieltag 3 · Staffel A", status: "failed", text: "Nach 3 Versuchen nicht gesendet.", at: "2026-11-22T10:00:00+00:00" },
    ] } });
  render(<SeasonDiscordPanel seasonId="s1" />);
  const list = await screen.findByTestId("season-discord-problems");
  expect(list).toHaveTextContent("Saisonende");
  expect(list).toHaveTextContent("im Kanal nachsehen");
  expect(list).toHaveTextContent("Spieltag 3 · Staffel A");
  expect(screen.getByText("Warten auf Ergebnisse (Stunden nach Ende der Spielwoche)")).toBeInTheDocument();
  expect(screen.queryByTestId("season-discord-not-approved")).toBeNull();
});

test("ohne Recht nur lesen", async () => {
  apiMock.get.mockResolvedValue({ data: { settings: DEFAULTS, active: false, public: true, channels: CHANNELS } });
  render(<SeasonDiscordPanel seasonId="s1" canEdit={false} />);
  expect(await screen.findByTestId("season-discord-readonly")).toBeInTheDocument();
  expect(screen.getByTestId("season-discord-matchday")).toBeDisabled();
  expect(screen.queryByTestId("season-discord-save")).toBeNull();
});

test("Helfer: freigegebene Kanäle mit Zweck, ein nicht mehr freigegebener bleibt sichtbar; Zahlen leer nehmen die Vorgabe; Sprungmarke", () => {
  expect(channelOptions(CHANNELS, "333")).toEqual([
    ["", "– kein Kanal –"], ["333", "Kanal 333 (nicht freigegeben)"], ["111", "Events und Turniere · Liga › #liga-ergebnisse"],
    ["222", "News · Kanal 222 (Bot darf dort nicht schreiben)"]]);
  expect(discordPayload({ matchday: 1, season_end: 0, late: true, channel_id: " 111 ", wait_hours: "", table_rows: "3" }))
    .toEqual({ matchday: true, season_end: false, late: true, channel_id: "111", wait_hours: null, table_rows: 3 });
  expect(seasonTarget("#discord")).toEqual({ tab: "termine", section: "discord" });
  expect(seasonTarget("#tv-finale")).toEqual({ tab: "abschluss", section: "tv-finale" });
});

// ---------------------------------------------------------------- Runde 2: „Noch einmal senden“ (Nr. 239) und Nachladen (K5)

const UNCLEAR = { key: "season_end:s1", kind: "season_end", label: "Saisonende", status: "unclear", at: "2026-11-24T10:00:00+00:00",
  text: "Ob die Meldung ankam, ist unklar. Bitte im Kanal nachsehen." };
const LIVE = { settings: { ...DEFAULTS, season_end: true, channel_id: "111" }, active: true, public: true, channels: CHANNELS, channel_approved: true };

test("Nr. 239: je Hinweis „Noch einmal senden“ - erst nach der Bestätigung „Ich habe im Kanal nachgesehen, die Meldung fehlt“, mit Toast", async () => {
  const { toast } = await import("sonner");
  apiMock.get.mockResolvedValue({ data: { ...LIVE, problems: [UNCLEAR] } });
  apiMock.post.mockResolvedValue({ data: { ...LIVE, problems: [] } });
  render(<SeasonDiscordPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("season-discord-release-season_end:s1"));
  const go = screen.getByTestId("season-discord-release-go");
  expect(go).toBeDisabled();
  fireEvent.click(screen.getByTestId("season-discord-release-confirm"));
  expect(screen.getByText("Ich habe im Kanal nachgesehen, die Meldung fehlt")).toBeInTheDocument();
  fireEvent.click(go);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/discord/release", { key: "season_end:s1", confirm: true }));
  await waitFor(() => expect(screen.queryByTestId("season-discord-problems")).toBeNull());
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("nächsten Lauf"));
});

test("Nr. 239: ohne Recht kein Knopf; schon freigegeben (409): Hinweis und neu geladen", async () => {
  apiMock.get.mockResolvedValue({ data: { ...LIVE, problems: [UNCLEAR] } });
  const { unmount } = render(<SeasonDiscordPanel seasonId="s1" canEdit={false} />);
  await screen.findByTestId("season-discord-problems");
  expect(screen.queryByTestId("season-discord-release-season_end:s1")).toBeNull();
  unmount();
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValueOnce({ data: { ...LIVE, problems: [UNCLEAR] } }).mockResolvedValue({ data: { ...LIVE, problems: [] } });
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Diese Meldung ist schon freigegeben oder gesendet." } } });
  render(<SeasonDiscordPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("season-discord-release-season_end:s1"));
  fireEvent.click(screen.getByTestId("season-discord-release-confirm"));
  fireEvent.click(screen.getByTestId("season-discord-release-go"));
  expect(await screen.findByRole("alert")).toHaveTextContent("schon freigegeben");
  await waitFor(() => expect(screen.queryByTestId("season-discord-problems")).toBeNull());
});

test("K5: die Hinweise laden live nach - ohne das Formular zu überschreiben, an dem gerade jemand tippt", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { ...LIVE, problems: [] } });
  render(<SeasonDiscordPanel seasonId="s1" />);
  fireEvent.change(await screen.findByTestId("season-discord-rows"), { target: { value: "9" } });
  expect(live.callback).toBeTypeOf("function");
  expect(live.options.fallbackMs).toBeGreaterThan(0);
  apiMock.get.mockResolvedValueOnce({ data: { ...LIVE, problems: [UNCLEAR] } });
  await live.callback();
  expect(await screen.findByTestId("season-discord-problems")).toHaveTextContent("Saisonende");
  expect(screen.getByTestId("season-discord-rows")).toHaveValue(9);
});
