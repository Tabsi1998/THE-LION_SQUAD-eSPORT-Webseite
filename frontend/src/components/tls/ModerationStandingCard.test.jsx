import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Der eigene Stand bei der Moderation (#416): die Karte zeigt die laufende Maßnahme mit Grund und
// Dauer, die Treffer und was beim nächsten käme; der Einspruch geht an die Moderation. Im Dashboard
// (compact) erscheint sie nur, wenn es etwas gibt.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { ModerationStandingCard } = await import("./ModerationStandingCard");

const WARNING = {
  strike_count: 2, strike_ttl_months: 12,
  active: { id: "s1", action: "warning", label: "Verwarnung mit Chat-Sperre", reason: "2. Treffer innerhalb von 12 Monaten – zuletzt: schon wieder", created_at: "2026-09-24T01:00:00Z", chat_blocked_until: "2026-09-25T01:00:00Z", open_until_decision: false, appeal: null },
  chat_block: { until: "2026-09-25T01:00:00Z" },
  strikes: [{ id: "k1", source_label: "Wortfilter", note: "Beleidigung", created_at: "2026-09-23T20:00:00Z" }, { id: "k2", source_label: "Moderation", note: "schon wieder", created_at: "2026-09-24T01:00:00Z" }],
  history: [{ id: "s1", label: "Verwarnung mit Chat-Sperre", status: "active", created_at: "2026-09-24T01:00:00Z" }],
  next_level: { strikes: 3, action: "suspension", label: "Sperre bis zur Entscheidung" }, can_appeal: true,
};
const CLEAN = { strike_count: 0, strike_ttl_months: 12, active: null, chat_block: null, strikes: [], history: [], next_level: { strikes: 1, action: "notice", label: "Hinweis" }, can_appeal: false };

beforeEach(() => {
  apiMock.get.mockReset(); apiMock.post.mockReset(); toastMock.success.mockReset(); toastMock.error.mockReset();
});

test("Verwarnung: Grund, Chat-Sperre, Treffer, nächste Stufe - und der Einspruch geht raus", async () => {
  apiMock.get.mockResolvedValue({ data: WARNING });
  apiMock.post.mockResolvedValue({ data: { ok: true, standing: { ...WARNING, can_appeal: false, active: { ...WARNING.active, appeal: { status: "open", created_at: "2026-09-24T02:00:00Z" } } } } });
  render(<MemoryRouter><ModerationStandingCard /></MemoryRouter>);
  const active = await screen.findByTestId("standing-active");
  expect(active).toHaveTextContent("Verwarnung mit Chat-Sperre");
  expect(active).toHaveTextContent("Chat gesperrt bis");
  expect(active).toHaveTextContent("Grund: 2. Treffer");
  expect(screen.getByTestId("standing-strikes")).toHaveTextContent("2 Treffer in den letzten 12 Monaten · beim 3. Treffer: Sperre bis zur Entscheidung");
  expect(screen.getByTestId("standing-strike-list")).toHaveTextContent("Wortfilter · Beleidigung");

  fireEvent.click(screen.getByTestId("standing-appeal-send"));
  expect(toastMock.error).toHaveBeenCalled();
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("standing-appeal-message"), { target: { value: "Das war ein Missverständnis, bitte prüft die Nachricht noch einmal." } });
  fireEvent.click(screen.getByTestId("standing-appeal-send"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/moderation/me/appeal", { sanction_id: "s1", message: "Das war ein Missverständnis, bitte prüft die Nachricht noch einmal." }));
  expect(await screen.findByTestId("standing-appeal-state")).toHaveTextContent("liegt bei der Moderation");
  expect(screen.queryByTestId("standing-appeal-form")).toBeNull();
});

test("ohne Maßnahme: im Dashboard unsichtbar, auf „Meine Strafen“ ein klarer Stand", async () => {
  apiMock.get.mockResolvedValue({ data: CLEAN });
  const { unmount } = render(<MemoryRouter><ModerationStandingCard compact /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/moderation/me/standing"));
  expect(screen.queryByTestId("moderation-standing")).toBeNull();
  unmount();
  render(<MemoryRouter><ModerationStandingCard /></MemoryRouter>);
  expect(await screen.findByTestId("standing-clear")).toHaveTextContent("Keine laufende Maßnahme.");
  expect(screen.getByTestId("standing-strikes")).toHaveTextContent("0 Treffer");
});
