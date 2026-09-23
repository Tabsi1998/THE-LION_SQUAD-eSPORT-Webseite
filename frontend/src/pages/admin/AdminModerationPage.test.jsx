import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Moderation mit Wortfilter (#417): drei Reiter; die Wortliste lässt sich einschalten und füllen,
// zurückgehaltene Funde lassen sich freigeben, markierte als gesehen abhaken.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminModerationPage = (await import("./AdminModerationPage")).default;

const FILTER_OFF = { enabled: false, entries: [], counts: { entries: 0, pending: 0, flagged: 0 } };
const FILTER_ON = { enabled: true, entries: [{ id: "e1", term: "Scheiße", action: "hold", note: "grob" }], counts: { entries: 1, pending: 1, flagged: 0 } };
const ITEMS = [
  { id: "i1", kind: "direct", kind_label: "Direktnachricht", state: "pending", action: "hold", excerpt: "So eine sch31sse!", matched: ["Scheiße"], user: { username: "paula", display_name: "Paula" }, created_at: "2026-09-23T10:00:00Z" },
  { id: "i2", kind: "team_name", kind_label: "Teamname", state: "flagged", action: "flag", excerpt: "Noob Slayers", matched: ["noob"], user: { username: "otto" }, created_at: "2026-09-23T10:01:00Z" },
];

const PEOPLE = [{ user_id: "u1", user: { id: "u1", username: "paula", display_name: "Paula" }, strikes: 2, active_strikes: 2, sanctions: 1, open_appeal: true, last_event_at: "2026-09-24T01:00:00Z",
  active: { id: "s1", action: "warning", label: "Verwarnung mit Chat-Sperre", chat_blocked_until: "2026-09-25T01:00:00Z" } }];
const DETAIL = {
  user: { id: "u1", username: "paula", display_name: "Paula" }, active_strike_count: 2, settings: { strike_ttl_months: 12, levels: [] },
  strikes: [{ id: "k1", source_label: "Wortfilter", note: "Beleidigung", created_at: "2026-09-23T20:00:00Z", revoked: false }],
  sanctions: [{ id: "s1", action: "warning", label: "Verwarnung mit Chat-Sperre", status: "active", automatic: true, reason: "2. Treffer", created_at: "2026-09-24T01:00:00Z" }],
  active: { id: "s1", action: "warning", label: "Verwarnung mit Chat-Sperre", chat_blocked_until: "2026-09-25T01:00:00Z", appeal: { status: "open", message: "War ein Missverständnis.", created_at: "2026-09-24T02:00:00Z" } },
  reports: [],
};
const LEVELS = { levels: [{ strikes: 1, action: "notice", chat_hours: 0 }, { strikes: 2, action: "warning", chat_hours: 24 }, { strikes: 3, action: "suspension", chat_hours: 0 }], strike_ttl_months: 12 };

function mockApi({ filter = FILTER_OFF, items = ITEMS } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/moderation/word-filter")) return { data: filter };
    if (url.startsWith("/moderation/items")) return { data: items };
    if (url.startsWith("/moderation/reports")) return { data: [] };
    if (url === "/moderation/people") return { data: PEOPLE };
    if (url.startsWith("/moderation/people/")) return { data: DETAIL };
    if (url === "/moderation/levels") return { data: LEVELS };
    return { data: [] };
  });
}

beforeEach(() => {
  apiMock.post.mockReset(); apiMock.patch.mockReset(); apiMock.put.mockReset();
  toastMock.success.mockReset();
});

test("Wortfilter: einschalten und einen Eintrag anlegen", async () => {
  mockApi();
  apiMock.put.mockResolvedValue({ data: { ...FILTER_OFF, enabled: true } });
  apiMock.post.mockResolvedValue({ data: FILTER_ON });
  render(<MemoryRouter><AdminModerationPage /></MemoryRouter>);
  fireEvent.click(screen.getByTestId("moderation-tab-filter"));
  const toggle = await screen.findByTestId("word-filter-enabled");
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/moderation/word-filter", { enabled: true }));
  await waitFor(() => expect(screen.getByTestId("word-filter-enabled")).toBeChecked());

  fireEvent.change(screen.getByTestId("word-filter-term"), { target: { value: "Scheiße" } });
  fireEvent.change(screen.getByTestId("word-filter-note"), { target: { value: "grob" } });
  fireEvent.submit(screen.getByTestId("word-filter-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/moderation/word-filter/entries", { term: "Scheiße", action: "hold", note: "grob" }));
  expect(await screen.findByTestId("word-filter-entry-e1")).toHaveTextContent("Scheiße");
  expect(screen.getByTestId("word-filter-entry-action-e1")).toHaveValue("hold");
});

test("Funde: zurückgehaltene Nachricht freigeben, markierten Fund als gesehen abhaken", async () => {
  mockApi({ filter: FILTER_ON });
  apiMock.patch.mockResolvedValue({ data: { ok: true } });
  render(<MemoryRouter><AdminModerationPage /></MemoryRouter>);
  fireEvent.click(screen.getByTestId("moderation-tab-items"));
  const pending = await screen.findByTestId("moderation-item-i1");
  expect(pending).toHaveTextContent("Direktnachricht · wartet · zurückgehalten");
  expect(pending).toHaveTextContent("Treffer: Scheiße");
  fireEvent.click(screen.getByTestId("item-release-i1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/moderation/items/i1", { decision: "release", note: null }));
  expect(toastMock.success).toHaveBeenCalledWith("Nachricht freigegeben.");

  expect(screen.queryByTestId("item-release-i2")).toBeNull();
  fireEvent.click(screen.getByTestId("item-noted-i2"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/moderation/items/i2", { decision: "noted", note: null }));
});

test("Meldungen bleiben der erste Reiter", async () => {
  mockApi();
  render(<MemoryRouter><AdminModerationPage /></MemoryRouter>);
  expect(await screen.findByText("Keine Meldungen in diesem Status.")).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenCalledWith("/moderation/reports?status=open");
});

// Verwarnungen mit Stufen (#416): Personen mit Historie, Stufe von Hand, Einspruch entscheiden; Stufen einstellbar.
test("Personen: Historie öffnen, Einspruch annehmen, Stufe von Hand setzen", async () => {
  mockApi();
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  render(<MemoryRouter initialEntries={["/admin/moderation?tab=people"]}><AdminModerationPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("people-row-paula"));
  const detail = await screen.findByTestId("people-detail");
  expect(detail).toHaveTextContent("2 Treffer in den letzten 12 Monaten");
  expect(screen.getByTestId("people-active")).toHaveTextContent("Verwarnung mit Chat-Sperre");
  expect(screen.getByTestId("people-appeal")).toHaveTextContent("War ein Missverständnis.");
  fireEvent.click(screen.getByTestId("appeal-lift-s1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/moderation/sanctions/s1/appeal-decision", { decision: "lift", note: null }));

  fireEvent.change(screen.getByTestId("people-sanction-action"), { target: { value: "suspension" } });
  fireEvent.change(screen.getByTestId("people-sanction-reason"), { target: { value: "Wiederholte Beleidigungen trotz Verwarnung" } });
  fireEvent.click(screen.getByTestId("people-sanction-set"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/moderation/people/u1/sanctions", { action: "suspension", reason: "Wiederholte Beleidigungen trotz Verwarnung" }));
  fireEvent.click(screen.getByTestId("strike-revoke-k1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/moderation/strikes/k1/revoke", { note: null }));
  expect(screen.getByTestId("people-export")).toHaveAttribute("href", "/api/moderation/people/export.csv");
});

test("Stufen: laden, Verfall ändern, speichern", async () => {
  mockApi();
  apiMock.put.mockResolvedValue({ data: { ...LEVELS, strike_ttl_months: 6 } });
  render(<MemoryRouter><AdminModerationPage /></MemoryRouter>);
  fireEvent.click(screen.getByTestId("moderation-tab-levels"));
  expect(await screen.findByTestId("levels-row-2")).toBeInTheDocument();
  expect(screen.getByTestId("levels-hours-1")).toHaveValue(24);
  fireEvent.change(screen.getByTestId("levels-ttl"), { target: { value: "6" } });
  fireEvent.click(screen.getByTestId("levels-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/moderation/levels", { levels: LEVELS.levels, strike_ttl_months: 6 }));
  expect(toastMock.success).toHaveBeenCalledWith("Stufen gespeichert.");
});

