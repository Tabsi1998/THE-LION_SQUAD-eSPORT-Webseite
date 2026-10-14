import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Toast „Öffnen“ der Glocke (Rest aus #1543, Muster #987): führt sofort ans Ziel und markiert als gelesen. Lehnt der
// Server ab, ist die Benachrichtigung wieder ungelesen und ein Hinweis bietet „Nochmal versuchen“ - nichts wird still
// verschluckt. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const live = { reload: null };
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback) => { live.reload = callback; } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1", username: "neonfalke" } }) }));
vi.mock("@/components/tls/LevelAvatarFrame", () => ({ refreshCrowns: () => Promise.resolve({}) }));
const toastMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { NotificationBell } = await import("./NotificationBell");

const OLD = { id: "n-1", kind: "general", title: "Alt", body: "", url: "", meta: {}, read: true, created_at: "2026-10-13T08:00:00Z" };
const FRESH = { id: "n-9", kind: "general", title: "Neue Einladung", body: "Komm ins Team", url: "/teams/t-1", meta: {}, read: false, created_at: "2026-10-14T10:00:00Z" };
const serverError = () => Object.assign(new Error("boom"), { response: { status: 500, data: {} } });

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

async function freshToast() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <NotificationBell />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));
  apiMock.get.mockResolvedValue({ data: [FRESH, OLD] });
  await act(async () => { await live.reload(); });
  await waitFor(() => expect(toastMock.info).toHaveBeenCalledTimes(1));
  return toastMock.info.mock.calls[0][1].action;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: [OLD] });
});

test("„Öffnen“ führt ans Ziel und markiert gelesen", async () => {
  const action = await freshToast();
  expect(action.label).toBe("Öffnen");
  apiMock.post.mockResolvedValueOnce({ data: {} });
  await act(async () => { await action.onClick(); });
  expect(screen.getByTestId("where")).toHaveTextContent("/teams/t-1");
  expect(apiMock.post).toHaveBeenCalledWith("/admin/notifications/n-9/read");
  expect(toastMock.error).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByTestId("notification-unread-badge")).toBeNull());
});

test("lehnt der Server „gelesen“ ab, bleibt sie ungelesen und ein Hinweis bietet „Nochmal versuchen“", async () => {
  const action = await freshToast();
  apiMock.post.mockRejectedValueOnce(serverError());
  await act(async () => { await action.onClick(); });
  expect(screen.getByTestId("where")).toHaveTextContent("/teams/t-1");
  expect(screen.getByTestId("notification-unread-badge")).toHaveTextContent("1");
  expect(toastMock.error).toHaveBeenCalledTimes(1);
  const [message, options] = toastMock.error.mock.calls[0];
  expect(message).toBe("Die Benachrichtigung konnte nicht als gelesen markiert werden.");
  expect(options.action.label).toBe("Nochmal versuchen");

  apiMock.post.mockResolvedValueOnce({ data: {} });
  await act(async () => { await options.action.onClick(); });
  expect(apiMock.post).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.queryByTestId("notification-unread-badge")).toBeNull());
});
