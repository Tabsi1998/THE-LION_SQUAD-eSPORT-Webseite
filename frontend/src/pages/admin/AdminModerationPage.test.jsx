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

function mockApi({ filter = FILTER_OFF, items = ITEMS } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/moderation/word-filter")) return { data: filter };
    if (url.startsWith("/moderation/items")) return { data: items };
    if (url.startsWith("/moderation/reports")) return { data: [] };
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
