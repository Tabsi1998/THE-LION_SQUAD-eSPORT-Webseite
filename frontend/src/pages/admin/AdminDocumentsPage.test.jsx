import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Dokumente (#1367): die Liste spricht Deutsch - Sichtbarkeit als Plakette (Alle / Mitglieder / Vorstand), Zähler als
// Satz mit richtiger Ein- und Mehrzahl, „nur ansehen“ statt „INLINE“. Kein Rohwert und kein „(en)“/„(s)“.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ API: "/api", api: apiMock, formatApiError: (e, f) => f, formatRequestError: (e, f) => f }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminDocumentsPage } = await import("./AdminDocumentsPage");

const DOCS = [
  { id: "d1", title: "Statuten", category: "statutes", visibility: "public", file_size: 2048, view_count: 1, download_count: 3, allow_download: true },
  { id: "d2", title: "Protokoll GV", category: "minutes", visibility: "members", file_size: 4096, view_count: 0, download_count: 1, allow_download: false },
  { id: "d3", title: "Kassabericht", category: "other", visibility: "internal", file_size: 1024, view_count: 5, download_count: 0, allow_download: false },
];

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/documents/admin" ? DOCS : { categories: [], visibilities: [] } }));
});

async function renderPage() {
  render(<MemoryRouter><AdminDocumentsPage /></MemoryRouter>);
  return screen.findByTestId("doc-row-d1");
}

test("die Seite heißt Dokumente", async () => {
  await renderPage();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Dokumente$/);
});

test("Sichtbarkeit als Plakette: Alle, Mitglieder, Vorstand", async () => {
  await renderPage();
  expect(within(screen.getByTestId("doc-row-d1")).getByTestId("doc-visibility-badge")).toHaveTextContent("Alle");
  expect(within(screen.getByTestId("doc-row-d2")).getByTestId("doc-visibility-badge")).toHaveTextContent("Mitglieder");
  expect(within(screen.getByTestId("doc-row-d3")).getByTestId("doc-visibility-badge")).toHaveTextContent("Vorstand");
});

test("Zähler als Satz (0, 1, viele) und „nur ansehen“ statt INLINE", async () => {
  await renderPage();
  expect(screen.getByTestId("doc-row-d1")).toHaveTextContent("1-mal angesehen · 3-mal heruntergeladen");
  expect(screen.getByTestId("doc-row-d2")).toHaveTextContent("0-mal angesehen · 1-mal heruntergeladen");
  expect(screen.getByTestId("doc-row-d1")).toHaveTextContent("Herunterladen erlaubt");
  expect(screen.getByTestId("doc-row-d2")).toHaveTextContent("nur ansehen");
});

test("kein Rohwert und keine Klammer-Mehrzahl in der Liste - weder in der Tabelle noch in den Karten am Handy", async () => {
  await renderPage();
  const text = document.body.textContent;
  for (const raw of ["public", "members", "internal", "PUBLIC", "MEMBERS", "INTERNAL", "inline", "INLINE", "(en)", "(s)", "VEREINS-CMS"]) {
    expect(text).not.toContain(raw);
  }
  // Am Handy stehen dieselben Dokumente als Karten mit Plakette.
  const card = screen.getByTestId("doc-card-d3");
  expect(within(card).getByTestId("doc-visibility-badge")).toHaveTextContent("Vorstand");
  expect(card).toHaveTextContent("5-mal angesehen · 0-mal heruntergeladen");
});
