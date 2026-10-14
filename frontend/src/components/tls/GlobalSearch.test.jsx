import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/search", expect.objectContaining({ params: { q: "rock", limit: 5 } })));
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

// Verspätete Antworten (#985): nur die Antwort auf den aktuellen Begriff zählt - nach einem Begriffwechsel, Leeren oder
// Schließen verfällt eine alte Antwort; Laden und Fehler gehören nur zur aktiven Suche.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function hit(title) {
  return { data: { items: [{ kind: "team", title, url: `/teams/${title}` }] } };
}

test("Suche A langsam, B schnell: die spätere Antwort für A ändert B nicht", async () => {
  const slowA = deferred();
  apiMock.get.mockImplementation((_url, { params }) => (params.q === "lio" ? slowA.promise : Promise.resolve(hit("Lions Rocket"))));
  renderSearch();
  fireEvent.click(screen.getByTestId("global-search-open"));
  const input = screen.getByTestId("global-search-input");
  fireEvent.change(input, { target: { value: "lio" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/search", expect.objectContaining({ params: { q: "lio", limit: 5 } })));
  fireEvent.change(input, { target: { value: "lions" } });
  expect(await screen.findByText("Lions Rocket")).toBeInTheDocument();
  await act(async () => slowA.resolve(hit("Liona Alt")));
  expect(screen.queryByText("Liona Alt")).toBeNull();
  expect(screen.getByText("Lions Rocket")).toBeInTheDocument();
});

test("ein verspäteter Fehler der alten Suche zeigt keinen Fehler bei der neuen", async () => {
  const slowA = deferred();
  apiMock.get.mockImplementation((_url, { params }) => (params.q === "lio" ? slowA.promise : Promise.resolve(hit("Lions Rocket"))));
  renderSearch();
  fireEvent.click(screen.getByTestId("global-search-open"));
  const input = screen.getByTestId("global-search-input");
  fireEvent.change(input, { target: { value: "lio" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "lions" } });
  expect(await screen.findByText("Lions Rocket")).toBeInTheDocument();
  await act(async () => slowA.reject(new Error("Network Error")));
  expect(screen.queryByText("Suche ist gerade nicht erreichbar.")).toBeNull();
});

test("Leeren und Schließen: eine alte Antwort zeigt danach keine Treffer", async () => {
  const slow = deferred();
  apiMock.get.mockImplementation(() => slow.promise);
  renderSearch();
  fireEvent.click(screen.getByTestId("global-search-open"));
  const input = screen.getByTestId("global-search-input");
  fireEvent.change(input, { target: { value: "lions" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "" } });
  await act(async () => slow.resolve(hit("Lions Rocket")));
  expect(screen.queryByText("Lions Rocket")).toBeNull();
  expect(screen.queryByText("Suche läuft...")).toBeNull();
});

test("ein Fehler der aktiven Suche sagt das, mit „Nochmal versuchen“", async () => {
  apiMock.get.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValueOnce(hit("Lions Rocket"));
  renderSearch();
  fireEvent.click(screen.getByTestId("global-search-open"));
  fireEvent.change(screen.getByTestId("global-search-input"), { target: { value: "lions" } });
  expect(await screen.findByText("Suche ist gerade nicht erreichbar.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Nochmal versuchen/ }));
  expect(await screen.findByText("Lions Rocket")).toBeInTheDocument();
});
