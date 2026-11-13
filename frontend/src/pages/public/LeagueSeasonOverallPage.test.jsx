import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Gesamtwertung über Seasons (F.5, #2215) auf der Ligaseite: Liga N als Auswahl, Co-Teams und Spieler, Punkte je Season mit
// Streichergebnis und Staffelsieg, Aufsteiger, Aufklappen am Handy, privates Profil ohne Link. Nur erfundene Namen.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", resolveMediaUrl: (url) => url || "", formatApiError: (d) => String(d || "Fehler") }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: LeagueSeasonOverallPage } = await import("./LeagueSeasonOverallPage");

const SEASON_VIEW = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { name: "Season 2", slug: "season-2" }, divisions: [], overall: { period_id: "p1", name: "2027" },
};
const cell = (season_id, points, extra = {}) => ({ season_id, played: true, points, place: 1, of: 4, counted: true, champion: false, ...extra });
const OVERALL = {
  period: { id: "p1", name: "2027" }, league: { name: "Probe-Liga", slug: "probe-liga" },
  seasons: [{ id: "s1", name: "Season 1" }, { id: "s2", name: "Season 2" }],
  settings: { points_mode: "teams", champion_bonus: 2, counting: "best", best_count: 1, tiebreakers: [{ key: "wins", label: "Mehr Staffelsiege" }] },
  levels: [
    { level: 1, label: "Liga 1", closed: true, final: { version: 1, closed_at: "2027-01-12T19:30:00+00:00" }, season_ids: ["s1", "s2"], rewards: [],
      teams: [
        { key: "squad:a", name: "Nordlicht", team_id: "team-1", place: 1, total: 6, tie: false, climbed: true, wins: 1, lead_decision: null,
          seasons: [cell("s1", 3, { place: 2, counted: false }), cell("s2", 6, { champion: true })] },
        { key: "squad:b", name: "Sturmfalken", team_id: null, place: 2, total: 6, tie: false, climbed: false, wins: 1, lead_decision: null,
          seasons: [cell("s1", 6, { champion: true }), { season_id: "s2", played: false }] },
      ],
      players: [
        { key: "u1", name: "NeonFalke", username: "neonfalke", private: false, place: 1, total: 6, tie: false, seasons: [cell("s1", 3), cell("s2", 6)] },
        { key: null, name: "Spieler mit privatem Profil", username: null, private: true, place: 2, total: 3, tie: false, seasons: [cell("s1", 3), { season_id: "s2", played: false }] },
      ] },
    { level: 2, label: "Liga 2", closed: false, final: null, season_ids: ["s1"], rewards: [], players: [],
      teams: [{ key: "squad:c", name: "Eisbären", team_id: "team-3", place: 1, total: 4, tie: false, climbed: false, seasons: [cell("s1", 4)] }] },
  ],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/overall") ? OVERALL : SEASON_VIEW }));
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/liga/probe-liga/season-2/gesamtwertung"]}>
      <Routes><Route path="/liga/:league/:season/gesamtwertung" element={<LeagueSeasonOverallPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("Co-Teams mit Punkten je Season, Streichergebnis, Gesamtsieger und Aufsteiger", async () => {
  renderPage();
  const table = await screen.findByTestId("overall-1-teams-table");
  expect(screen.getByTestId("season-nav-gesamtwertung")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("overall-1-winner")).toHaveTextContent("Gesamtsieger Nordlicht");
  expect(screen.getByTestId("overall-1-state")).toHaveTextContent("Endstand seit 12.01.2027");
  const first = within(table).getByTestId("overall-1-teams-table-row-0");
  expect(first).toHaveAttribute("data-climbed", "true");
  expect(within(first).getByRole("link", { name: "Nordlicht" })).toHaveAttribute("href", "/teams/team-1");
  const dropped = first.querySelector('[data-counted="false"]');
  expect(dropped).toHaveTextContent("Season 1: 3 Punkte · Platz 2 von 4 · Streichergebnis");
  // Gegenprobe: ohne Teamseite kein Link, nicht gespielt ist ein Strich.
  const second = within(table).getByTestId("overall-1-teams-table-row-1");
  expect(within(second).queryByRole("link")).toBeNull();
  expect(second.querySelector('[data-played="false"]')).toHaveTextContent("Season 2: nicht dabei");
  expect(screen.getByTestId("overall-1-rules")).toHaveTextContent("Es zählen die besten 1 Seasons.");
  expect(screen.getByTestId("overall-1-pdf")).toHaveAttribute("href", "/api/leagues/probe-liga/season-2/overall.pdf?level=1");
});

test("Spieler, privates Profil ohne Link, Aufklappen und andere Liga N", async () => {
  renderPage();
  fireEvent.click(await screen.findByTestId("overall-1-players"));
  const table = screen.getByTestId("overall-1-players-table");
  expect(within(table).getByRole("link", { name: "NeonFalke" })).toHaveAttribute("href", "/u/neonfalke");
  const hidden = within(table).getByTestId("overall-1-players-table-row-1");
  expect(hidden).toHaveTextContent("Spieler mit privatem Profil");
  expect(within(hidden).queryByRole("link")).toBeNull();
  const more = within(table).getByTestId("overall-1-players-table-more-0");
  expect(more).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(more);
  expect(more).toHaveAttribute("aria-expanded", "true");
  expect(table).toHaveTextContent("Season 2 · Platz 1 von 4");
  fireEvent.click(screen.getByTestId("overall-level-2"));
  expect(await screen.findByTestId("overall-2")).toHaveTextContent("Eisbären");
  expect(screen.getByTestId("overall-2-state")).toHaveTextContent("Laufende Wertung");
  expect(screen.queryByTestId("overall-2-winner")).toBeNull();
});

test("Ohne Gesamtwertung ein Hinweis statt einer Tabelle", async () => {
  apiMock.get.mockImplementation((url) => (url.endsWith("/overall") ? Promise.reject({ response: { status: 404 } }) : Promise.resolve({ data: SEASON_VIEW })));
  renderPage();
  expect(await screen.findByTestId("overall-missing")).toHaveTextContent("keine Gesamtwertung");
});
