import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { addRecentSearch, clearRecentSearches, loadRecentSearches } from "@/lib/recentSearches";

// Die Suche im Kopf (#1145): wie in der App ab zwei Buchstaben und nach Art gruppiert - neu sind die letzten fünf Suchen,
// im Browser gemerkt, einzeln oder alle löschbar; Abmelden löscht sie (AuthContext.logout).

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));

const { GlobalSearch } = await import("./GlobalSearch");

function renderSearch() {
  return render(
    <MemoryRouter>
      <GlobalSearch />
    </MemoryRouter>
  );
}

beforeEach(() => {
  clearRecentSearches();
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: { items: [
    { kind: "tournament", title: "Rocket League 2v2", url: "/tournaments/rl-2v2" },
    { kind: "team", title: "Lions Rocket", url: "/teams/t-rocket" },
  ] } });
});

test("ein Treffer merkt sich die Suche; beim nächsten Öffnen steht sie oben", async () => {
  const view = renderSearch();
  fireEvent.click(screen.getByTestId("global-search-open"));
  fireEvent.change(screen.getByTestId("global-search-input"), { target: { value: "rock" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/search", { params: { q: "rock", limit: 5 } }));
  fireEvent.click(await screen.findByText("Lions Rocket"));
  expect(loadRecentSearches()).toEqual(["rock"]);
  view.unmount();

  renderSearch();
  fireEvent.click(screen.getByTestId("global-search-open"));
  expect(screen.getByTestId("global-search-recent")).toHaveTextContent("rock");
  fireEvent.click(screen.getByTestId("global-search-recent-rock"));
  expect(screen.getByTestId("global-search-input")).toHaveValue("rock");
});

test("letzte Suchen lassen sich einzeln und alle löschen", () => {
  window.localStorage.setItem("tls-recent-searches", JSON.stringify(["rock", "fc 26"]));
  renderSearch();
  fireEvent.click(screen.getByTestId("global-search-open"));
  fireEvent.click(screen.getByTestId("global-search-recent-remove-rock"));
  expect(screen.queryByTestId("global-search-recent-rock")).toBeNull();
  expect(loadRecentSearches()).toEqual(["fc 26"]);
  fireEvent.click(screen.getByTestId("global-search-recent-clear"));
  expect(screen.queryByTestId("global-search-recent")).toBeNull();
  expect(loadRecentSearches()).toEqual([]);
});

test("höchstens fünf, die neueste oben, doppelte fallen weg", () => {
  let list = [];
  for (const query of ["a1", "b2", "c3", "d4", "e5", "f6", "B2", " x "]) list = addRecentSearch(list, query);
  expect(list).toEqual(["B2", "f6", "e5", "d4", "c3"]);
});
