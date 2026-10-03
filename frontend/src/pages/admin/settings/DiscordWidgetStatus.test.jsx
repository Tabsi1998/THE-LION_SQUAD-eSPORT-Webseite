import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Discord auf der Website (#581): der Bot-Kasten sagt, ob das Server-Widget läuft - sonst warum, mit Klickweg.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { DiscordWidgetStatus, widgetText } = await import("./DiscordWidgetStatus");

beforeEach(() => vi.clearAllMocks());

test("in Worten: läuft mit Zahlen, sonst der Grund", () => {
  expect(widgetText({ available: true, online: 42, in_voice: 5, fetched_at: null })).toBe("Läuft: 42 online, 5 im Voice.");
  expect(widgetText({ available: false, reason_text: "Das Server-Widget ist aus." })).toBe("Das Server-Widget ist aus.");
  expect(widgetText({ available: false })).toContain("jede Minute");
});

test("Widget aus: Klickweg; „Jetzt prüfen“ fragt sofort neu", async () => {
  const user = userEvent.setup();
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "widget_disabled", reason_text: "Das Server-Widget ist aus: Discord → Servereinstellungen → Widget." } });
  apiMock.post.mockResolvedValue({ data: { available: true, online: 12, in_voice: 0, fetched_at: null } });
  render(<DiscordWidgetStatus />);
  expect(await screen.findByTestId("discord-widget-text")).toHaveTextContent("Servereinstellungen → Widget");
  await user.click(screen.getByTestId("discord-widget-check"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/bot/widget/refresh"));
  expect(await screen.findByText("Läuft: 12 online, 0 im Voice.")).toBeInTheDocument();
});
