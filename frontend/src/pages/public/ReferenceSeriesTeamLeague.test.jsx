import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Serienseite einer Team-Liga (#1747): Spieltage mit nächstem Gegner, Tabelle über die Rangliste der Turniere (eigenes
// Team als „Verein“ markiert, Punkte und Vorrang aus den Regeln), Platzierungsverlauf, Spielplan mit Ergebnis und Maps
// aus eigener Sicht, Aufstellung (nur Vereinsmitglieder verlinkt, Gäste getrennt) und Liga-Weg. Erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceSeriesPage } = await import("./ReferenceSeriesPage");
const { useDocumentTitle } = await import("@/hooks/useDocumentTitle");

const ROUNDS = [
  { id: "r1", position: 1, code: "ST1", club_day: "2026-11-02", time: "20:00", state: "scored", kind: "regular", counts: true, opponent: "Fremd Füchse" },
  { id: "r2", position: 2, code: "ST2", club_day: "2026-11-09", time: "20:00", state: "scored", kind: "regular", counts: true, opponent: "Fremd Bären" },
  { id: "r3", position: 3, code: "ST3", club_day: "2026-11-30", time: "20:00", state: "planned", kind: "regular", counts: true, opponent: "Fremd Adler" },
];

const BODY = {
  lineage: { title: "Probe Liga", slug: "probe-liga", kind: "team_league", label: "4vs4", organizer: "Probe Verband", game_name: "Probespiel" },
  series: { season: "2026", tier: "Division 1", title: null, season_slug: "2026-division-1", status: "active" },
  rules: {},
  today: "2026-11-20",
  progress: { total: 3, scored: 2, cancelled: 0, remaining: 1, next: ROUNDS[2] },
  rounds: ROUNDS,
  standings: null,
  final: null,
  team_league: {
    team_name: "Probe Löwen",
    rules: { match_points: { win: 2, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "wins"] },
    table: {
      round_id: "r2",
      rows: [
        { key: "Fremd Bären", team: "Fremd Bären", rank: 1, previous_rank: null, played: 1, won: 1, drawn: 0, lost: 0, score_for: 3, score_against: 1, score_diff: 2, points: 2, own: false, form: [] },
        { key: "Probe Löwen", team: "Probe Löwen", rank: 2, previous_rank: 1, played: 2, won: 1, drawn: 0, lost: 1, score_for: 4, score_against: 4, score_diff: 0, points: 2, own: true, form: ["W", "L"] },
      ],
    },
    rank_history: [{ round_id: "r1", rank: 1, teams: 2 }, { round_id: "r2", rank: 2, teams: 3 }],
    matchdays: [
      { round: ROUNDS[0], match: { opponent: "Fremd Füchse", home: true, score_for: 3, score_against: 1, outcome: "win", points: 2, maps: [{ name: "Karte Nord", score_for: 6, score_against: 2, outcome: "win" }], lineup_size: 2 } },
      { round: ROUNDS[1], match: { opponent: "Fremd Bären", home: false, score_for: 1, score_against: 3, outcome: "loss", points: 0, maps: [], lineup_size: 2 } },
      { round: ROUNDS[2], match: null },
    ],
    lineup: {
      round_ids: ["r1", "r2"],
      players: [
        { key: "p-a", name: "Probe Alpha", name_hidden: false, club_member: true, guest: false, profile_slug: "probe-alpha", round_ids: ["r1", "r2"], appearances: 2, all_seasons: 5 },
        { key: "p-d", name: "Gast Delta", name_hidden: false, club_member: false, guest: true, profile_slug: null, round_ids: ["r1"], appearances: 1, all_seasons: null },
        { key: "p-g", name: null, name_hidden: true, club_member: false, guest: true, profile_slug: null, round_ids: ["r2"], appearances: 1, all_seasons: null },
      ],
    },
    path: [
      { season: "2025", tier: "Division 2", season_slug: "2025-division-2", status: "completed", current: false, rank: 1, teams: 6, points: 14 },
      { season: "2026", tier: "Division 1", season_slug: "2026-division-1", status: "active", current: true, rank: 2, teams: 3, points: 2 },
    ],
  },
};

function renderPage(body = BODY) {
  apiMock.get.mockResolvedValue({ data: body });
  return render(
    <MemoryRouter initialEntries={["/references/series/probe-liga/2026-division-1"]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<ReferenceSeriesPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { apiMock.get.mockReset(); });

test("Spieltage, nächster Gegner und Tabelle mit Regeln aus der Serie", async () => {
  renderPage();
  expect(await screen.findByTestId("team-league")).toBeInTheDocument();
  expect(screen.queryByText("Gesamtwertung")).not.toBeInTheDocument();
  expect(screen.getByTestId("team-league-progress")).toHaveTextContent("2 von 3 gespielt");
  expect(screen.getByTestId("team-league-next")).toHaveTextContent("Nächster Spieltag: ST3 · Mo., 30.11.2026 · 20:00 · gegen Fremd Adler");
  const rules = screen.getByTestId("team-league-rules");
  expect(rules).toHaveTextContent("Sieg 2 · Unentschieden 1 · Niederlage 0");
  expect(rules).toHaveTextContent("bessere Map-Differenz, dann mehr Siege");
  const table = within(screen.getByTestId("team-league-table")).getByRole("table", { name: "Tabelle" });
  const own = within(table).getByTestId("standing-row-Probe Löwen");
  expect(own.dataset.mine).toBe("true");
  expect(own).toHaveTextContent("Verein");
  expect(own).toHaveTextContent("4:4");
  expect(within(own).getByRole("img", { name: "1 Platz hinunter" })).toBeInTheDocument();
  expect(within(own).getByRole("img", { name: "Form: Sieg, Niederlage" })).toBeInTheDocument();
  expect(screen.getByTestId("team-league-trend")).toHaveTextContent("ST2: Platz 2 von 3");
  expect(useDocumentTitle).toHaveBeenLastCalledWith("Probe Liga 2026 · Division 1", undefined, { robots: "noindex, follow" });
});

test("Spielplan aus eigener Sicht mit Maps, offene Spieltage mit Status", async () => {
  renderPage();
  const days = await screen.findAllByTestId("team-league-matchday");
  expect(days.map((day) => day.dataset.outcome || day.dataset.state)).toEqual(["win", "loss", "planned"]);
  expect(days[0]).toHaveTextContent("gegen Fremd Füchse");
  expect(days[0]).toHaveTextContent("Heim");
  expect(within(days[0]).getByRole("img", { name: "Sieg 3:1, 2 Punkte" })).toBeInTheDocument();
  expect(within(days[0]).getByTestId("team-league-maps")).toHaveTextContent("Karte Nord6:2");
  expect(days[1]).toHaveTextContent("Auswärts");
  expect(within(days[1]).getByRole("img", { name: "Niederlage 1:3, 0 Punkte" })).toBeInTheDocument();
  expect(days[2]).toHaveTextContent("Geplant");
});

test("Aufstellung: nur Vereinsmitglieder verlinkt, Gäste getrennt, ausgeblendete Namen ohne Namen", async () => {
  renderPage();
  const lineup = await screen.findByTestId("team-league-lineup");
  expect(within(lineup).getByRole("link", { name: "Probe Alpha" })).toHaveAttribute("href", "/members/probe-alpha");
  expect(within(lineup).queryByRole("link", { name: "Gast Delta" })).not.toBeInTheDocument();
  const guests = within(lineup).getByTestId("team-league-guests");
  expect(guests).toHaveTextContent("Gast Delta");
  expect(guests).toHaveTextContent("Name ausgeblendet");
  const players = within(lineup).getAllByTestId("team-league-player");
  expect(players[0]).toHaveTextContent("Probe Alpha");
  expect(within(players[0]).getByTestId("team-league-appearances")).toHaveTextContent("2");
  expect(players[0].lastElementChild).toHaveTextContent("5");
  expect(players[1].dataset.guest).toBe("true");
});

// #1931: Bilanz, Spieltage als Karten mit Wahl, Bann und den übrigen Spielen, Kader mit „von“ und Ersatz.
const SEASON_1931 = {
  ...BODY.team_league,
  own_teams: ["Probe Löwen"],
  record: [{ team: "Probe Löwen", played: 2, won: 1, drawn: 0, lost: 1, points: 2, maps_for: 4, maps_against: 4, rounds_for: 38, rounds_against: 31, rounds_matches: 2 }],
  matchdays: [
    { round: { ...ROUNDS[0], club_day_end: "2026-11-06", at_home: true }, others: [{ home: "Fremd Adler", away: "Fremd Eulen", home_score: 0, away_score: 2 }], match: {
      opponent: "Fremd Füchse", home: true, score_for: 3, score_against: 1, outcome: "win", points: 2, team: "Probe Löwen", club_day: null, time: "21:15",
      maps: [{ name: "Karte Nord", score_for: 6, score_against: 2, outcome: "win", picked: "own" }, { name: "Karte Süd", score_for: 4, score_against: 6, outcome: "loss", picked: "decider" }],
      bans: [{ name: "Karte Ost", by: "own" }, { name: "Karte Hafen", by: "opponent" }], lineup_size: 2 } },
    { round: ROUNDS[1], others: [], match: { ...BODY.team_league.matchdays[1].match, bans: [], club_day: null, time: null } },
    { round: { ...ROUNDS[2], at_home: false }, others: [], match: null },
  ],
  lineup: {
    round_ids: ["r1", "r2"],
    players: [
      { key: "p-a", name: "Probe Alpha", name_hidden: false, club_member: true, guest: false, profile_slug: "probe-alpha", round_ids: ["r1"], bench_round_ids: ["r2"], appearances: 1, of: 2, in_roster: true, team: "Probe Löwen", all_seasons: 5 },
      { key: "p-b", name: "Probe Beta", name_hidden: false, club_member: true, guest: false, profile_slug: null, round_ids: [], bench_round_ids: ["r1", "r2"], appearances: 0, of: 2, in_roster: true, team: "Probe Löwen", all_seasons: null },
    ],
  },
};

test("Bilanz (#1931): S-U-N, Maps und Runden mit Differenz", async () => {
  renderPage({ ...BODY, team_league: SEASON_1931 });
  const record = await screen.findByTestId("team-league-record");
  expect(record).toHaveTextContent("1–0–1");
  expect(record).toHaveTextContent("Maps4:4 ±0");
  expect(record).toHaveTextContent("Runden38:31 +7");
});

test("Spieltage als Karten (#1931): Uhrzeit des Spiels, Wahl je Map, Banns und die übrigen Spiele", async () => {
  renderPage({ ...BODY, team_league: SEASON_1931 });
  const days = await screen.findAllByTestId("team-league-matchday");
  expect(days[0]).toHaveTextContent("Mo., 02.11. – Fr., 06.11.2026 · 21:15");
  expect(within(days[0]).getAllByTestId("team-league-map-pick").map((item) => item.textContent)).toEqual(["Unsere Wahl", "Decider"]);
  expect(within(days[0]).getByTestId("team-league-bans")).toHaveTextContent("Bann: Karte Ost (wir) · Karte Hafen (Gegner)");
  const others = within(days[0]).getByTestId("team-league-others");
  expect(others).toHaveTextContent("Weitere Spiele (1)");
  expect(others).toHaveTextContent("Fremd Adler0:2Fremd Eulen");
  expect(within(days[1]).queryByTestId("team-league-others")).toBeNull();
  expect(days[2]).toHaveTextContent("gegen Fremd Adler");
  expect(days[2]).toHaveTextContent("Auswärts");
  expect(screen.getByTestId("team-league-next")).toHaveTextContent("@ Fremd Adler");
});

test("Kader (#1931): der ganze Kader mit „von“ und Ersatz je Spieltag", async () => {
  renderPage({ ...BODY, team_league: SEASON_1931 });
  const lineup = await screen.findByTestId("team-league-lineup");
  expect(within(lineup).getByRole("heading", { name: "Kader" })).toBeInTheDocument();
  const [alpha, beta] = within(lineup).getAllByTestId("team-league-player");
  expect(within(alpha).getByTestId("team-league-appearances")).toHaveTextContent("1 von 2");
  expect(alpha).toHaveTextContent("gespielt");
  expect(alpha).toHaveTextContent("Ersatz");
  expect(within(beta).getByTestId("team-league-appearances")).toHaveTextContent("0 von 2");
  expect(within(lineup).queryByTestId("team-league-guests")).toBeNull();
});

test("Liga-Weg: frühere Saisons verlinkt, die aktuelle markiert", async () => {
  renderPage();
  const seasons = await screen.findAllByTestId("team-league-season");
  expect(seasons[0]).toHaveTextContent("Platz 1 von 6 · 14 Pkt");
  expect(within(seasons[0]).getByRole("link")).toHaveAttribute("href", "/references/series/probe-liga/2025-division-2");
  expect(seasons[0].dataset.medal).toBe("1");
  expect(seasons[1].dataset.current).toBe("true");
  expect(within(seasons[1]).queryByRole("link")).not.toBeInTheDocument();
  expect(seasons[1]).toHaveTextContent("läuft");
});

test("Liga-Weg (#1898): Vermerk der Saison wie auf der Übersicht, sonst aus den Stufen abgeleitet", async () => {
  // Ohne Vermerk: Division 2 → Division 1 ist ein Aufstieg; die laufende Saison trägt nur „läuft“.
  const { unmount } = renderPage();
  let notes = await screen.findAllByTestId("team-league-season-note");
  expect(notes.map((note) => note.textContent)).toEqual(["Aufstieg"]);
  unmount();

  // Vermerk ohne Zahl im Namen; die Reihenfolge der Spur ordnet die übrigen Stufen.
  const path = [
    { season: "2023", tier: "Bronze", season_slug: "2023-bronze", status: "completed", current: false, rank: 3, teams: 6, points: 9 },
    { season: "2024", tier: "Silber", season_slug: "2024-silber", status: "completed", current: false, rank: 1, teams: 6, points: 14, season_result: "champion" },
    { season: "2025", tier: "Gold", season_slug: "2025-gold", status: "completed", current: false, rank: 5, teams: 6, points: 4, season_result: "relegated" },
    { season: "2026", tier: "Silber", season_slug: "2026-silber", status: "active", current: true, rank: 2, teams: 3, points: 2 },
  ];
  renderPage({ ...BODY, lineage: { ...BODY.lineage, tier_order: ["Gold", "Silber", "Bronze"] }, team_league: { ...BODY.team_league, path } });
  notes = await screen.findAllByTestId("team-league-season-note");
  expect(notes.map((note) => note.textContent)).toEqual(["Aufstieg", "Meister", "Abstieg"]);
  expect(notes[0].className).toContain("text-ok");
  expect(notes[1].className).toContain("text-honor");
});

test("Eine leere Saison zeigt Hinweise statt leerer Tabellen", async () => {
  renderPage({ ...BODY, team_league: { ...BODY.team_league, table: null, rank_history: [], matchdays: [], lineup: { round_ids: [], players: [] }, path: [] } });
  expect(await screen.findByText("Die Tabelle steht hier nach dem ersten Spieltag.")).toBeInTheDocument();
  expect(screen.getByText("Noch keine Spieltage.")).toBeInTheDocument();
  expect(screen.getByText("Noch kein Kader und keine Aufstellung eingetragen.")).toBeInTheDocument();
  expect(screen.queryByTestId("team-league-path")).not.toBeInTheDocument();
});

test("Aufstellung verlinkt nur öffentlich sichtbare Profile: kein Link bei ausgeblendetem Namen", async () => {
  const players = [{ key: "p-h", name: null, name_hidden: true, club_member: true, guest: false, profile_slug: "probe-versteckt", round_ids: ["r1"], appearances: 1, all_seasons: 1 }];
  renderPage({ ...BODY, team_league: { ...BODY.team_league, lineup: { round_ids: ["r1"], players } } });
  const lineup = await screen.findByTestId("team-league-lineup");
  expect(lineup).toHaveTextContent("Name ausgeblendet");
  expect(within(lineup).queryByRole("link")).not.toBeInTheDocument();
});

test("Mehrere eigene Teams (#1926): im Spielplan steht, welches eigene Team gespielt hat", async () => {
  const matchdays = BODY.team_league.matchdays.map((day, index) => (day.match ? { ...day, match: { ...day.match, team: index ? "Probe Löwen B" : "Probe Löwen" } } : day));
  renderPage({ ...BODY, team_league: { ...BODY.team_league, own_teams: ["Probe Löwen", "Probe Löwen B"], matchdays } });
  const days = await screen.findAllByTestId("team-league-matchday");
  expect(within(days[1]).getByTestId("team-league-own-team")).toHaveTextContent("Probe Löwen B");
  expect(days[1]).toHaveTextContent("Probe Löwen B gegen Fremd Bären");
});

test("Ein eigenes Team: der Spielplan bleibt wie bisher", async () => {
  const matchdays = BODY.team_league.matchdays.map((day) => (day.match ? { ...day, match: { ...day.match, team: "Probe Löwen" } } : day));
  renderPage({ ...BODY, team_league: { ...BODY.team_league, own_teams: ["Probe Löwen"], matchdays } });
  await screen.findAllByTestId("team-league-matchday");
  expect(screen.queryByTestId("team-league-own-team")).toBeNull();
});

test("Die Tabelle der Team-Liga bricht Namen um statt zu kürzen (eigener Rahmen)", async () => {
  renderPage();
  const wrap = await screen.findByTestId("team-league-table-wrap");
  expect(wrap).toHaveClass("tls-tl-table");
});
