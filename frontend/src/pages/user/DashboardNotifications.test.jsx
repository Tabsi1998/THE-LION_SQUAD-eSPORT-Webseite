import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Der Kasten „Benachrichtigungen“ im Dashboard (#984, #987, Rest aus #1543): ein Ladefehler ist kein „Keine
// Benachrichtigungen“; „gelesen“ setzt sofort, was der Server ablehnt, wird wieder ungelesen und steht mit
// „Nochmal versuchen“ da. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const live = { reload: null };
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback) => { live.reload = callback; } }));

const { DashboardNotifications } = await import("./DashboardNotifications");

const ROWS = [
  { id: "n-1", kind: "general", title: "Dein Match startet", body: "", url: "", meta: {}, read: false, created_at: "2026-10-14T10:00:00Z" },
  { id: "n-2", kind: "general", title: "Neue Einladung", body: "", url: "", meta: {}, read: false, created_at: "2026-10-14T08:00:00Z" },
  { id: "n-3", kind: "general", title: "Neuer Beitrag", body: "", url: "", meta: {}, read: true, created_at: "2026-10-13T08:00:00Z" },
];
const serverError = () => Object.assign(new Error("boom"), { response: { status: 500, data: {} } });

function show() {
  return render(<MemoryRouter><DashboardNotifications /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockResolvedValue({ data: ROWS });
});

test("ein Ladefehler ist ein Fehler mit „Nochmal versuchen“, nicht „Keine Benachrichtigungen“", async () => {
  apiMock.get.mockRejectedValueOnce(serverError());
  show();
  const box = screen.getByTestId("dashboard-notifications");
  expect(await within(box).findByTestId("dashboard-notifications-error")).toHaveTextContent("Die Benachrichtigungen konnten nicht geladen werden.");
  expect(box).not.toHaveTextContent("Keine Benachrichtigungen.");
  fireEvent.click(within(box).getByRole("button", { name: /Nochmal versuchen/ }));
  expect(await screen.findByText("Dein Match startet")).toBeInTheDocument();
  expect(screen.queryByTestId("dashboard-notifications-error")).toBeNull();
});

test("leer nur nach einer erfolgreichen Antwort", async () => {
  apiMock.get.mockResolvedValue({ data: [] });
  show();
  expect(await screen.findByText("Keine Benachrichtigungen.")).toBeInTheDocument();
});

test("ein gescheitertes Nachladen lässt die Liste stehen und sagt es", async () => {
  show();
  await screen.findByText("Dein Match startet");
  apiMock.get.mockRejectedValueOnce(serverError());
  await act(async () => { await live.reload(); });
  expect(screen.getByText("Dein Match startet")).toBeInTheDocument();
  expect(screen.getByTestId("load-stale")).toHaveTextContent("Du siehst den letzten Stand.");
});

test("Gelesen scheitert: die Zeile ist wieder ungelesen, der Hinweis bietet „Nochmal versuchen“", async () => {
  show();
  const row = await screen.findByTestId("dashboard-notification-n-1");
  apiMock.post.mockRejectedValueOnce(serverError());
  await act(async () => { fireEvent.click(within(row).getByText("Dein Match startet")); });
  await waitFor(() => expect(screen.getByTestId("dashboard-notifications-action-error")).toHaveTextContent("Die Benachrichtigung konnte nicht als gelesen markiert werden."));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/notifications/n-1/read");
  expect(screen.getByTestId("dashboard-notification-n-1").querySelector(".rounded-full")).not.toBeNull();

  apiMock.post.mockResolvedValueOnce({ data: {} });
  await act(async () => { fireEvent.click(within(screen.getByTestId("dashboard-notifications-action-error")).getByRole("button", { name: /Nochmal versuchen/ })); });
  await waitFor(() => expect(screen.queryByTestId("dashboard-notifications-action-error")).toBeNull());
  expect(apiMock.post).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("dashboard-notification-n-1").querySelector(".rounded-full")).toBeNull();
});

test("die fünf neuesten Bündel, darunter „Alle N anzeigen“", async () => {
  const many = Array.from({ length: 8 }, (_, index) => ({ id: `m-${index}`, kind: "general", title: `Hinweis ${index + 1}`, body: "", url: "", meta: {}, read: true, created_at: `2026-10-${String(13 - index).padStart(2, "0")}T08:00:00Z` }));
  apiMock.get.mockResolvedValue({ data: many });
  show();
  expect(await screen.findByText("Hinweis 5")).toBeInTheDocument();
  expect(screen.queryByText("Hinweis 6")).toBeNull();
  expect(screen.getByTestId("dashboard-notifications-all")).toHaveTextContent("Alle 8 anzeigen");
});
