import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Turnierseiten (#225): Nach einem Ergebnis leuchtet die geänderte Zeile und gleitet auf den
// neuen Platz; beim ersten Laden steht ein Skelett in Tabellenform, keine Zeile leuchtet.

const apiMock = { get: vi.fn() };
let refresh = null;
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api" }));
let liveOptions = null;
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback, resources, options) => { refresh = callback; liveOptions = options; } }));
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
  window.Element.prototype.animate = animate;
  // jsdom kennt keine Lage; jede Zeile bekommt eine nach ihrer Reihenfolge im DOM.
  vi.spyOn(window.Element.prototype, "getBoundingClientRect").mockImplementation(function rect() {
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
  delete window.Element.prototype.animate;
});

// Gruppen, Liga-Spalten, Pfeile und eigene Zeile (#1562, #1179) - mit den Daten aus dem echten Generator.
const generated = (await import("../../../e2e/fixtures/tableScheduleGenerated.json")).default;

function mockGenerated(set) {
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...set.tournament, slug: "cup" } });
    if (path === `/tournaments/${set.tournament.id}/standings`) return Promise.resolve({ data: set.standings });
    return Promise.reject(new Error(path));
  });
}

test("Gruppen: je Gruppe eine Tabelle mit Überschrift, die eigene Gruppe und Zeile sind markiert", async () => {
  mockGenerated(generated.groups);
  renderPage();
  expect(await screen.findByRole("heading", { name: /Gruppe A/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Gruppe B/ })).toBeInTheDocument();
  expect(screen.getAllByRole("table")).toHaveLength(2);
  const mine = generated.groups.standings.flatMap((entry) => entry.standings).find((row) => row.is_mine);
  const row = screen.getByTestId(`standing-row-${mine.registration_id}`);
  expect(row).toHaveAttribute("data-mine", "true");
  expect(row).toHaveTextContent("Du");
  expect(screen.getAllByText("Deine Gruppe")).toHaveLength(1);
});

test("Liga: Spiele, Differenz, Form und Pfeile seit dem vorigen Spieltag", async () => {
  mockGenerated(generated.league);
  renderPage();
  await screen.findByRole("table");
  for (const header of ["Sp", "Diff", "Form", "Pkt"]) expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
  for (const row of generated.league.standings) {
    const tr = screen.getByTestId(`standing-row-${row.registration_id}`);
    const before = generated.league.standings_after_first.find((old) => old.registration_id === row.registration_id).rank;
    const move = screen.queryByTestId(`standing-move-${row.registration_id}`);
    if (before > row.rank) expect(move).toHaveAccessibleName(`${before - row.rank} ${before - row.rank === 1 ? "Platz" : "Plätze"} hinauf`);
    else if (before < row.rank) expect(move).toHaveAccessibleName(`${row.rank - before} ${row.rank - before === 1 ? "Platz" : "Plätze"} hinunter`);
    else expect(move).toBeNull();
    expect(tr.querySelector("[data-form]")).toHaveAttribute("aria-label", expect.stringMatching(/^Form: /));
    if (row.is_mine) expect(tr).toHaveAttribute("data-mine", "true");
    else expect(tr).not.toHaveAttribute("data-mine");
  }
  expect(screen.getAllByText("Du")).toHaveLength(1);
});

// #1801: Die Rangliste lädt nur bei Änderungen ihres Turniers nach - bis es geladen ist, bei jeder.
test("hört nach dem Laden nur noch auf das eigene Turnier", async () => {
  mockApi(rows(["Anna"]));
  renderPage();
  expect(liveOptions.tournamentId).toBeFalsy();
  await screen.findByTestId("standing-row-r-Anna");
  await waitFor(() => expect(liveOptions.tournamentId).toBe("t1"));
});
