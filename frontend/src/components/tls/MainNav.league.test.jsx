import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Liga (docs/LIGA.md, P5, #1625): „Liga“ steht unter eSports nur, wenn die Lese-API der Person mindestens eine Season
// zeigt. Seit #2122 NW7 kommt der Eintrag aus dem Menü-Editor (Name, Stelle, Ausblenden). Kopf- und Handymenü fragen
// /leagues gemeinsam nur einmal.

const NAV = [
  { key: "home", to: "/", label: "Start", order: 0 },
  { key: "esports", to: "/esports", label: "eSports", order: 2, children: [
    { key: "tournaments", to: "/tournaments", label: "Turniere" }, { key: "league", to: "/liga", label: "Liga" }, { key: "fastlap", to: "/fastlap", label: "Fast Lap" },
  ] },
];
const state = { leagues: [], nav: NAV };
const get = vi.fn(async (url) => (url === "/leagues" ? { data: { leagues: state.leagues } } : { data: { items: state.nav } }));
vi.mock("@/lib/api", () => ({ api: { get: (...args) => get(...args) } }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { MainNav, MobileNav, navItemIs, resetLeagueVisibility, withLeagueEntry } = await import("./MainNav");

beforeEach(() => {
  resetLeagueVisibility();
  state.nav = NAV;
  get.mockClear();
  window.localStorage.clear();
});

test("withLeagueEntry: mit Season bleibt der Eintrag aus dem Editor, ohne Season fällt er weg, nie kommt einer dazu", () => {
  const items = [{ to: "/esports", label: "eSports", children: [{ to: "/tournaments", label: "Turniere" }, { key: "league", to: "/liga", label: "Rudel-Liga" }, { to: "/fastlap", label: "Fast Lap" }] }];
  expect(withLeagueEntry(items, true)[0].children.map((child) => child.label)).toEqual(["Turniere", "Rudel-Liga", "Fast Lap"]);
  expect(withLeagueEntry(items, false)[0].children.map((child) => child.to)).toEqual(["/tournaments", "/fastlap"]);
  const hidden = [{ to: "/esports", label: "eSports", children: [{ to: "/tournaments", label: "Turniere" }] }];
  expect(withLeagueEntry(hidden, true)[0].children.map((child) => child.to)).toEqual(["/tournaments"]);
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

test("im Editor ausgeblendet: kein „Liga“, auch mit Season", async () => {
  state.leagues = [{ id: "l1", slug: "probe-liga", seasons: [{ slug: "season-1" }] }];
  state.nav = [NAV[0], { ...NAV[1], children: NAV[1].children.filter((child) => child.key !== "league") }];
  await openEsports();
  await waitFor(() => expect(get).toHaveBeenCalledWith("/leagues"));
  await waitFor(() => expect(screen.getByTestId("mobile-nav-sub-turniere")).toBeInTheDocument());
  expect(screen.queryByTestId("mobile-nav-sub-liga")).toBeNull();
});

test("Kopf- und Handymenü laden /leagues nur einmal", async () => {
  state.leagues = [{ id: "l1", slug: "probe-liga", seasons: [] }];
  render(<MemoryRouter><MainNav /><MobileNav onClose={() => {}} /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("mobile-nav-esports"));
  await waitFor(() => expect(screen.getByTestId("mobile-nav-sub-liga")).toBeInTheDocument());
  expect(get.mock.calls.filter(([url]) => url === "/leagues")).toHaveLength(1);
});

// Ungelesen-Zeichen (#2122 NW7): hängt am Schlüssel „community“, nicht am Namen - Umbenennen bricht es nicht.
test("umbenannte Community behält das Ungelesen-Zeichen", async () => {
  state.nav = [NAV[0], { key: "community", label: "Treffpunkt", order: 3, children: [{ to: "/community", label: "Übersicht" }] }];
  render(<MemoryRouter><MainNav badges={{ community: 3 }} /></MemoryRouter>);
  expect(await screen.findByTestId("nav-treffpunkt-count")).toHaveTextContent("3");
});

test("navItemIs: Schlüssel vor Name, ohne Schlüssel der Name aus der Vorgabe", () => {
  expect(navItemIs({ key: "community", label: "Treffpunkt" }, "community")).toBe(true);
  expect(navItemIs({ key: "club", label: "Community" }, "community")).toBe(false);
  expect(navItemIs({ label: "Community" }, "community")).toBe(true);
});
