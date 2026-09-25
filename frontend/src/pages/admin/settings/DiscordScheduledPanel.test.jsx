import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Discord-Termine (#570): zwei Schalter, die sofort speichern; der Stand in Worten.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordScheduledPanel, resultText, whenText } = await import("./DiscordScheduledPanel");

const DATA = { scheduled_events: { enabled: true, internal: false, active: 3, last_run_at: "2026-09-25T10:00:00+00:00", last_result: { created: 1, updated: 2, cancelled: 0, errors: 0, checked: 5 } } };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: DATA });
  apiMock.put.mockResolvedValue({ data: { ok: true, changed: true } });
});

test("Stand in Worten", () => {
  expect(resultText({ created: 1, updated: 2, cancelled: 0, errors: 0 })).toBe("1 angelegt, 2 geändert");
  expect(resultText({ checked: 4 })).toBe("nichts zu tun (4 geprüft)");
  expect(resultText({ skipped: "bot_off" })).toBe("Bot aus – kein Abgleich");
  expect(whenText(null)).toBe("noch nie");
});

test("Schalter speichern sofort; „auch interne“ nur mit eingeschalteten Terminen", async () => {
  const user = userEvent.setup();
  render(<DiscordScheduledPanel />);
  expect(await screen.findByTestId("discord-scheduled-active")).toHaveTextContent("3");
  expect(screen.getByTestId("discord-scheduled-last-run")).toHaveTextContent("1 angelegt, 2 geändert");
  await user.click(screen.getByTestId("discord-scheduled-internal"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { scheduled_events: { internal: true } }));
  await user.click(screen.getByTestId("discord-scheduled-enabled"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { scheduled_events: { enabled: false } }));
  expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("bestehende bleiben stehen"));

  apiMock.get.mockResolvedValue({ data: { scheduled_events: { enabled: false, internal: false, active: 0, last_run_at: null, last_result: null } } });
  render(<DiscordScheduledPanel />);
  await waitFor(() => expect(screen.getAllByTestId("discord-scheduled-internal")[1]).toBeDisabled());
});
