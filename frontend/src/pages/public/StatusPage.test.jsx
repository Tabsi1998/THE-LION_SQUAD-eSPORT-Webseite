import { act, render, screen } from "@testing-library/react";

// Statusseite (#1657, Entscheidung 15.10.): zwei Zustände aus der Überwachung, keine Einzelheiten, nur Deutsch.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div data-testid="public-layout">{children}</div> }));
const titleMock = vi.fn();
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: (...args) => titleMock(...args) }));

const { default: StatusPage } = await import("./StatusPage");

beforeEach(() => {
  vi.clearAllMocks();
});

test("alles läuft: ein Satz, wann zuletzt geprüft, nicht im Index", async () => {
  apiMock.get.mockResolvedValue({ data: { state: "ok", checked_at: "2026-11-24T09:31:00Z" } });
  render(<StatusPage />);
  expect(await screen.findByText("Alles läuft")).toBeInTheDocument();
  expect(screen.getByTestId("status-page")).toHaveAttribute("data-state", "ok");
  // Ehrlich (Fabian, 24.11.): geprüft werden nur Website (nginx), Server (API) und Datenbank - nicht App oder Anmeldung.
  expect(screen.getByTestId("status-page")).toHaveTextContent("Website und Server laufen.");
  expect(screen.getByTestId("status-page")).not.toHaveTextContent(/App|Anmeldung/);
  expect(screen.getByTestId("status-page")).toHaveTextContent("Zuletzt geprüft");
  expect(apiMock.get).toHaveBeenCalledWith("/ops/status");
  expect(titleMock).toHaveBeenCalledWith("Status", expect.any(String), { robots: "noindex, follow" });
});

test("bei einer Störung steht „Störung, wir sind dran“ - ohne Einzelheiten", async () => {
  apiMock.get.mockResolvedValue({ data: { state: "disturbance", checked_at: "2026-11-24T09:31:00Z", targets: { database: "down" } } });
  render(<StatusPage />);
  expect(await screen.findByText("Störung, wir sind dran")).toBeInTheDocument();
  const page = screen.getByTestId("status-page");
  expect(page).toHaveAttribute("data-state", "disturbance");
  expect(page).not.toHaveTextContent(/Datenbank|API|database/i);
});

test("antwortet der Server gar nicht, ist das auch eine Störung", async () => {
  apiMock.get.mockRejectedValue(new Error("Network Error"));
  render(<StatusPage />);
  expect(await screen.findByText("Störung, wir sind dran")).toBeInTheDocument();
});

test("die Seite fragt jede Minute neu und schaltet von selbst um", async () => {
  vi.useFakeTimers();
  try {
    apiMock.get.mockResolvedValueOnce({ data: { state: "disturbance", checked_at: null } }).mockResolvedValue({ data: { state: "ok", checked_at: null } });
    render(<StatusPage />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Störung, wir sind dran")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve(); });
    expect(screen.getByText("Alles läuft")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
