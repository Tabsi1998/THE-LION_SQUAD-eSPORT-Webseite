import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Runde mit Läufen (#1930) auf der Seite einer Rennliga: eine Runde mit Lauf-Chips im Kalender, ein Kopf je Runde über
// Sprint und Rennen im Raster, Fortschritt in Runden, der nächste Lauf, Punkte je Lauf und im Fahrer-Detail Poles, Ø Start
// und das Quali-Duell. Nur erfundene Namen und Orte.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceSeriesPage } = await import("./ReferenceSeriesPage");

function result(round_id, place, points, extra = {}) {
  return { round_id, place, points, marks: [], counted: true, dropped: false, ...extra };
}

function row(key, rank, points, name, results, extra = {}) {
  return { key, rank, points, name, name_hidden: false, club_member: false, profile_slug: null, previous_rank: null, results, ...extra };
}

const session = (id, code, label, kind, weekend, extra) => ({
  id, code, session: label, session_kind: kind, weekend, kind: "regular", counts: kind !== "qualifying", ...extra,
});

const ROUNDS = [
  session("q1", "R1", "Qualifying", "qualifying", 1, { position: 1, venue: "Probering", country_code: "AT", club_day: "2026-03-07", time: "20:00", state: "scored" }),
  session("s1", "R1", "Sprint", "sprint", 1, { position: 2, venue: "Probering", country_code: "AT", club_day: "2026-03-07", time: "20:30", state: "scored" }),
  session("f1", "R1", "Hauptrennen", "race", 1, { position: 3, venue: "Probering", country_code: "AT", club_day: "2026-03-08", time: "20:00", state: "scored" }),
  session("q2", "R2", "Qualifying", "qualifying", 2, { position: 4, venue: "Testkurs", club_day: "2026-03-14", time: "20:00", state: "planned" }),
  session("s2", "R2", "Sprint", "sprint", 2, { position: 5, venue: "Testkurs", club_day: "2026-03-14", time: "20:30", state: "planned" }),
  session("f2", "R2", "Hauptrennen", "race", 2, { position: 6, venue: "Testkurs", club_day: "2026-03-14", time: "21:15", state: "planned" }),
];

const ROWS = [
  row("lion1", 1, 37, "Probe Lion Eins", [result("s1", 1, 12, { grid: 8 }), result("f1", 1, 25, { grid: 1, marks: ["pole"] })], { club_member: true, profile_slug: "probe-lion-1" }),
  row("lion2", 2, 27, "Probe Lion Zwei", [result("s1", 2, 9, { grid: 7 }), result("f1", 2, 18, { grid: 2 })], { club_member: true }),
  row("ext1", 3, 22, "Fremd Eins", [result("s1", 3, 7, { grid: 1 }), result("f1", 3, 15, { grid: 3 })]),
];

const BODY = {
  lineage: { title: "Probe Rennliga", slug: "probe-rennliga", kind: "racing", label: "F2" },
  series: {
    season: "2026", tier: "F2", season_slug: "2026-f2", status: "active",
    weekend: { formats: [{ from_round: 1, sessions: [
      { label: "Qualifying", counts: false, points: "none", grid: "manual", offset: 0 },
      { label: "Sprint", counts: true, points: [12, 9, 7, 6, 5, 4, 3, 2, 1], grid: "manual", offset: 30 },
      { label: "Hauptrennen", counts: true, points: "series", grid: "qualifying", offset: 60 },
    ] }] },
  },
  rules: { points_mode: "scheme", points_by_place: [25, 18, 15], count_mode: "all", count_n: 0, tiebreakers: [], bonuses: {}, activity_points: { points: 0, from_round: 1 } },
  today: "2026-03-10",
  progress: { total: 2, scored: 1, cancelled: 0, remaining: 1, next: { ...ROUNDS[3] } },
  rounds: ROUNDS,
  standings: { round_id: "f1", rows: ROWS },
  final: null,
  racing: {
    seasons: [], team_scoring: { enabled: false }, teams: null,
    drivers: {
      lion1: { team: "Probe Löwen", guest: false, round_teams: { s1: "Probe Löwen", f1: "Probe Löwen" } },
      lion2: { team: "Probe Löwen", guest: false, round_teams: { s1: "Probe Löwen", f1: "Probe Löwen" } },
      ext1: { team: "Fremd Rot", guest: false, round_teams: { s1: "Fremd Rot", f1: "Fremd Rot" } },
    },
    club_teams: ["Probe Löwen"],
    club_drivers: ["lion1", "lion2"],
    qualifying: [{ round_id: "q1", places: { lion1: 1, lion2: 2, ext1: 3 } }],
  },
};

function renderPage(body = BODY) {
  apiMock.get.mockResolvedValue({ data: body });
  return render(
    <MemoryRouter initialEntries={["/references/series/probe-rennliga/2026-f2"]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<ReferenceSeriesPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { apiMock.get.mockReset(); });

test("Kalender: je Runde eine Zeile mit Flagge, Ort und den Lauf-Chips samt Uhrzeit", async () => {
  renderPage();
  const calendar = await screen.findByTestId("racing-calendar");
  const weekends = within(calendar).getAllByTestId("racing-round");
  expect(weekends).toHaveLength(2);
  expect(weekends[0]).toHaveAttribute("data-state", "scored");
  const chips = within(weekends[0]).getAllByTestId("session-chip");
  // Am zweiten Tag mit Wochentag - die Chips sagen Lauf, Zeit und Status.
  expect(chips.map((chip) => chip.textContent.split(":")[0])).toEqual(["Quali20", "Sprint20", "HauptrennenSo 20"]);
  expect(chips[0]).toHaveAttribute("title", "Qualifying, Sa., 07.03.2026 · 20:00, Gewertet");
  // Sieger je Lauf, wenn die Runde mehrere zählende Läufe hat - ein Qualifying hat keine Zeile.
  const winners = within(weekends[0]).getAllByTestId("racing-round-winner");
  expect(winners.map((line) => line.textContent)).toEqual([
    expect.stringContaining("Sieg · Sprint"), expect.stringContaining("Sieg · Hauptrennen"),
  ]);
  expect(within(weekends[1]).getAllByTestId("session-chip").map((chip) => chip.dataset.state)).toEqual(["planned", "planned", "planned"]);
});

test("Fortschritt in Runden, der nächste Lauf und die Punkte je Lauf", async () => {
  renderPage();
  expect(await screen.findByTestId("series-progress")).toHaveTextContent("1 von 2 Rennen gewertet");
  expect(screen.getByTestId("series-next")).toHaveTextContent("Nächstes Rennen: R2 · Qualifying · Sa., 14.03.2026 · 20:00");
  expect(screen.getByTestId("racing-session-points")).toHaveTextContent("Punkte je Lauf Sprint: 12 · 9 · 7 · 6 · 5 · 4 · 3 · 2 · 1");
});

test("Raster: ein Kopf je Runde über Sprint und Hauptrennen", async () => {
  renderPage();
  const table = await screen.findByTestId("series-table");
  const heads = within(table).getAllByTestId("series-weekend-head");
  expect(heads.map((head) => head.textContent)).toEqual(["R1", "R2"]);
  expect(heads[0]).toHaveAttribute("colspan", "2");
  expect(within(table).getAllByTestId("series-session-head").map((head) => head.textContent)).toEqual(["S", "HR", "S", "HR"]);
  const first = within(table).getAllByTestId("series-row")[0];
  expect(within(first).getAllByTestId("race-cell").map((cell) => cell.textContent)).toEqual(["1", "1"]);
  expect(within(first).getByText("R1 · Sprint: Platz 1, 12 Punkte, von Startplatz 8 (7 Plätze gutgemacht)")).toBeInTheDocument();
});

test("Fahrer-Detail: Poles, Ø Start und Quali-Duell gegen den Teamkollegen", async () => {
  renderPage();
  const detail = await screen.findByTestId("racing-driver");
  expect(within(detail).getByTestId("racing-driver-stats")).toHaveTextContent("1 Pole");
  expect(within(detail).getByTestId("racing-driver-stats")).toHaveTextContent("Ø Start 4,5");
  expect(within(detail).getByTestId("racing-driver-stats")).toHaveTextContent("Quali-Duell 1:0 gegen Probe Lion Zwei");
});

function pointsOf(table) {
  return within(table).getAllByTestId("series-row").map((row) => {
    const cells = row.querySelectorAll("td");
    const name = within(row).getByRole("rowheader").querySelector(".tls-racing-name, .tls-standing-name");
    return [name.textContent, cells[cells.length - 2].textContent];
  });
}

test("Wertung je Lauf: Gesamt · Rennen · Sprint - die eigene Sprint-Tabelle mit ihren Summen", async () => {
  renderPage();
  const tabs = await screen.findByTestId("racing-table-tabs");
  expect(within(tabs).getAllByRole("button").map((button) => button.textContent)).toEqual(["Gesamt", "Rennen", "Sprint"]);
  expect(screen.getByTestId("racing-table-all")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTestId("racing-table-sprint"));
  expect(screen.getByTestId("racing-table-sprint")).toHaveAttribute("aria-pressed", "true");
  const drivers = screen.getByTestId("racing-drivers");
  const table = within(drivers).getByTestId("series-table");
  expect(pointsOf(table)).toEqual([["Probe Lion Eins", "12"], ["Probe Lion Zwei", "9"], ["Fremd Eins", "7"]]);
  // Je Runde ist es ein Lauf - kein Kopf über mehreren Spalten.
  expect(within(table).queryAllByTestId("series-weekend-head")).toHaveLength(0);
  fireEvent.click(screen.getByTestId("racing-table-race"));
  expect(pointsOf(within(drivers).getByTestId("series-table"))).toEqual([["Probe Lion Eins", "25"], ["Probe Lion Zwei", "18"], ["Fremd Eins", "15"]]);
  fireEvent.click(screen.getByTestId("racing-table-all"));
  expect(pointsOf(within(drivers).getByTestId("series-table"))).toEqual([["Probe Lion Eins", "37"], ["Probe Lion Zwei", "27"], ["Fremd Eins", "22"]]);
});


// Ergebnis je Runde (#1950): Kalenderzeile, Lauf-Chips und der Kopf im Raster führen zur Ergebnisseite der Runde.
test("Kalenderzeile, Lauf-Chips und Kopf im Raster führen zur Ergebnisseite der Runde", async () => {
  renderPage();
  const calendar = await screen.findByTestId("racing-calendar");
  const links = within(calendar).getAllByTestId("racing-round-link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "/references/series/probe-rennliga/2026-f2/runde/1", "/references/series/probe-rennliga/2026-f2/runde/2"]);
  const chips = within(within(calendar).getAllByTestId("racing-round")[0]).getAllByTestId("session-chip");
  expect(chips.map((chip) => chip.getAttribute("href"))).toEqual([
    "/references/series/probe-rennliga/2026-f2/runde/1?lauf=qualifying",
    "/references/series/probe-rennliga/2026-f2/runde/1?lauf=sprint",
    "/references/series/probe-rennliga/2026-f2/runde/1?lauf=hauptrennen",
  ]);
  const table = within(screen.getByTestId("racing-drivers")).getByTestId("series-table");
  const heads = within(table).getAllByTestId("series-weekend-head");
  expect(within(heads[0]).getByTestId("series-round-link")).toHaveAttribute("href", "/references/series/probe-rennliga/2026-f2/runde/1");
  const sessions = within(table).getAllByTestId("series-session-head");
  expect(within(sessions[0]).getByRole("link")).toHaveAttribute("href", "/references/series/probe-rennliga/2026-f2/runde/1?lauf=sprint");
});

const STATS = {
  drivers: [
    { key: "lion1", name: "Probe Lion Eins", club_member: true, profile_slug: "probe-lion-1", wins: 2, podiums: 2, poles: 1, avg_grid: 4.5, races: 2 },
    { key: "ext1", name: "Fremd Eins", club_member: false, wins: 0, podiums: 2, poles: 0, avg_grid: 2, races: 2 },
  ],
  teams: [{ key: "Probe Löwen", team: "Probe Löwen", own: true, wins: 2, podiums: 4, poles: 1, avg_grid: 4.5, races: 4 }],
  metrics: { drivers: ["wins", "podiums", "poles", "avg_grid"], teams: ["wins", "podiums", "poles", "avg_grid"] },
};

test("Reiter Statistik: je Kennzahl die Spitze und die Tabelle, nur Kennzahlen, die vorkommen", async () => {
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/statistics") ? STATS : BODY }));
  render(
    <MemoryRouter initialEntries={["/references/series/probe-rennliga/2026-f2"]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<ReferenceSeriesPage />} /></Routes>
    </MemoryRouter>,
  );
  const tab = await screen.findByTestId("racing-view-statistik");
  expect(screen.getByTestId("racing-view-saison")).toHaveAttribute("aria-selected", "true");
  fireEvent.click(tab);
  const stats = await screen.findByTestId("season-stats");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/public/probe-rennliga/2026-f2/statistics");
  expect(screen.queryByTestId("racing-calendar")).not.toBeInTheDocument();
  const leaders = within(stats).getByTestId("season-stats-leaders");
  expect(within(leaders).getAllByRole("button").map((button) => button.textContent)).toEqual(
    ["Meiste Siege", "Meiste Podien", "Meiste Poles", "Bester Ø Startplatz"]);
  const table = within(stats).getByTestId("season-stats-table");
  expect(within(table).queryByText("Ausf.")).not.toBeInTheDocument();
  const rows = within(table).getAllByTestId("season-stats-row");
  expect(rows[0]).toHaveTextContent("Probe Lion Eins");
  expect(rows[0]).toHaveAttribute("data-own", "true");
  // Nach Ø Start sortiert: der kleinste zuerst.
  fireEvent.click(within(table).getByTestId("season-stats-sort-avg_grid"));
  expect(within(table).getAllByTestId("season-stats-row")[0]).toHaveTextContent("Fremd Eins");
  fireEvent.click(within(stats).getByTestId("season-stats-teams"));
  expect(within(within(stats).getByTestId("season-stats-table")).getAllByTestId("season-stats-row")[0]).toHaveTextContent("Probe Löwen");
});

test("Original-Bilder (#1933): je Runde ein „Original ansehen“ mit den Bildern aller Läufe, Lauf davor", async () => {
  const url = "/api/reference-series/public/probe-rennliga/2026-f2/originals";
  renderPage({ ...BODY, originals: {
    q1: [{ id: "a", kind: "qualifying", url: `${url}/a`, width: 1600, height: 900 }],
    s1: [{ id: "b", kind: "sprint", url: `${url}/b`, width: 1600, height: 900 }],
    f1: [{ id: "c", kind: "race", url: `${url}/c`, width: 1600, height: 900 }, { id: "d", kind: "table", url: `${url}/d`, width: 1200, height: 900 }],
  } });
  const weekends = await screen.findAllByTestId("racing-round");
  expect(within(weekends[1]).queryByTestId("racing-round-originals")).toBeNull();
  const button = within(weekends[0]).getByTestId("racing-round-originals");
  expect(button).toHaveAccessibleName("Original ansehen, 4 Bilder");
  fireEvent.click(button);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Original-Bilder: R1 · Probering");
  expect(screen.getAllByTestId("original-viewer-thumb").map((thumb) => thumb.getAttribute("aria-label"))).toEqual([
    "Bild 1: Qualifying", "Bild 2: Sprint", "Bild 3: Hauptrennen · Rennen", "Bild 4: Hauptrennen · Tabelle",
  ]);
});