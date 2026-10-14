import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Meine Strafen (#984): „Saubere Weste“ nur nach einer erfolgreichen, leeren Antwort. Ein Ladefehler zeigt den Fehler mit
// „Nochmal versuchen“, ein gescheitertes Nachladen lässt die Liste stehen. Erfundene Daten.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <main>{children}</main> }));
vi.mock("@/components/tls/ModerationStandingCard", () => ({ ModerationStandingCard: () => null }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
const invalidation = { reload: null };
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: (callback) => { invalidation.reload = callback; } }));

const { default: MyPenaltiesPage } = await import("./MyPenaltiesPage");

const PENALTY = { ref_id: "pen-1", kind: "lap_penalty", label: "+5 Sekunden", reason: "Abkürzung in Kurve 3", issued_by_name: "Rennleitung", context_title: "Fast Lap Herbst" };
const serverError = () => Object.assign(new Error("boom"), { response: { status: 500, data: {} } });

function renderPage() {
  return render(<MemoryRouter><MyPenaltiesPage /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
});

test("ein Serverfehler zeigt den Fehler mit „Nochmal versuchen“ statt „Saubere Weste“", async () => {
  apiMock.get.mockRejectedValueOnce(serverError()).mockResolvedValueOnce({ data: { count: 1, items: [PENALTY] } });
  renderPage();
  expect(await screen.findByTestId("public-error-state")).toHaveTextContent("Strafen konnten nicht geladen werden");
  expect(screen.queryByText("Saubere Weste")).toBeNull();
  fireEvent.click(screen.getByTestId("public-error-retry"));
  expect(await screen.findByTestId("penalty-card-pen-1")).toBeInTheDocument();
});

test("ohne Netz: Fehler „Ohne Netz“, keine Entwarnung", async () => {
  apiMock.get.mockRejectedValue(new Error("Network Error"));
  renderPage();
  expect(await screen.findByTestId("public-error-state")).toHaveAttribute("data-kind", "offline");
  expect(screen.queryByText("Saubere Weste")).toBeNull();
});

test("eine erfolgreiche leere Antwort ist „Saubere Weste“", async () => {
  apiMock.get.mockResolvedValue({ data: { count: 0, items: [] } });
  renderPage();
  expect(await screen.findByText("Saubere Weste")).toBeInTheDocument();
  expect(screen.queryByTestId("public-error-state")).toBeNull();
});

test("ein gescheitertes Nachladen lässt die Strafen stehen und sagt es", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { count: 1, items: [PENALTY] } }).mockRejectedValueOnce(serverError());
  renderPage();
  await screen.findByTestId("penalty-card-pen-1");
  await act(async () => { await invalidation.reload(); });
  expect(screen.getByTestId("penalty-card-pen-1")).toBeInTheDocument();
  expect(screen.getByTestId("load-stale")).toHaveTextContent("letzten Stand");
});
