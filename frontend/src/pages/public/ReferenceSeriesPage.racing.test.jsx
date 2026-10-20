import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Seite Rennliga (#1746): Umschalter zwischen den Saisons der Spur, Rennraster mit Podium, schnellster Runde, Ausfall,
// Abstand und Abweichung zum offiziellen Wert, Teamwertung mit Balken, Vereins-Garage mit Teamduell, Fahrer-Detail nur
// für öffentliche Vereinsfahrer (die der Server in club_drivers nennt, auch per Adresse), Gäste und Fremde außerhalb der
// Tabellen nur als „Gastfahrer“, Punkte fürs Team aus der gespeicherten Teamwertung und der Rennkalender mit Sieger
// (nur aus dem Verein) und bestem Vereinsfahrer. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceSeriesPage } = await import("./ReferenceSeriesPage");

function result(round_id, place, points, marks = []) {
  return { round_id, place, points, marks, counted: true, dropped: false };
}

function row(key, rank, points, name, extra = {}) {
  return { key, rank, points, name, name_hidden: false, club_member: false, profile_slug: null, previous_rank: null, results: [], ...extra };
}

const ROWS = [
  row("ext1", 1, 44, "Fremd Eins", { results: [result("r1", 1, 26, ["fastest_lap"]), result("r2", 2, 18)] }),
  row("lion1", 2, 40, "Probe Lion Eins", {
    club_member: true, profile_slug: "probe-lion-1", computed_points: 43, official_points: 40, deviation: -3,
    results: [result("r1", 2, 18), result("r2", 1, 25)],
  }),
  row("lion3", 3, 24, "Probe Lion Drei", { club_member: true, results: [result("r1", 6, 8), result("r2", 3, 16, ["fastest_lap"])] }),
  row("guest", 4, 22, "Gast Probe", { results: [result("r1", 5, 10), result("r2", 4, 12)] }),
  row("lion2", 5, 12, "Probe Lion Zwei", { club_member: true, results: [result("r1", 4, 12), result("r2", null, 0, ["dns"])] }),
  row("hidden", 6, 6, null, { name_hidden: true, results: [result("r1", 7, 6), result("r2", 6, 0, ["dnf"])] }),
];

const DRIVERS = {
  ext1: { team: "Fremd Rot", guest: false, round_teams: { r1: "Fremd Rot", r2: "Fremd Rot" } },
  lion1: { team: "Probe Löwen", guest: false, round_teams: { r1: "Probe Löwen", r2: "Probe Löwen" } },
  lion2: { team: "Probe Löwen", guest: false, round_teams: { r1: "Probe Löwen", r2: "Probe Löwen" } },
  lion3: { team: "Probe Löwen B", guest: false, round_teams: { r1: "Probe Löwen B", r2: "Probe Löwen B" } },
  guest: { team: "Probe Löwen B", guest: true, round_teams: { r1: "Probe Löwen B", r2: "Probe Löwen B" } },
  hidden: { team: "Fremd Rot", guest: false, round_teams: { r1: "Fremd Rot", r2: "Fremd Rot" } },
};

function teamRow(team, rank, points, drivers, results, extra = {}) {
  return { key: team, team, rank, points, computed_points: points, official_points: null, deviation: null, previous_rank: rank, drivers, results, ...extra };
}

const BODY = {
  lineage: { title: "Probe Racing", slug: "probe-racing", kind: "racing", label: "F1", organizer: "Probe Liga", game_name: "Probe Rennspiel" },
  series: { season: "2026", tier: "F1", title: null, season_slug: "2026-f1", status: "active" },
  rules: {
    points_mode: "scheme", points_by_place: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], count_mode: "all", count_n: 0, final_top_n: null,
    tiebreakers: ["countback"], bonuses: { fastest_lap: { points: 1, max_place: 10 }, pole: { points: 0, max_place: null } },
    activity_points: { points: 0, from_round: 1 },
  },
  today: "2026-11-20",
  progress: { total: 3, scored: 2, cancelled: 1, remaining: 1, next: { id: "r4", position: 4, code: "R4", club_day: "2026-11-29", time: "20:30", state: "planned", kind: "regular" } },
  rounds: [
    { id: "r1", position: 1, code: "R1", venue: "Probering", club_day: "2026-11-01", time: "20:30", state: "scored", kind: "regular", counts: true },
    { id: "r2", position: 2, code: "R2", venue: "Testkurs", club_day: "2026-11-08", time: "20:30", state: "scored", kind: "regular", counts: true },
    { id: "rx", position: 3, code: "R3", club_day: "2026-11-15", time: null, state: "cancelled", kind: "regular", counts: true },
    { id: "r4", position: 4, code: "R4", club_day: "2026-11-29", time: "20:30", state: "planned", kind: "regular", counts: true },
  ],
  standings: { round_id: "r2", rows: ROWS },
  final: null,
  racing: {
    seasons: [
      { season: "2026", tier: "F1", title: null, season_slug: "2026-f1", status: "active", current: true },
      { season: "2026", tier: "F2", title: null, season_slug: "2026-f2", status: "active", current: false },
      { season: "2025", tier: "F1", title: null, season_slug: "2025-f1", status: "completed", current: false },
    ],
    team_scoring: { enabled: true, counting_drivers: 2, guests_count: true },
    teams: {
      round_id: "r2",
      rows: [
        teamRow("Fremd Rot", 1, 59, ["ext1", "hidden"], [{ round_id: "r1", points: 32, drivers: ["ext1", "hidden"] }, { round_id: "r2", points: 18, drivers: ["ext1", "hidden"] }], { driver_points: { ext1: 44, hidden: 6 } }),
        teamRow("Probe Löwen", 2, 55, ["lion1", "lion2"], [{ round_id: "r1", points: 30, drivers: ["lion1", "lion2"] }, { round_id: "r2", points: 25, drivers: ["lion1", "lion2"] }], { official_points: 52, deviation: -3, points: 52, driver_points: { lion1: 43, lion2: 12 } }),
        teamRow("Probe Löwen B", 3, 46, ["lion3", "guest"], [{ round_id: "r1", points: 18, drivers: ["guest", "lion3"] }, { round_id: "r2", points: 28, drivers: ["lion3", "guest"] }], { driver_points: { lion3: 24, guest: 22 } }),
      ],
    },
    drivers: DRIVERS,
    club_teams: ["Probe Löwen", "Probe Löwen B"],
    club_drivers: ["lion1", "lion3", "lion2"],
  },
};

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path, body = BODY) {
  apiMock.get.mockResolvedValue({ data: body });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<><ReferenceSeriesPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { apiMock.get.mockReset(); });

test("Rennliga: Umschalter zwischen den Saisons, Fortschritt in Rennen, Regeln mit Bonus", async () => {
  renderAt("/references/series/probe-racing/2026-f1");
  const switcher = await screen.findByRole("navigation", { name: "Saisons und Ligen" });
  const links = within(switcher).getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual(["2026 · F1läuft", "2026 · F2läuft", "2025 · F1"]);
  expect(links[0]).toHaveAttribute("aria-current", "page");
  expect(links[2]).toHaveAttribute("href", "/references/series/probe-racing/2025-f1");
  expect(screen.getByTestId("series-progress")).toHaveTextContent("2 von 3 Rennen gewertet · 1 abgesagt");
  expect(screen.getByTestId("series-next")).toHaveTextContent("Nächstes Rennen: R4 · So., 29.11.2026 · 20:30");
  expect(screen.getByTestId("racing-bonus")).toHaveTextContent("+1 Punkt für die schnellste Runde (bis Platz 10)");
});

test("Fahrerwertung: Rennraster mit Podium, schnellster Runde, Ausfall, Abstand und Abweichung; Fremde ohne Link", async () => {
  renderAt("/references/series/probe-racing/2026-f1");
  const section = await screen.findByTestId("racing-drivers");
  const table = within(section).getByTestId("series-table");
  const rows = within(table).getAllByTestId("series-row");
  expect(rows).toHaveLength(6);
  const [ext1, lion1, , , lion2, hidden] = rows;
  const cells = within(ext1).getAllByTestId("race-cell");
  expect(cells.map((cell) => [cell.textContent, cell.dataset.medal || null])).toEqual([["1", "gold"], ["2", "silver"]]);
  expect(within(cells[0]).getByTestId("race-fastest")).toBeInTheDocument();
  expect(cells[0]).toHaveAttribute("title", "R1: Platz 1, 26 Punkte, schnellste Runde");
  expect(within(hidden).getAllByTestId("race-cell").map((cell) => cell.textContent)).toEqual(["7", "DNF"]);
  expect(within(hidden).getByText("Name ausgeblendet")).toBeInTheDocument();
  expect(within(lion2).getAllByTestId("race-cell")[1]).toHaveTextContent("DNS");
  // Abstand zur Spitze und der offizielle Wert, der von der eigenen Summe abweicht.
  expect(within(lion1).getByTestId("racing-gap")).toHaveTextContent("−4");
  expect(within(ext1).getByTestId("racing-gap")).toHaveTextContent("");
  const deviation = within(lion1).getByTestId("racing-deviation");
  expect(deviation).toHaveTextContent("−3");
  expect(deviation).toHaveAttribute("title", "Laut Veranstalter 40 Punkte, eigene Summe 43 – Abweichung −3 (etwa Strafen)");
  // Team unter dem Namen; fremde Namen sind reiner Text, Vereinsfahrer öffnen ihr Detail.
  expect(ext1).toHaveTextContent("Fremd Rot");
  expect(within(ext1).queryByRole("button")).toBeNull();
  expect(within(ext1).queryByRole("link")).toBeNull();
  expect(within(lion1).getByRole("button", { name: "Probe Lion Eins" })).toBeInTheDocument();
  expect(within(rows[3]).getByText("Gast")).toBeInTheDocument();
  // Abgesagte Rennen stehen durchgestrichen im Kopf.
  expect(within(table).getByRole("columnheader", { name: "R3" })).toHaveClass("line-through");
});

test("Teamwertung: Balken und Raster, Vereinsteams hervorgehoben, Gäste markiert, Regel sichtbar", async () => {
  renderAt("/references/series/probe-racing/2026-f1");
  const section = await screen.findByTestId("racing-teams");
  expect(within(section).getByTestId("racing-team-rule")).toHaveTextContent("Je Rennen zählen die besten 2 Fahrer eines Teams. Gäste zählen fürs Team.");
  const rows = within(within(section).getByTestId("series-table")).getAllByTestId("series-row");
  expect(rows.map((item) => item.dataset.club || "")).toEqual(["", "true", "true"]);
  expect(rows[1]).toHaveTextContent("Probe Löwen");
  expect(rows[1]).toHaveTextContent("Verein");
  expect(within(rows[2]).getByText("Gast")).toBeInTheDocument();
  expect(rows[2]).toHaveTextContent("Probe Lion Drei");
  const bars = within(section).getAllByTestId("racing-team-bar");
  expect(bars[0].style.getPropertyValue("--share")).toBe("1");
  expect(Number(bars[1].style.getPropertyValue("--share"))).toBeCloseTo(52 / 59, 3);
  expect(within(rows[1]).getByTestId("racing-deviation")).toHaveTextContent("−3");
  expect(within(rows[0]).getAllByTestId("racing-team-cell").map((cell) => cell.textContent)).toEqual(["32", "18"]);
});

// Wie BODY, nur zählen Gäste nicht fürs Team: der Server meldet für den Gast keinen Beitrag (driver_points).
const GUESTS_NOT_COUNTING = {
  ...BODY,
  racing: {
    ...BODY.racing,
    team_scoring: { enabled: true, counting_drivers: 2, guests_count: false },
    teams: { ...BODY.racing.teams, rows: BODY.racing.teams.rows.map((item) => (item.team === "Probe Löwen B"
      ? { ...item, points: 24, computed_points: 24, drivers: ["lion3"], driver_points: { lion3: 24 } } : item)) },
  },
};

test("Garage: Vereinsteams mit Fahrern und Teamduell, das Detail zeigt den ersten Vereinsfahrer", async () => {
  renderAt("/references/series/probe-racing/2026-f1", GUESTS_NOT_COUNTING);
  const garage = await screen.findByTestId("racing-garage");
  const teams = within(garage).getAllByTestId("racing-garage-team");
  expect(teams.map((team) => within(team).getByRole("heading", { level: 3 }).textContent)).toEqual(["Probe Löwen", "Probe Löwen B"]);
  expect(teams[0]).toHaveTextContent("P2 · 52 Pkt");
  // Fremde Namen nur in Tabellen: der Gast heißt in Garage und Duell „Gastfahrer“, Marke und Punkte bleiben.
  expect(garage).not.toHaveTextContent("Gast Probe");
  expect(within(teams[1]).getAllByText("Gastfahrer")).toHaveLength(2);
  expect(within(teams[1]).getByText("Gast")).toBeInTheDocument();
  expect(teams[1]).toHaveTextContent("P4 · 22 Pkt");
  expect(within(teams[1]).queryByRole("button", { name: /Gast/ })).toBeNull();
  // Teamduell: Platz-Vergleich aus den Rennen, Punkte fürs Team aus der gespeicherten Teamwertung (Gast zählt nicht).
  const duel = within(teams[1]).getByTestId("racing-duel");
  expect(duel).toHaveTextContent("Probe Lion Drei");
  expect(duel).toHaveTextContent("1:1");
  expect(duel).toHaveTextContent("24 Pkt fürs Team");
  expect(within(duel).getByTestId("racing-duel-points-b")).toHaveTextContent("0 Pkt");
  expect(within(teams[0]).getByTestId("racing-duel")).toHaveTextContent("43 Pkt fürs Team");

  const detail = screen.getByTestId("racing-driver");
  expect(within(detail).getByRole("heading", { level: 3 })).toHaveTextContent("Probe Lion Eins");
  expect(detail).toHaveTextContent("P2 in der Fahrerwertung · 40 Punkte · 2 Rennen");
  expect(within(detail).getByTestId("racing-driver-stats")).toHaveTextContent("1 Sieg · 2 Podien · 0 schnellste Runden · 0 Ausfälle");
  expect(within(detail).getByRole("link", { name: "Vereinsprofil" })).toHaveAttribute("href", "/members/probe-lion-1");
  // Je Rennen ein Balken mit Platz; abgesagt und noch offen ohne Balken.
  expect(within(detail).getAllByTestId("racing-driver-race").map((item) => item.getAttribute("title"))).toEqual([
    "R1: Platz 2, 18 Punkte", "R2: Platz 1, 25 Punkte", "R3: abgesagt", "R4: noch offen"]);
  expect(within(detail).getAllByTestId("racing-driver-bar").map((bar) => bar.style.getPropertyValue("--share"))).toEqual(["0.72", "1"]);

  fireEvent.click(within(teams[1]).getByRole("button", { name: /Probe Lion Drei/ }));
  expect(within(detail).getByRole("heading", { level: 3 })).toHaveTextContent("Probe Lion Drei");
  expect(within(detail).getByTestId("racing-driver-stats")).toHaveTextContent("0 Siege · 1 Podium · 1 schnellste Runde · 0 Ausfälle");
  expect(screen.getByTestId("where")).toHaveTextContent("/references/series/probe-racing/2026-f1?fahrer=lion3");
  expect(within(teams[1]).getByRole("button", { name: /Probe Lion Drei/ })).toHaveAttribute("aria-pressed", "true");
});

test("Fahrer-Detail aus der Tabelle und per Adresse; ein fremder Fahrer bekommt keins", async () => {
  renderAt("/references/series/probe-racing/2026-f1?fahrer=lion2");
  const detail = await screen.findByTestId("racing-driver");
  expect(within(detail).getByRole("heading", { level: 3 })).toHaveTextContent("Probe Lion Zwei");
  expect(within(detail).queryByRole("link", { name: "Vereinsprofil" })).toBeNull();

  const table = within(screen.getByTestId("racing-drivers")).getByTestId("series-table");
  fireEvent.click(within(table).getByRole("button", { name: "Probe Lion Drei" }));
  expect(within(detail).getByRole("heading", { level: 3 })).toHaveTextContent("Probe Lion Drei");
});

test("ein Vereinsmitglied ohne öffentliches Profil: kein Detail, kein Knopf, in der Garage ohne Namen", async () => {
  // Der Server nennt Lion Zwei nicht in club_drivers (etwa Profil nicht aktiv) - auch ?fahrer= öffnet nichts.
  renderAt("/references/series/probe-racing/2026-f1?fahrer=lion2", { ...BODY, racing: { ...BODY.racing, club_drivers: ["lion1", "lion3"] } });
  const detail = await screen.findByTestId("racing-driver");
  expect(within(detail).getByRole("heading", { level: 3 })).toHaveTextContent("Probe Lion Eins");
  expect(detail).not.toHaveTextContent("Probe Lion Zwei");
  const table = within(screen.getByTestId("racing-drivers")).getByTestId("series-table");
  const row = within(table).getAllByTestId("series-row").find((item) => item.textContent.includes("Probe Lion Zwei"));
  expect(within(row).queryByRole("button")).toBeNull();
  const lions = within(screen.getByTestId("racing-garage")).getAllByTestId("racing-garage-team")[0];
  expect(lions).not.toHaveTextContent("Probe Lion Zwei");
  expect(within(lions).getAllByText("Vereinsfahrer").length).toBeGreaterThan(0);
});

test("kein öffentlicher Vereinsfahrer: die Garage bleibt mit ihren Teams, nur das Fahrer-Detail entfällt", async () => {
  renderAt("/references/series/probe-racing/2026-f1?fahrer=lion1", { ...BODY, racing: { ...BODY.racing, club_drivers: [] } });
  const garage = await screen.findByTestId("racing-garage");
  const teams = within(garage).getAllByTestId("racing-garage-team");
  expect(teams.map((team) => within(team).getByRole("heading", { level: 3 }).textContent)).toEqual(["Probe Löwen", "Probe Löwen B"]);
  expect(within(teams[0]).getAllByText("Vereinsfahrer").length).toBeGreaterThan(0);
  expect(within(teams[1]).getAllByText("Gastfahrer").length).toBeGreaterThan(0);
  expect(within(garage).queryByRole("button")).toBeNull();
  expect(screen.queryByTestId("racing-driver")).toBeNull();
  expect(garage).not.toHaveTextContent("Probe Lion Eins");
});

test("eine fremde Kennung in der Adresse öffnet kein Detail für Fremde", async () => {
  renderAt("/references/series/probe-racing/2026-f1?fahrer=ext1");
  const detail = await screen.findByTestId("racing-driver");
  expect(within(detail).getByRole("heading", { level: 3 })).toHaveTextContent("Probe Lion Eins");
  expect(detail).not.toHaveTextContent("Fremd Eins");
});

test("Rennkalender: Status, Sieger und bester Vereinsfahrer je Rennen", async () => {
  renderAt("/references/series/probe-racing/2026-f1");
  const calendar = await screen.findByTestId("racing-calendar");
  const items = within(calendar).getAllByTestId("racing-round");
  expect(items.map((item) => item.dataset.state)).toEqual(["scored", "scored", "cancelled", "planned"]);
  expect(items[0]).toHaveTextContent("Probering");
  // Ein fremder Sieger steht nur in der Tabelle - hier dann nur der beste Vereinsfahrer mit Platz.
  expect(within(items[0]).queryByTestId("racing-round-winner")).toBeNull();
  expect(items[0]).not.toHaveTextContent("Fremd Eins");
  expect(within(items[0]).getByTestId("racing-round-club")).toHaveTextContent("Bester Vereinsfahrer Probe Lion Eins · P2");
  // Gewinnt ein Vereinsfahrer, steht er einmal - als Sieger mit Vereinsmarke.
  expect(within(items[1]).getByTestId("racing-round-winner")).toHaveTextContent("Sieg Probe Lion Eins");
  expect(within(items[1]).getByTestId("racing-round-winner")).toHaveTextContent("Verein");
  expect(within(items[1]).queryByTestId("racing-round-club")).toBeNull();
  expect(within(items[2]).queryByTestId("racing-round-winner")).toBeNull();
});

test("ohne Vereinsfahrer und ohne Teamwertung keine Garage und keine Teamtabelle", async () => {
  const rows = ROWS.map((item) => ({ ...item, club_member: false }));
  renderAt("/references/series/probe-racing/2026-f1", {
    ...BODY, standings: { round_id: "r2", rows },
    racing: { ...BODY.racing, teams: null, team_scoring: { enabled: false, counting_drivers: null, guests_count: true }, club_teams: [], seasons: [BODY.racing.seasons[0]] },
  });
  await screen.findByTestId("racing-drivers");
  expect(screen.queryByTestId("racing-garage")).toBeNull();
  expect(screen.queryByTestId("racing-teams")).toBeNull();
  // Eine einzige Saison braucht keinen Umschalter.
  expect(screen.queryByRole("navigation", { name: "Saisons und Ligen" })).toBeNull();
});

test("Umschalter: die andere Saison lädt und bleibt, auch solange noch die alte Antwort da ist", async () => {
  let answer;
  const older = new Promise((resolve) => { answer = resolve; });
  apiMock.get.mockImplementation((url) => (url.endsWith("/2025-f1") ? older : Promise.resolve({ data: BODY })));
  render(
    <MemoryRouter initialEntries={["/references/series/probe-racing/2026-f1"]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<><ReferenceSeriesPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
  const switcher = await screen.findByRole("navigation", { name: "Saisons und Ligen" });
  fireEvent.click(within(switcher).getByRole("link", { name: /^2025/ }));
  expect(apiMock.get).toHaveBeenLastCalledWith("/reference-series/public/probe-racing/2025-f1");
  // Die Antwort der alten Saison darf nicht zurück zur alten Adresse führen.
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  expect(screen.getByTestId("where")).toHaveTextContent("/references/series/probe-racing/2025-f1");
  answer({ data: { ...BODY, series: { ...BODY.series, season: "2025", season_slug: "2025-f1", status: "completed" }, standings: null } });
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("2025 · F1");
  expect(screen.getByTestId("where")).toHaveTextContent("/references/series/probe-racing/2025-f1");
});

test("noch ohne Ergebnis: Hinweis statt Tabellen", async () => {
  renderAt("/references/series/probe-racing/2026-f1", {
    ...BODY, standings: null, racing: { ...BODY.racing, teams: null, drivers: {}, club_teams: [] },
  });
  const section = await screen.findByTestId("racing-drivers");
  expect(within(section).getByTestId("series-no-table")).toHaveTextContent("Noch keine Ergebnisse");
  expect(screen.queryByTestId("racing-garage")).toBeNull();
});
