import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Sonderregeln einer Rennliga (#1960) auf der Serienseite: „−5“ mit Grund an den Punkten und im Fahrer-Detail, „im Team
// seit“, Quelle und Modus der Teamwertung samt Prüfhinweis, kein leerer Teamreiter ohne Teamwertung, Regeländerung ab
// Runde X, Termin ohne Wertung (anders als abgesagt) und die abgebrochene Saison mit Nachfolger. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceSeriesPage } = await import("./ReferenceSeriesPage");

const result = (round_id, place, points) => ({ round_id, place, points, marks: [], counted: true, dropped: false });
const row = (key, rank, points, name, extra = {}) => ({
  key, rank, points, name, name_hidden: false, club_member: false, profile_slug: null, previous_rank: null, results: [], adjustments: [], adjustment_points: 0, ...extra,
});
const PENALTY = { points: -5, reason: "Nichtteilnahme nach Anmeldung", day: "2026-11-02", round_id: "r2" };

const ROWS = [
  row("lion1", 1, 15, "Probe Lion Eins", {
    club_member: true, profile_slug: "probe-lion-1", computed_points: 15, official_points: 15, deviation: 0,
    adjustment_points: -5, adjustments: [PENALTY], results: [result("r1", 1, 10), result("r2", 1, 10)],
  }),
  row("ext1", 2, 12, "Fremd Eins", { results: [result("r1", 2, 6), result("r2", 2, 6)] }),
];

const BODY = {
  lineage: { title: "Probe Racing", slug: "probe-racing", kind: "racing", label: "F2", organizer: "Probe Liga" },
  series: { season: "2026", tier: "F2", title: null, season_slug: "2026-f2", status: "active" },
  rules: { points_mode: "scheme", points_by_place: [10, 6, 4], count_mode: "all", count_n: 0, final_top_n: null, tiebreakers: ["countback"], bonuses: {}, activity_points: { points: 0, from_round: 1 } },
  successor: null,
  rule_changes: [{ kind: "format", from_round: 5, to_round: 8, day: "2026-11-12", note: "Ab R5 kein Qualifying, Start in umgekehrter WM-Reihenfolge", sessions: ["Sprint", "Hauptrennen"] }],
  today: "2026-11-20",
  progress: { total: 2, scored: 2, cancelled: 0, remaining: 0, next: null },
  rounds: [
    { id: "r1", position: 1, code: "R1", club_day: "2026-11-01", state: "scored", kind: "regular", counts: true },
    { id: "r2", position: 2, code: "R2", club_day: "2026-11-08", state: "scored", kind: "regular", counts: true },
    { id: "r3", position: 3, code: "R3", club_day: "2026-11-15", state: "missing", kind: "regular", counts: false, no_score_reason: "too_few", no_score_note: "Nur zwei Fahrer am Start" },
  ],
  standings: { round_id: "r2", rows: ROWS },
  final: null,
  racing: {
    seasons: [],
    team_scoring: { enabled: true, counting_drivers: 2, guests_count: true, mode: "current_lineup" },
    teams: {
      round_id: "r2", source: "official",
      rows: [
        { key: "Probe Löwen", team: "Probe Löwen", rank: 1, points: 30, computed_points: 26, official_points: 30, deviation: 4, previous_rank: 1, drivers: ["lion1"], results: [], adjustments: [], adjustment_points: 0 },
      ],
    },
    drivers: { lion1: { team: "Probe Löwen", guest: false, team_since: "r2", round_teams: { r1: "Fremd Rot", r2: "Probe Löwen" } }, ext1: { team: "Fremd Rot", guest: false, team_since: null, round_teams: {} } },
    club_teams: ["Probe Löwen"],
    club_drivers: ["lion1"],
  },
};

function renderPage(body = BODY) {
  apiMock.get.mockResolvedValue({ data: body });
  return render(
    <MemoryRouter initialEntries={["/references/series/probe-racing/2026-f2"]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<ReferenceSeriesPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { apiMock.get.mockReset(); });

test("Anpassung: „−5“ mit Grund an den Punkten und im Fahrer-Detail, dazu „im Team seit“", async () => {
  renderPage();
  const table = await screen.findByTestId("racing-drivers");
  const marks = within(table).getAllByTestId("series-adjustment");
  expect(marks[0]).toHaveTextContent("−5");
  expect(marks[0]).toHaveAttribute("title", "Anpassung −5 · Nichtteilnahme nach Anmeldung · 02.11.2026");
  const detail = screen.getByTestId("racing-driver");
  expect(within(detail).getByTestId("series-adjustments")).toHaveTextContent("−5Nichtteilnahme nach Anmeldung · R2 · 02.11.2026");
  expect(within(detail).getByTestId("racing-driver-team-since")).toHaveTextContent("im Team seit R2");
});

test("Teamwertung: Quelle laut Veranstalter, Modus und Prüfhinweis zur eigenen Rechnung", async () => {
  renderPage();
  const source = await screen.findByTestId("racing-team-source");
  expect(source).toHaveTextContent("Quelle laut Veranstalter (nach R2) · Modus Aktuelle Besetzung: alle Saisonpunkte der Fahrer, die jetzt im Team sind");
  expect(within(source).getByTestId("racing-team-deviations")).toHaveTextContent("Probe Löwen: laut Veranstalter 30, berechnet 26 (+4)");
  // Aktuelle Besetzung: Gesamt sind die Saisonpunkte der aktuellen Fahrer - die Zellen zeigen, wofür gefahren wurde.
  expect(within(source).getByTestId("racing-team-lineup-note")).toHaveTextContent("Gesamt = Saisonpunkte der aktuellen Fahrer (wie beim Veranstalter)");
});

test("Teamwertung „keine“: kein leerer Teamreiter", async () => {
  renderPage({ ...BODY, racing: { ...BODY.racing, team_scoring: { enabled: false }, teams: null } });
  await screen.findByTestId("racing-drivers");
  expect(screen.queryByTestId("racing-teams")).toBeNull();
  expect(screen.queryByText("Teamwertung")).toBeNull();
});

test("Startaufstellung: Sprint in umgekehrter Quali-Reihenfolge (Top 8) steht bei den Regeln", async () => {
  const weekend = { formats: [{ from_round: 1, sessions: [{ label: "Qualifying", grid: "manual", counts: false, points: "none" }, { label: "Sprint", grid: "reverse_qualifying", reverse_top: 8, counts: true, points: "series" }] }] };
  renderPage({ ...BODY, series: { ...BODY.series, weekend } });
  expect(await screen.findByTestId("racing-session-grid")).toHaveTextContent("Startaufstellung Sprint: Start in umgekehrter Quali-Reihenfolge (Top 8)");
});

test("Regeländerung ab Runde X und Termin ohne Wertung (anders als abgesagt)", async () => {
  renderPage();
  const changes = await screen.findByTestId("series-rule-changes");
  expect(within(changes).getByTestId("series-rule-change")).toHaveTextContent("R5–R8 · 12.11.2026Ab R5 kein Qualifying, Start in umgekehrter WM-Reihenfolge");
  const calendar = screen.getByTestId("racing-calendar");
  expect(within(calendar).getByTestId("series-no-score")).toHaveTextContent("Ohne Wertung · Zu wenig Fahrer – Nur zwei Fahrer am Start");
});

test("Saison abgebrochen: Hinweis mit Grund, Ergebnisse bleiben, Link zum Nachfolger", async () => {
  renderPage({
    ...BODY,
    series: { ...BODY.series, status: "cancelled", cancelled_on: "2026-11-20", cancel_reason: "Neustart mit anderem Auto" },
    successor: { season: "2026", tier: "F2 Neustart", title: null, season_slug: "2026-f2-neustart", status: "active", lineage_slug: "probe-racing" },
  });
  expect(await screen.findByTestId("series-cancelled")).toHaveTextContent("Saison abgebrochen am 20.11.2026 – Neustart mit anderem Auto.");
  expect(screen.getByTestId("series-successor")).toHaveAttribute("href", "/references/series/probe-racing/2026-f2-neustart");
  expect(screen.getByTestId("racing-drivers")).toHaveTextContent("Probe Lion Eins");
});
