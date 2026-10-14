import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mitgliedervorteile und interne News (#984): „Noch keine Vorteile“ und „Keine internen News“ nur nach einer
// erfolgreichen, leeren Antwort. Ein Ladefehler zeigt den Fehler mit „Nochmal versuchen“, ein gescheitertes Nachladen
// lässt den letzten Stand stehen. Erfundene Daten.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <main>{children}</main> }));
const invalidation = { reload: null };
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: (callback) => { invalidation.reload = callback; } }));

const { default: MemberBenefitsPage } = await import("./MemberBenefitsPage");
const { default: MemberNewsPage } = await import("./MemberNewsPage");

const serverError = () => Object.assign(new Error("boom"), { response: { status: 502, data: {} } });
const BENEFIT = { id: "b-1", title: "10 % im Gaming-Shop", category: "Rabatt" };
const NEWS = [
  { id: "n-1", slug: "jahreshauptversammlung", title: "Einladung zur Jahreshauptversammlung", visibility: "members", category: "verein", created_at: "2026-10-01T10:00:00Z" },
  { id: "n-2", slug: "turnier", title: "Öffentliches Turnier", visibility: "public", category: "turnier", created_at: "2026-10-02T10:00:00Z" },
];

function show(Page) {
  return render(<MemoryRouter><Page /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
});

test("Vorteile: ein Fehler ist kein „Noch keine Vorteile“; Nochmal versuchen lädt sie", async () => {
  apiMock.get.mockRejectedValueOnce(serverError()).mockResolvedValueOnce({ data: [BENEFIT] });
  show(MemberBenefitsPage);
  expect(await screen.findByTestId("public-error-state")).toHaveTextContent("Vorteile konnten nicht geladen werden");
  expect(screen.queryByText("Noch keine Vorteile")).toBeNull();
  fireEvent.click(screen.getByTestId("public-error-retry"));
  expect(await screen.findByTestId("benefit-b-1")).toBeInTheDocument();
});

test("Vorteile: erfolgreiche leere Antwort zeigt „Noch keine Vorteile“", async () => {
  apiMock.get.mockResolvedValue({ data: [] });
  show(MemberBenefitsPage);
  expect(await screen.findByText("Noch keine Vorteile")).toBeInTheDocument();
});

test("Vorteile: gescheitertes Nachladen lässt die Liste stehen", async () => {
  apiMock.get.mockResolvedValueOnce({ data: [BENEFIT] }).mockRejectedValueOnce(serverError());
  show(MemberBenefitsPage);
  await screen.findByTestId("benefit-b-1");
  await act(async () => { await invalidation.reload(); });
  expect(screen.getByTestId("benefit-b-1")).toBeInTheDocument();
  expect(screen.getByTestId("load-stale")).toBeInTheDocument();
});

test("Interne News: ein Fehler ist kein „Keine internen News“", async () => {
  apiMock.get.mockRejectedValue(serverError());
  show(MemberNewsPage);
  expect(await screen.findByTestId("public-error-state")).toHaveTextContent("Interne News konnten nicht geladen werden");
  expect(screen.queryByText("Keine internen News")).toBeNull();
});

test("Interne News: nur interne Beiträge, ohne interne Beiträge „Keine internen News“", async () => {
  apiMock.get.mockResolvedValueOnce({ data: NEWS });
  const { unmount } = show(MemberNewsPage);
  expect(await screen.findByTestId("member-news-jahreshauptversammlung")).toBeInTheDocument();
  expect(screen.queryByTestId("member-news-turnier")).toBeNull();
  unmount();
  apiMock.get.mockResolvedValueOnce({ data: [NEWS[1]] });
  show(MemberNewsPage);
  expect(await screen.findByText("Keine internen News")).toBeInTheDocument();
});

test("Interne News: gescheitertes Nachladen lässt die Beiträge stehen", async () => {
  apiMock.get.mockResolvedValueOnce({ data: NEWS }).mockRejectedValueOnce(serverError());
  show(MemberNewsPage);
  await screen.findByTestId("member-news-jahreshauptversammlung");
  await act(async () => { await invalidation.reload(); });
  expect(screen.getByTestId("member-news-jahreshauptversammlung")).toBeInTheDocument();
  expect(screen.getByTestId("load-stale")).toBeInTheDocument();
});
