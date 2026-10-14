import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Benachrichtigungsseite (#984, #987): ein Ladefehler zeigt den Fehler statt „Keine Benachrichtigungen.“; scheitert
// „Alle als gelesen markieren“, steht das mit „Nochmal versuchen“ da. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "", formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <main>{children}</main> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1", username: "neonfalke" } }) }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));

const { default: NotificationsPage } = await import("./NotificationsPage");

const ROWS = [{ id: "n-1", kind: "match", title: "Dein Match startet", read: false, created_at: "2026-10-14T10:00:00Z" }];
const serverError = () => Object.assign(new Error("boom"), { response: { status: 500, data: {} } });

function renderPage() {
  return render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

test("ein Ladefehler zeigt den Fehler mit „Nochmal versuchen“, nicht „Keine Benachrichtigungen.“", async () => {
  apiMock.get.mockRejectedValueOnce(serverError()).mockResolvedValueOnce({ data: ROWS });
  renderPage();
  expect(await screen.findByTestId("public-error-state")).toHaveTextContent("Benachrichtigungen konnten nicht geladen werden");
  expect(screen.queryByText("Keine Benachrichtigungen.")).toBeNull();
  fireEvent.click(screen.getByTestId("public-error-retry"));
  expect(await screen.findByText("Dein Match startet")).toBeInTheDocument();
});

test("„Alle als gelesen markieren“ scheitert: der Zähler bleibt, der Fehler steht da", async () => {
  apiMock.get.mockResolvedValue({ data: ROWS });
  apiMock.post.mockRejectedValueOnce(serverError());
  renderPage();
  fireEvent.click(await screen.findByTestId("notifications-mark-all-read"));
  expect(await screen.findByTestId("notifications-action-error")).toHaveTextContent("nicht als gelesen markiert");
  await waitFor(() => expect(screen.getByText(/1 ungelesen/)).toBeInTheDocument());
});
