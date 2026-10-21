import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Rundenseite (#1950) mit den Sonderregeln (#1960): ein Sprint in umgekehrter Quali-Reihenfolge zeigt Startplatz 1 und
// keine Pole, die Pole steht in der Zusammenfassung aus dem Qualifying; ein Lauf ohne Wertung nennt seinen Grund; eine
// abgebrochene Saison sagt es oben. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceRoundPage } = await import("./ReferenceRoundPage");

const person = (key, name, extra = {}) => ({
  key, name, name_hidden: false, club_member: false, profile_slug: null, own: false, status: "finished", marks: [],
  start_number: null, team: null, team_color: null, grid: null, gained: null, time: null, gap: null, penalty_seconds: null,
  points: null, fastest_lap: false, fastest_lap_time: null, driver_of_the_day: false, ...extra,
});

const session = (key, label, kind, extra) => ({
  id: key, key, session: label, label, kind, state: "scored", club_day: "2026-11-08", time: "20:00", counts: true, has_result: true,
  columns: ["grid", "points"], pole: null, best_club: null, original: null, rows: [], no_score_reason: null, no_score_note: null,
  grid_source: "manual", reverse_top: null, ...extra,
});

const PAGE = {
  lineage: { title: "Probe Racing", slug: "probe-racing", kind: "racing" },
  series: { season: "2026", season_slug: "2026", status: "cancelled", cancelled_on: "2026-11-20", cancel_reason: "Serverwechsel" },
  own_teams: [],
  round: { number: 1, total: 2, code: "R1", venue: "Probe Ring", club_day: "2026-11-08" },
  previous: null,
  next: null,
  sessions: [
    session("qualifying", "Qualifying", "qualifying", { counts: false, columns: [], pole: { key: "eins", time: null }, rows: [person("eins", "Probe Eins", { place: 1, marks: ["pole"] }), person("zwei", "Probe Zwei", { place: 2 })] }),
    session("sprint", "Sprint", "sprint", {
      grid_source: "reverse_qualifying", reverse_top: 8,
      rows: [person("zwei", "Probe Zwei", { place: 1, grid: 1, points: 10 }), person("eins", "Probe Eins", { place: 2, grid: 2, points: 6 })],
    }),
    session("hauptrennen", "Hauptrennen", "race", {
      grid_source: "qualifying", counts: false, no_score_reason: "too_few", no_score_note: "Nur zwei am Start",
      rows: [person("eins", "Probe Eins", { place: 1, grid: 1, marks: ["pole"] }), person("zwei", "Probe Zwei", { place: 2, grid: 2 })],
    }),
  ],
  main: "hauptrennen",
  summary: { winner: { key: "eins", session: "hauptrennen", grid: 1 }, pole: { key: "eins", session: "qualifying", time: null }, fastest_lap: null, driver_of_the_day: null },
  club_drivers: ["eins", "zwei"],
};

function renderAt(path) {
  apiMock.get.mockResolvedValue({ data: PAGE });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug/runde/:roundNumber" element={<ReferenceRoundPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { apiMock.get.mockReset(); });

test("umgekehrter Sprint: Startaufstellung genannt, Startplatz 1 und keine Pole; Pole aus dem Qualifying", async () => {
  renderAt("/references/series/probe-racing/2026/runde/1?lauf=sprint");
  const panel = await screen.findByTestId("round-panel");
  expect(within(panel).getByTestId("round-session-grid")).toHaveTextContent("Start in umgekehrter Quali-Reihenfolge (Top 8)");
  expect(within(panel).queryByText("Pole")).toBeNull();
  expect(screen.getByTestId("round-fact-pole")).toHaveTextContent("Probe Eins");
});

test("Lauf ohne Wertung nennt seinen Grund, die abgebrochene Saison steht oben", async () => {
  renderAt("/references/series/probe-racing/2026/runde/1");
  expect(await screen.findByTestId("series-cancelled")).toHaveTextContent("Saison abgebrochen am 20.11.2026 – Serverwechsel");
  const panel = screen.getByTestId("round-panel");
  expect(within(panel).getByTestId("series-no-score")).toHaveTextContent("Ohne Wertung · Zu wenig Fahrer – Nur zwei am Start");
  expect(within(panel).queryByTestId("round-session-grid")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: /Qualifying/ }));
  expect(screen.queryByTestId("round-session-rules")).toBeNull();
});
