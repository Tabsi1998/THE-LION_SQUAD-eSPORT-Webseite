import { render, screen } from "@testing-library/react";

// Statistik je Server (#631): Zahlen je Server in Worten, ein Hinweis, wenn nicht gezählt wird, und die Summe über alle.

const apiMock = { get: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordStatsPanel, Sparkline } = await import("./DiscordStatsPanel");

const EMPTY = { 7: 0, 30: 0 };
const DATA = {
  counting: true, since: "2026-09-20", keep_days: 35, days: [],
  servers: [
    { guild_id: "1", name: "LION", role: "main", enabled: true, member_count: 1234, messages: { 7: 40, 30: 1500 }, active: { 7: 5, 30: 12 },
      joins: { 7: 1, 30: 9 }, leaves: { 7: 0, 30: 2 }, series: [0, 3, 6] },
    { guild_id: "2", name: "Rocket League", role: "sub", enabled: false, member_count: null, messages: EMPTY, active: EMPTY, joins: EMPTY, leaves: EMPTY, series: [0, 0, 0] },
  ],
  total: { messages: { 7: 40, 30: 1500 }, active: { 7: 5, 30: 12 }, joins: EMPTY, leaves: EMPTY },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: DATA });
});

test("je Server stehen Nachrichten, aktive Konten und Kommen und Gehen da - und die Summe zählt jedes Konto einmal", async () => {
  render(<DiscordStatsPanel />);
  expect(await screen.findByTestId("discord-stats-messages-1")).toHaveTextContent("40 in 7 Tagen · 1.500 in 30");
  expect(apiMock.get).toHaveBeenCalledWith("/settings/discord/stats");
  expect(screen.getByTestId("discord-stats-active-1")).toHaveTextContent("5 in 7 Tagen · 12 in 30");
  expect(screen.getByTestId("discord-stats-members-1")).toHaveTextContent("+9 · −2");
  expect(screen.getByTestId("discord-stats-server-1")).toHaveTextContent("Hauptserver · 1.234 Mitglieder");
  expect(screen.getByTestId("discord-stats-server-2")).toHaveTextContent("Unterserver · ausgeschaltet");
  expect(screen.getByTestId("discord-stats-total")).toHaveTextContent("1.500 Nachrichten in 30 Tagen von 12 aktiven Konten");
  expect(screen.getByRole("img", { name: "Nachrichten der letzten 30 Tage auf LION" }).querySelectorAll("rect")).toHaveLength(3);
  expect(screen.queryByTestId("discord-stats-off")).toBeNull();
  expect(screen.queryByTestId("discord-stats-empty")).toBeNull();
});

test("ist das Zählen aus, steht das da; ohne Daten ein Satz statt leerer Zahlen", async () => {
  apiMock.get.mockResolvedValue({ data: { ...DATA, counting: false } });
  const { unmount } = render(<DiscordStatsPanel />);
  expect(await screen.findByTestId("discord-stats-off")).toHaveTextContent("„Nachrichten zählen“ ist aus");
  unmount();

  apiMock.get.mockResolvedValue({ data: { ...DATA, since: null, servers: [DATA.servers[0]] } });
  render(<DiscordStatsPanel />);
  expect(await screen.findByTestId("discord-stats-empty")).toHaveTextContent("Noch nichts gezählt");
  expect(screen.queryByTestId("discord-stats-total")).toBeNull();
});

test("die Balken zeigen jeden Tag - auch den ohne Nachricht", () => {
  const { container } = render(<Sparkline series={[0, 5, 10]} label="Verlauf" />);
  const bars = [...container.querySelectorAll("rect")].map((bar) => Number(bar.getAttribute("height")));
  expect(bars).toEqual([1, 14, 28]);
});
