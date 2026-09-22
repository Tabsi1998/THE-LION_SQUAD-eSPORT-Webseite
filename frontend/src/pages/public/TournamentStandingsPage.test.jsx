import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Turnierseiten (#225): Nach einem Ergebnis leuchtet die geänderte Zeile und gleitet auf den
// neuen Platz; beim ersten Laden steht ein Skelett in Tabellenform, keine Zeile leuchtet.

const apiMock = { get: vi.fn() };
let refresh = null;
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api" }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback) => { refresh = callback; } }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));

const TournamentStandingsPage = (await import("./TournamentStandingsPage")).default;

const tournament = { id: "t1", slug: "cup", title: "Herbst-Cup", status: "live" };

function rows(order) {
  return order.map((name, index) => ({ registration_id: `r-${name}`, display_name: name, rank: index + 1, won: 3 - index, lost: index, points: (3 - index) * 3 }));
}

function mockApi(standings) {
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: tournament });
    if (path === "/tournaments/t1/standings") return Promise.resolve({ data: standings });
    return Promise.reject(new Error(path));
  });
}

const renderPage = () => render(
  <MemoryRouter initialEntries={["/tournaments/cup/standings"]}>
    <Routes><Route path="/tournaments/:slug/standings" element={<TournamentStandingsPage />} /></Routes>
  </MemoryRouter>,
);

test("Skelett beim Laden, danach nichts hervorgehoben; eine Änderung leuchtet und gleitet", async () => {
  const animate = vi.fn();
  Element.prototype.animate = animate;
  // jsdom kennt keine Lage; jede Zeile bekommt eine nach ihrer Reihenfolge im DOM.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rect() {
    const index = this.parentNode ? [...this.parentNode.children].indexOf(this) : 0;
    return { top: index * 40, left: 0, width: 100, height: 40 };
  });
  mockApi(rows(["Anna", "Ben", "Cem"]));
  renderPage();
  expect(screen.getAllByRole("status", { name: "Lade Rangliste" }).length).toBeGreaterThan(0);
  const anna = await screen.findByTestId("standing-row-r-Anna");
  expect(anna).not.toHaveAttribute("data-changed");

  // Ben überholt Anna.
  const next = rows(["Ben", "Anna", "Cem"]);
  mockApi(next);
  await act(async () => { await refresh(); });
  await waitFor(() => expect(screen.getByTestId("standing-row-r-Ben")).toHaveAttribute("data-changed", "true"));
  expect(screen.getByTestId("standing-row-r-Anna")).toHaveAttribute("data-changed", "true");
  expect(screen.getByTestId("standing-row-r-Cem")).not.toHaveAttribute("data-changed");
  expect(animate).toHaveBeenCalled();
  delete Element.prototype.animate;
});
