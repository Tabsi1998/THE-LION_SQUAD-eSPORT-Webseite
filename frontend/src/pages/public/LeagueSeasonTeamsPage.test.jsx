import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Teams der Season (#2268): je Liga und Staffel die Teams mit Logo (sonst Initialen), Platz und Punkten, Link zur Teamseite.
// Lange Namen brechen um. Nur erfundene Namen.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", resolveMediaUrl: (url) => url || "", formatApiError: (d) => String(d || "Fehler") }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
const liveRefresh = vi.fn();
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (...args) => liveRefresh(...args) }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: LeagueSeasonTeamsPage } = await import("./LeagueSeasonTeamsPage");

const LONG = "Donaustädter Wolkenkratzerkletterverein · Zweite Mannschaft der Abendrunde";
const SEASON_VIEW = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { name: "Season 1", slug: "season-1" },
  divisions: [{ id: "d1", level: 1, label: "Liga 1", staffeln: [{ tournament_id: "t1", slug: "probe-a", staffel: "A", status: "live" }] }],
};
const STAFFEL = {
  standings: [{ registration_id: "r1", rank: 1, played: 2, points: 6 }, { registration_id: "r2", rank: 2, played: 0, points: 0 }],
  teams: [{ id: "r1", display_name: "Probe · Probe B", team_id: "team-1", logo_url: "/api/static/uploads/probe.png" },
    { id: "r2", display_name: LONG, team_id: null, logo_url: null }],
  weeks: [],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockImplementation((url) => (url === "/leagues/probe-liga/season-1"
    ? Promise.resolve({ data: SEASON_VIEW }) : Promise.resolve({ data: STAFFEL })));
});

test("Teams je Staffel mit Logo, Platz und Link - ohne Logo die Initialen, vor dem ersten Spiel kein Platz", async () => {
  render(
    <MemoryRouter initialEntries={["/liga/probe-liga/season-1/teams"]}>
      <Routes><Route path="/liga/:league/:season/teams" element={<LeagueSeasonTeamsPage />} /></Routes>
    </MemoryRouter>,
  );
  const block = await screen.findByTestId("season-teams-probe-a");
  expect(block).toHaveAttribute("id", "staffel-probe-a");
  expect(within(block).getByRole("heading", { level: 2 })).toHaveTextContent("Liga 1 · Staffel A");
  const first = await within(block).findByTestId("season-team-r1");
  expect(within(first).getByRole("link")).toHaveAttribute("href", "/teams/team-1");
  expect(first).toHaveTextContent("Platz 1 · 6 Punkte");
  expect(first.querySelector("img")).toHaveAttribute("src", expect.stringContaining("probe.png"));
  const second = within(block).getByTestId("season-team-r2");
  expect(within(second).queryByRole("link")).toBeNull();
  expect(second).toHaveTextContent("noch ohne Spiel");
  expect(second).toHaveTextContent("ZA");
  expect(screen.getByTestId("season-nav-teams")).toHaveAttribute("aria-current", "page");
  // Kein Takt je Staffel (#2268): die Teams-Seite lädt einmal.
  expect(liveRefresh).toHaveBeenCalled();
  expect(liveRefresh.mock.calls.every(([, , options]) => options?.enabled === false)).toBe(true);
});
