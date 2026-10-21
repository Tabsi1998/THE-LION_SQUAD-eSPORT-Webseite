import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Maps auf der Seite der Team-Liga (#1616 an #1931): das Veto eines Spiels als Karten mit Bild (Bann, Wahl, Decider,
// die gewonnene Map markiert) und die Statistik je Map - nur Kennzahlen, die vorkommen. Ohne Bilder bleibt die Liste wie
// bisher. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceSeriesPage } = await import("./ReferenceSeriesPage");

const ROUND = { id: "r1", position: 1, code: "ST1", club_day: "2026-11-02", time: "20:00", state: "scored", kind: "regular", counts: true, opponent: "Probe Falken" };
const img = (name) => `/api/static/uploads/${name}.webp`;
const MATCH = {
  opponent: "Probe Falken", home: true, score_for: 2, score_against: 1, outcome: "win", points: 3, lineup_size: 4, team: "Probe Löwen",
  maps: [], bans: [{ name: "Nebelwerk", by: "own", map_id: "nebel" }],
  veto: [
    { name: "Nebelwerk", role: "banned", by: "own", played: false, map_id: "nebel", image_url: img("nebelwerk") },
    { name: "Sturmdeck", role: "banned", by: "opponent", played: false, map_id: "sturm", image_url: img("sturmdeck") },
    { name: "Hafenkante", role: "picked", by: "own", played: true, picked: "own", map_id: "hafen", image_url: img("hafenkante"), score_for: 6, score_against: 3, outcome: "win" },
    { name: "Karte Frei", role: "picked", by: "opponent", played: true, picked: "opponent", score_for: 4, score_against: 6, outcome: "loss" },
    { name: "Glutsenke", role: "decider", played: false, picked: "decider", map_id: "glut", image_url: img("glutsenke") },
  ],
};

function body(match = MATCH, stats = null) {
  return {
    lineage: { title: "Probe Liga", slug: "probe-liga", kind: "team_league", label: "4vs4", game_name: "Probe Shooter" },
    series: { season: "2026", tier: null, title: null, season_slug: "2026", status: "active" },
    rules: {}, today: "2026-11-20", progress: { total: 1, scored: 1, cancelled: 0, remaining: 0, next: null }, rounds: [ROUND],
    standings: null, final: null, map_pool: null,
    team_league: {
      team_name: "Probe Löwen", own_teams: ["Probe Löwen"], rules: { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: [] },
      table: null, rank_history: [], record: [], lineup: { round_ids: [], players: [] }, path: [],
      matchdays: [{ round: ROUND, match, matches: [match], others: [] }],
      map_stats: stats || [
        { name: "Hafenkante", image_url: img("hafenkante"), map_id: "hafen", played: 3, won: 2, drawn: 0, lost: 1, picked_own: 2, picked_opponent: 0, picked: 0, decider: 0, banned_own: 0, banned_opponent: 1, banned: 0 },
        { name: "Karte Frei", image_url: null, map_id: null, played: 1, won: 0, drawn: 0, lost: 1, picked_own: 0, picked_opponent: 1, picked: 0, decider: 0, banned_own: 0, banned_opponent: 0, banned: 0 },
      ],
    },
  };
}

function renderPage(data = body()) {
  apiMock.get.mockResolvedValue({ data });
  return render(
    <MemoryRouter initialEntries={["/references/series/probe-liga/2026"]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<ReferenceSeriesPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => apiMock.get.mockReset());

test("das Veto steht als Karten mit Bild: Bann, Wahl, Decider – die gewonnene Map markiert", async () => {
  renderPage();
  const veto = await screen.findByTestId("team-league-veto");
  const cards = within(veto).getAllByTestId("team-league-veto-card");
  expect(cards.map((card) => card.dataset.role)).toEqual(["banned", "banned", "picked", "picked", "decider"]);
  expect(cards.map((card) => within(card).getByTestId("team-league-veto-label").textContent)).toEqual([
    "Bann · wir", "Bann · Gegner", "Unsere Wahl", "Wahl Gegner", "Decider"]);
  expect(cards[2]).toHaveAttribute("data-outcome", "win");
  expect(within(cards[2]).getByText("6:3")).toBeInTheDocument();
  expect(within(cards[2]).getByText("gewonnen")).toBeInTheDocument();
  expect(cards[4]).toHaveAttribute("data-played", "false");
  expect(within(cards[4]).getByText("nicht gespielt")).toBeInTheDocument();
  expect(cards[0].querySelector("img")).toHaveAttribute("src", img("nebelwerk"));
  // Freitext ohne Bild: ruhiger Platzhalter statt Bild.
  expect(cards[3].querySelector("img")).toBeNull();
  // Die Karten ersetzen Liste und Bann-Zeile.
  expect(screen.queryByTestId("team-league-maps")).not.toBeInTheDocument();
  expect(screen.queryByTestId("team-league-bans")).not.toBeInTheDocument();
});

test("ohne Bilder bleibt die Liste der Maps wie bisher", async () => {
  const plain = { ...MATCH, veto: MATCH.veto.map(({ image_url: _image, map_id: _id, ...step }) => step) };
  renderPage(body(plain));
  expect(await screen.findByTestId("team-league-maps")).toBeInTheDocument();
  expect(screen.queryByTestId("team-league-veto")).not.toBeInTheDocument();
});

test("Statistik je Map: nur Kennzahlen, die vorkommen", async () => {
  renderPage();
  const section = await screen.findByTestId("team-league-map-stats");
  expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Maps");
  const cards = within(section).getAllByTestId("team-league-map-stat");
  expect(cards.map((card) => within(card).getByTestId("map-card").textContent)).toEqual(["Hafenkante", "Karte Frei"]);
  expect(within(cards[0]).getByTestId("team-league-map-figures").textContent).toBe("Gespielt3Siege2Niederlagen1Unsere Wahl2Bann Gegner1");
  expect(within(cards[1]).queryByText("Siege")).not.toBeInTheDocument();
});

test("ohne Maps keine Statistik", async () => {
  renderPage(body(MATCH, []));
  await screen.findByTestId("team-league");
  expect(screen.queryByTestId("team-league-map-stats")).not.toBeInTheDocument();
});
