import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// „So sieht die Meldung aus“ (#303): dasselbe Embed wie beim Senden, und die ehrliche Auskunft,
// warum etwas nicht in den Discord geht.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));

const { DiscordPreview, embedColor } = await import("./DiscordPreview");

beforeEach(() => vi.clearAllMocks());

test("die Farbe des Embeds wird zu einer CSS-Farbe", () => {
  expect(embedColor(0x29b6e8)).toBe("#29b6e8");
  expect(embedColor(255)).toBe("#0000ff");
});

test("die Vorschau zeigt Titel, Felder und Bild und sagt, wohin es geht", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { would_send: true, reason: null, target: "events", embed: {
    title: "📅 LAN-Party", description: "Zwei Tage zocken.", color: 0x00ff88, url: "https://lionsquad.at/events/lan",
    fields: [{ name: "Wann", value: "01.07.2026, 18:00 Uhr" }], image: { url: "https://lionsquad.at/api/static/uploads/public/lan.webp" },
  } } });
  render(<DiscordPreview kind="event" item={{ name: "LAN-Party" }} skip={false} onSkipChange={() => {}} />);
  await user.click(screen.getByTestId("discord-preview-load"));
  await waitFor(() => expect(screen.getByTestId("discord-preview-embed")).toHaveTextContent("LAN-Party"));
  expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/preview", { kind: "event", item: { name: "LAN-Party", discord_skip: false } });
  expect(screen.getByTestId("discord-preview-embed")).toHaveTextContent("01.07.2026, 18:00 Uhr");
  expect(screen.getByTestId("discord-preview-embed").querySelector("img")).toHaveAttribute("src", expect.stringContaining("lan.webp"));
  expect(screen.getByTestId("discord-preview-verdict")).toHaveTextContent("Geht beim Veröffentlichen an: Events und Turniere.");
});

// Discord-Termin (#570): die Vorschau sagt, ob und wie das Event als Termin erscheint.
test("Discord-Termin in der Vorschau: Zeit, Ort und Rückfall-Text", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { would_send: true, reason: null, target: "events", embed: { title: "📅 LAN-Party", color: 1 },
    scheduled_event: { would_create: true, reason: null, existing_id: null, payload: { name: "LAN-Party", start: "2026-10-03T16:00:00+00:00", end: "2026-10-03T18:00:00+00:00", location: "Vereinsheim, Telfs" } } } });
  render(<DiscordPreview kind="event" item={{ name: "LAN-Party" }} skip={false} onSkipChange={() => {}} />);
  await user.click(screen.getByTestId("discord-preview-load"));
  await waitFor(() => expect(screen.getByTestId("discord-preview-scheduled")).toHaveTextContent("Erscheint als Discord-Termin: „LAN-Party“"));
  expect(screen.getByTestId("discord-preview-scheduled")).toHaveTextContent("Vereinsheim, Telfs");

  apiMock.post.mockResolvedValue({ data: { would_send: true, reason: null, target: "events", embed: { title: "x", color: 1 }, scheduled_event: { would_create: false, reason: "disabled", reason_text: "Discord-Termine sind ausgeschaltet." } } });
  await user.click(screen.getByTestId("discord-preview-load"));
  await waitFor(() => expect(screen.getByTestId("discord-preview-scheduled")).toHaveTextContent("Discord-Termine sind ausgeschaltet."));
});

test("interne Inhalte: die Vorschau sagt, dass sie nie in einen öffentlichen Kanal gehen", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { would_send: false, reason: "private_visibility", target: "community", embed: { title: "📰 Intern", color: 1 } } });
  render(<DiscordPreview kind="news" item={{ title: "Intern", visibility: "members" }} skip={false} onSkipChange={() => {}} />);
  await user.click(screen.getByTestId("discord-preview-load"));
  await waitFor(() => expect(screen.getByTestId("discord-preview-verdict")).toHaveTextContent("geht nie in einen öffentlichen Discord-Kanal"));
});

test("„Ohne Discord“ meldet den Haken nach oben", async () => {
  const user = userEvent.setup();
  const onSkipChange = vi.fn();
  render(<DiscordPreview kind="news" item={{ title: "x" }} skip={false} onSkipChange={onSkipChange} />);
  await user.click(screen.getByTestId("discord-skip"));
  expect(onSkipChange).toHaveBeenCalledWith(true);
});
