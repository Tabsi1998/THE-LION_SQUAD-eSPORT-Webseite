import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// News-Seite (#1342, #1249): die angepinnte News als breiter Aufmacher, darunter das Raster; darüber eine Zeile
// mit den Kategorien, die es gibt.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (u) => u }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));

const { default: NewsPage } = await import("./NewsPage");

const NEWS = [
  { id: "p", slug: "angepinnt", title: "Angepinnt", category: "club", pinned: true, excerpt: "Wichtig." },
  { id: "p2", slug: "auch-angepinnt", title: "Auch angepinnt", category: "club", pinned: true },
  { id: "a", slug: "neu", title: "Neu", category: "tournaments" },
];

function mockApi(news) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news-meta") return { data: { categories: [], in_use: [{ k: "club", l: "Verein", count: 2 }, { k: "tournaments", l: "Turniere", count: 1 }] } };
    return { data: news };
  });
}

test("die erste angepinnte News ist der Aufmacher, alle anderen stehen im Raster", async () => {
  mockApi(NEWS);
  render(<MemoryRouter><NewsPage /></MemoryRouter>);
  const lead = await screen.findByTestId("news-lead-angepinnt");
  const grid = screen.getByTestId("news-grid");
  expect(grid.contains(lead)).toBe(false);
  expect(grid.querySelector("[data-testid='news-card-auch-angepinnt']")).not.toBeNull();
  expect(grid.querySelector("[data-testid='news-card-neu']")).not.toBeNull();
  expect(grid.className).toContain("lg:grid-cols-3");
  expect(screen.queryByTestId("news-card-angepinnt")).toBeNull();
});

test("ohne angepinnte News kein Aufmacher, nur das Raster", async () => {
  mockApi([NEWS[2]]);
  render(<MemoryRouter><NewsPage /></MemoryRouter>);
  await screen.findByTestId("news-card-neu");
  expect(screen.queryByTestId(/^news-lead-/)).toBeNull();
});

test("Filter: nur Kategorien mit Artikeln in einer Zeile, die Suche als Symbol", async () => {
  mockApi(NEWS);
  render(<MemoryRouter><NewsPage /></MemoryRouter>);
  expect(await screen.findByTestId("news-filter-club")).toHaveTextContent("Verein2");
  expect(screen.queryByTestId("news-filter-sponsors")).toBeNull();
  expect(screen.getByTestId("news-search-open")).toBeInTheDocument();
  expect(screen.queryByTestId("news-search")).toBeNull();
});
