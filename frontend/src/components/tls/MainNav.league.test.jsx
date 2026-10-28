import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Liga (docs/LIGA.md, P5, #1625): „Liga“ steht unter eSports nur, wenn die Lese-API der Person mindestens eine Season
// zeigt - eingehängt nach „Turniere“, nie doppelt, auch wenn das gespeicherte Menü schon einen Eintrag hat. Kopf- und
// Handymenü fragen /leagues gemeinsam nur einmal.

const NAV = [
  { to: "/", label: "Home", order: 0 },
  { to: "/esports", label: "eSports", order: 2, children: [{ to: "/tournaments", label: "Turniere" }, { to: "/fastlap", label: "Fast Lap" }] },
];
const state = { leagues: [] };
const get = vi.fn(async (url) => (url === "/leagues" ? { data: { leagues: state.leagues } } : { data: { items: NAV } }));
vi.mock("@/lib/api", () => ({ api: { get: (...args) => get(...args) } }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { MainNav, MobileNav, resetLeagueVisibility, withLeagueEntry } = await import("./MainNav");

beforeEach(() => {
  resetLeagueVisibility();
  get.mockClear();
  window.localStorage.clear();
});

test("withLeagueEntry: nach „Turniere“, nie doppelt, ohne Season weg", () => {
  const items = [{ to: "/esports", label: "eSports", children: [{ to: "/tournaments", label: "Turniere" }, { to: "/liga", label: "Liga" }, { to: "/fastlap", label: "Fast Lap" }] }];
  expect(withLeagueEntry(items, true)[0].children.map((child) => child.to)).toEqual(["/tournaments", "/liga", "/fastlap"]);
  expect(withLeagueEntry(items, false)[0].children.map((child) => child.to)).toEqual(["/tournaments", "/fastlap"]);
  expect(withLeagueEntry([{ to: "/news", label: "News" }], true)).toEqual([{ to: "/news", label: "News" }]);
});

async function openEsports() {
  render(<MemoryRouter><MobileNav onClose={() => {}} /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("mobile-nav-esports"));
}

test("mit sichtbarer Season steht „Liga“ unter eSports", async () => {
  state.leagues = [{ id: "l1", slug: "probe-liga", seasons: [{ slug: "season-1" }] }];
  await openEsports();
  await waitFor(() => expect(screen.getByTestId("mobile-nav-sub-liga")).toHaveAttribute("href", "/liga"));
});

test("ohne sichtbare Season kein „Liga“", async () => {
  state.leagues = [];
  await openEsports();
  await waitFor(() => expect(screen.getByTestId("mobile-nav-sub-turniere")).toBeInTheDocument());
  await waitFor(() => expect(get).toHaveBeenCalledWith("/leagues"));
  expect(screen.queryByTestId("mobile-nav-sub-liga")).toBeNull();
});

test("Kopf- und Handymenü laden /leagues nur einmal", async () => {
  state.leagues = [{ id: "l1", slug: "probe-liga", seasons: [] }];
  render(<MemoryRouter><MainNav /><MobileNav onClose={() => {}} /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("mobile-nav-esports"));
  await waitFor(() => expect(screen.getByTestId("mobile-nav-sub-liga")).toBeInTheDocument());
  expect(get.mock.calls.filter(([url]) => url === "/leagues")).toHaveLength(1);
});
