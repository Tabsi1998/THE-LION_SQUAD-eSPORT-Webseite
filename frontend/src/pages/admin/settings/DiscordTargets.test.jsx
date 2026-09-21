import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Discord-Ziele und Schalter (#300): die Seite sagt ehrlich, wohin etwas geht – und dass der
// Vorstand ohne eigenen Webhook nichts bekommt, statt still in der Community zu landen.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordTargets, deliveryText } = await import("./DiscordTargets");

const DATA = {
  targets: { news: { configured: true, username: "" }, events: { configured: false, username: "" }, achievements: { configured: false, username: "" }, board: { configured: false, username: "" } },
  events: [
    { key: "news.published", label: "News veröffentlicht", target: "news", enabled: false },
    { key: "tournament.live", label: "Turnier: jetzt live", target: "events", enabled: true },
    { key: "membership.application", label: "Neuer Mitgliedsantrag", target: "board", enabled: false },
  ],
  target_status: {
    community: { label: "Community (Standard)", private: false, configured: true, delivers_to: "community", last: null },
    news: { label: "News", private: false, configured: true, delivers_to: "news", last: { status: "failed", status_code: 404, created_at: "2026-09-21T10:00:00+00:00" } },
    events: { label: "Events und Turniere", private: false, configured: false, delivers_to: "community", last: null },
    achievements: { label: "Erfolge", private: false, configured: false, delivers_to: "community", last: null },
    board: { label: "Vorstand (privat)", private: true, configured: false, delivers_to: null, last: null },
    ops: { label: "Betrieb (privat)", private: true, configured: true, delivers_to: "ops", last: null },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: DATA });
  apiMock.put.mockResolvedValue({ data: { ok: true } });
  apiMock.post.mockResolvedValue({ data: { ok: true, target: "community" } });
});

test("wohin ein Ziel wirklich liefert, steht in Worten da", () => {
  expect(deliveryText("news", DATA.target_status)).toBe("eigener Webhook");
  expect(deliveryText("events", DATA.target_status)).toBe("kein eigener Webhook – geht an Community");
  expect(deliveryText("board", DATA.target_status)).toBe("kein Webhook – es wird nichts gesendet");
});

test("Vorstand ist als privat erkennbar, ein kaputter Webhook steht beim Ziel", async () => {
  render(<DiscordTargets />);
  const board = await screen.findByTestId("discord-target-board");
  expect(board).toHaveTextContent("kein Webhook – es wird nichts gesendet");
  expect(board).toHaveTextContent("ohne Namen");
  expect(screen.getByTestId("discord-target-news")).toHaveTextContent("fehlgeschlagen (404)");
});

test("Webhook speichern, Schalter umlegen, Test sagt, wenn er in der Community gelandet ist", async () => {
  const user = userEvent.setup();
  render(<DiscordTargets />);
  await user.type(await screen.findByTestId("discord-target-board-url"), "https://discord.com/api/webhooks/3/board");
  await user.click(screen.getByTestId("discord-target-board-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { targets: { board: { webhook_url: "https://discord.com/api/webhooks/3/board" } } }));

  await user.click(screen.getByTestId("discord-event-news.published").querySelector("input"));
  await waitFor(() => expect(apiMock.put).toHaveBeenLastCalledWith("/settings/discord", { events: { "news.published": true } }));

  await user.click(screen.getByTestId("discord-target-events-test"));
  await waitFor(() => expect(toastMock.success).toHaveBeenLastCalledWith("Test gesendet – ging an Community, weil kein eigener Webhook da ist."));
});
