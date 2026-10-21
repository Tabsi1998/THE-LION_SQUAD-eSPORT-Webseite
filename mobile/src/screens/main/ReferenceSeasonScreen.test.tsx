import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ReferenceSeasonScreen } from "./ReferenceSeasonScreen";

// Saison einer Serie in der App (#1945, freigegebener Entwurf „AppSaison“, nur lesen): Rennliga mit Kalender, Tabelle und
// Fahrern, Team-Liga mit Spieltagen und Tabelle. Land als Text, solange die App keine Flaggen hat (#1925). Was fehlt,
// öffnet „Im Web öffnen“. Ein alter Server oder eine unbekannte Saison: Hinweis statt Absturz. Erfundene Namen.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const nav = { navigate: jest.fn(), push: jest.fn(), setOptions: jest.fn() };
const navigation = nav as never;
const routeFor = (lineage?: string, season?: string) => ({ key: "season", name: "ReferenceSeason", params: { lineage, season } }) as never;

const res = (round_id: string, place: number | null, points: number, marks: string[] = []) => ({ round_id, place, points, marks });
const rows = [
  { key: "ext1", rank: 1, points: 268, name: "Fremd Eins", club_member: false, results: [res("r9", 1, 25)] },
  { key: "mira", rank: 4, points: 214, name: "Mira Stahl", club_member: true, results: [res("r9", 2, 18, ["pole"])] },
  ...Array.from({ length: 10 }, (_, index) => ({ key: `f${index}`, rank: 5 + index, points: 100 - index, name: `Fremd ${index}`, club_member: false, results: [] })),
  { key: "kai", rank: 15, points: 40, name: "Kai Funke", club_member: true, results: [res("r9", 6, 8)] },
];
const RACING = {
  lineage: { title: "Probe Racing League", slug: "prl", kind: "racing", game_name: "F1 26" },
  series: { season: "2026", title: "PRL 35 · Season 2026", season_slug: "2026" },
  progress: { total: 24, scored: 11 },
  rounds: [
    { id: "r9", code: "R9", venue: "Barcelona", club_day: "2026-04-30", time: "20:00", state: "scored", kind: "regular", country_code: "es" },
    { id: "r12", code: "R12", venue: "Zandvoort", club_day: "2026-10-21", time: "20:00", state: "today", kind: "regular" },
  ],
  standings: { rows },
  racing: {
    club_drivers: ["mira", "kai"], club_teams: ["TLS-Lions"],
    drivers: { mira: { team: "TLS-DarkFriday" }, kai: { team: "TLS-Lions" } },
    teams: { rows: [{ team: "Team Nord", rank: 1, points: 400 }, { team: "TLS-Lions", rank: 2, points: 390 }] },
  },
  team_league: null,
};

// Flaggen (#1925) lädt die App von der Website - hier eine kleine Probe-Flagge.
const fetchMock = jest.fn(async () => ({ ok: true, text: async () => "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 3 2\"><path fill=\"#c60b1e\" d=\"M0 0h3v2H0z\"/></svg>" }));

beforeEach(() => {
  jest.clearAllMocks();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

test("Rennliga: Kopf mit Kennzahlen, Kalender mit Flagge und bestem Vereinsfahrer", async () => {
  mockGet.mockResolvedValue({ data: RACING });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByText("PRL 35 · Season 2026")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/reference-series/public/prl/2026");
  expect(screen.getByText("Rennliga · F1 26")).toBeTruthy();
  expect(within(screen.getByTestId("season-figures")).getByText("11/24")).toBeTruthy();
  expect(within(screen.getByTestId("season-figures")).getByText("Bester Fahrer")).toBeTruthy();
  expect(within(screen.getByTestId("season-figures")).getByText("Bestes Team")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Kalender" }).props.accessibilityState).toEqual({ selected: true });

  const r9 = screen.getByTestId("season-round-r9");
  expect(within(r9).getByText("Barcelona")).toBeTruthy();
  await waitFor(() => expect(within(r9).getByTestId("country-flag-svg")).toBeTruthy());
  expect(within(r9).getByLabelText("Spanien")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/assets\/flags\/es\.svg$/));
  expect(within(r9).getByText("Gewertet")).toBeTruthy();
  expect(within(r9).getByText("Bester Vereinsfahrer: Mira Stahl · P2")).toBeTruthy();
  const r12 = screen.getByTestId("season-round-r12");
  expect(within(r12).getByText("Heute · 20:00")).toBeTruthy();
  // Ohne Land kein Platzhalter.
  expect(within(r12).queryByTestId("season-round-country")).toBeNull();
});

test("Tabelle: die ersten zehn und Vereinsfahrer dahinter, aufklappbar - Teamwertung umschaltbar", async () => {
  mockGet.mockResolvedValue({ data: RACING });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Tabelle" })).toBeTruthy());
  await fireEvent.press(screen.getByRole("tab", { name: "Tabelle" }));
  expect(screen.getByTestId("season-table-mira").props.accessibilityLabel).toContain("Verein");
  expect(screen.getByTestId("season-table-kai")).toBeTruthy();
  expect(screen.queryByTestId("season-table-f9")).toBeNull();
  await fireEvent.press(screen.getByTestId("season-table-all"));
  expect(screen.getByTestId("season-table-f9")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("season-table-scope-teams"));
  expect(screen.getByTestId("season-table-TLS-Lions")).toBeTruthy();
  expect(screen.queryByTestId("season-table-mira")).toBeNull();
});

test("Fahrer: nur öffentliche Vereinsfahrer mit Platz, Team und Saison", async () => {
  mockGet.mockResolvedValue({ data: RACING });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Fahrer" })).toBeTruthy());
  await fireEvent.press(screen.getByRole("tab", { name: "Fahrer" }));
  const mira = screen.getByTestId("season-driver-mira");
  expect(within(mira).getByText("P4")).toBeTruthy();
  expect(within(mira).getByText("TLS-DarkFriday · 214 Punkte")).toBeTruthy();
  expect(within(mira).getByText("1 Rennen · 1 Podium · 1 Pole")).toBeTruthy();
  expect(screen.queryByTestId("season-driver-ext1")).toBeNull();
});

test("Team-Liga: Spieltage mit Ergebnis aus eigener Sicht und Tabelle", async () => {
  mockGet.mockResolvedValue({ data: {
    lineage: { title: "Probe Liga", slug: "pl", kind: "team_league", game_name: "Black Ops 7" },
    series: { season: "S3", tier: "Newcomer I", season_slug: "s3" },
    rounds: [],
    team_league: {
      matchdays: [
        { round: { id: "a", code: "ST1", club_day: "2026-10-01", time: "20:00", state: "scored" }, match: { opponent: "Fremd Adler", home: true, outcome: "win", score_for: 3, score_against: 1, points: 3, maps: [] } },
        { round: { id: "b", code: "ST2", club_day: "2026-10-08", time: "20:00", state: "planned", opponent: "Fremd Bären" }, match: null },
      ],
      table: { rows: [{ key: "Fremd Adler", team: "Fremd Adler", rank: 1, points: 6, played: 2, own: false }, { key: "Lions Probe", team: "Lions Probe", rank: 2, points: 3, played: 1, own: true }] },
    },
  } });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("pl", "s3")} />);
  await waitFor(() => expect(screen.getByText("Probe Liga S3 · Newcomer I")).toBeTruthy());
  expect(screen.getByText("Team-Liga · Black Ops 7")).toBeTruthy();
  const first = screen.getByTestId("season-matchday-a");
  expect(within(first).getByText("gegen Fremd Adler · Heim")).toBeTruthy();
  expect(within(first).getByText("3:1")).toBeTruthy();
  expect(within(screen.getByTestId("season-matchday-b")).getByText("Geplant")).toBeTruthy();
  await fireEvent.press(screen.getByRole("tab", { name: "Tabelle" }));
  expect(screen.getByTestId("season-league-Lions Probe").props.accessibilityLabel).toContain("unser Team");
});

// ---------------------------------------------------------------- #1974: Runde mit Läufen, Sonderregeln, Statistik

const lauf = (id: string, session: string, kind: string, weekend: number, extra: Record<string, unknown> = {}) => ({
  id, code: `R${weekend}`, session, session_kind: kind, weekend, club_day: "2026-10-08", state: "scored", kind: "regular", counts: kind !== "qualifying", ...extra,
});
const WEEKEND = {
  ...RACING,
  series: { ...RACING.series, status: "cancelled", cancelled_on: "2026-11-20", cancel_reason: "Neustart mit anderem Auto" },
  successor: { season: "2027", title: "PRL 36 · Season 2027", season_slug: "2027", lineage_slug: "prl", lineage_title: "Probe Racing League" },
  rule_changes: [{ kind: "format", from_round: 5, to_round: null, day: "2026-11-12", note: null, sessions: ["Sprint", "Hauptrennen"] }],
  rounds: [
    lauf("q3", "Qualifying", "qualifying", 3, { venue: "Baku", country_code: "az", time: "19:30" }),
    lauf("s3", "Sprint", "sprint", 3, { time: "19:50" }),
    lauf("r3", "Rennen", "race", 3, { time: "20:30" }),
  ],
  standings: { rows: [
    { key: "ext1", rank: 1, points: 33, name: "Fremd Eins", club_member: false, results: [res("s3", 1, 8), res("r3", 1, 25)] },
    { key: "mira", rank: 2, points: 20, name: "Mira Stahl", club_member: true, results: [res("s3", 2, 7), res("r3", 2, 18)],
      adjustment_points: -5, adjustments: [{ points: -5, reason: "Nichtteilnahme nach Anmeldung", day: "2026-11-02", round_id: null }] },
  ] },
};

test("Kalender je Runde (#1930): Lauf-Chips mit Uhrzeit, die Runde und ein Chip öffnen das Ergebnis", async () => {
  mockGet.mockResolvedValue({ data: WEEKEND });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByTestId("season-round-q3")).toBeTruthy());
  // Eine Zeile je Runde, nicht je Lauf.
  expect(screen.queryByTestId("season-round-s3")).toBeNull();
  const chips = screen.getByTestId("season-round-sessions-q3");
  expect(within(chips).getByText("Quali")).toBeTruthy();
  expect(within(chips).getByText("19:30")).toBeTruthy();
  expect(within(chips).getByText("Sprint")).toBeTruthy();
  expect(within(screen.getByTestId("season-round-q3")).getByText("Bester Vereinsfahrer · Sprint: Mira Stahl · P2")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("session-chip-s3"));
  expect(nav.navigate).toHaveBeenCalledWith("ReferenceRound", { lineage: "prl", season: "2026", round: 3, session: "sprint" });
  await fireEvent.press(screen.getByTestId("season-round-q3"));
  expect(nav.navigate).toHaveBeenCalledWith("ReferenceRound", { lineage: "prl", season: "2026", round: 3 });
});

test("Sonderregeln (#1960): Saison abgebrochen mit Nachfolger, Regeländerung, „−5“ mit Grund", async () => {
  mockGet.mockResolvedValue({ data: WEEKEND });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByTestId("series-season-notice")).toBeTruthy());
  expect(screen.getByText("Saison abgebrochen am 20.11.2026 – Neustart mit anderem Auto. Die gefahrenen Ergebnisse bleiben stehen – ohne Meister.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("series-successor"));
  expect(nav.push).toHaveBeenCalledWith("ReferenceSeason", { lineage: "prl", season: "2027" });

  await fireEvent.press(screen.getByRole("tab", { name: "Tabelle" }));
  expect(within(screen.getByTestId("series-rule-changes")).getByText("Ab R5 · 12.11.2026")).toBeTruthy();
  expect(within(screen.getByTestId("series-rule-changes")).getByText("Ablauf: Sprint + Hauptrennen")).toBeTruthy();
  const mira = screen.getByTestId("season-table-mira");
  expect(within(mira).getByText("−5").props.accessibilityLabel).toBe("Anpassung −5 · Nichtteilnahme nach Anmeldung · 02.11.2026");
  expect(within(screen.getByTestId("series-adjustments")).getByText("Mira Stahl · Nichtteilnahme nach Anmeldung · 02.11.2026")).toBeTruthy();

  // Wertung je Lauf (#1930): Sprint-Tabelle ohne Anpassungen.
  await fireEvent.press(screen.getByTestId("season-table-kind-sprint"));
  expect(within(screen.getByTestId("season-table-mira")).getByText("7")).toBeTruthy();
  expect(within(screen.getByTestId("season-table-mira")).queryByText("−5")).toBeNull();
  expect(screen.queryByTestId("series-adjustments")).toBeNull();
});

test("Statistik (#1950): lädt beim Öffnen, sortiert nach der gewählten Kennzahl, Vereinsfahrer hervorgehoben", async () => {
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith("/statistics") ? {
    drivers: [
      { key: "ext1", name: "Fremd Eins", club_member: false, wins: 2, podiums: 2, avg_grid: 1.5 },
      { key: "mira", name: "Mira Stahl", club_member: true, wins: 0, podiums: 2, avg_grid: 4.5 },
    ],
    teams: [],
    metrics: { drivers: ["wins", "podiums", "avg_grid"], teams: [] },
  } : WEEKEND }));
  await render(<ReferenceSeasonScreen navigation={navigation} route={{ key: "s", name: "ReferenceSeason", params: { lineage: "prl", season: "2026", view: "statistik" } } as never} />);
  await waitFor(() => expect(screen.getByTestId("season-statistics")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/reference-series/public/prl/2026/statistics");
  expect(screen.getByRole("tab", { name: "Statistik" }).props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId("season-statistics-row-ext1").props.accessibilityLabel).toContain("Platz 1");
  expect(screen.getByTestId("season-statistics-row-mira").props.accessibilityLabel).toContain("Verein");
  await fireEvent.press(screen.getByTestId("season-statistics-card-podiums"));
  expect(screen.getByTestId("season-statistics-row-mira").props.accessibilityLabel).toContain("Platz 1");
  await fireEvent.press(screen.getByTestId("season-statistics-card-avg_grid"));
  expect(screen.getByTestId("season-statistics-row-ext1").props.accessibilityLabel).toContain("Ø Start 1,5");
});

test("Statistik auf einem älteren Server: Hinweis statt Absturz", async () => {
  mockGet.mockImplementation((path: string) => (path.endsWith("/statistics") ? Promise.reject(new Error("404")) : Promise.resolve({ data: RACING })));
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Statistik" })).toBeTruthy());
  await fireEvent.press(screen.getByRole("tab", { name: "Statistik" }));
  await waitFor(() => expect(screen.getByText("Die Statistik lässt sich gerade nicht laden.")).toBeTruthy());
});

test("Team-Liga (#1931, #1616): Veto-Karten mit Bild, weitere Spiele, Kader mit Einsätzen, Maps mit Statistik und Pool", async () => {
  const IMG = "/api/static/uploads/hafenkante.webp";
  mockGet.mockResolvedValue({ data: {
    lineage: { title: "Probe Liga", slug: "pl", kind: "team_league", game_name: "Black Ops 7" },
    series: { season: "S3", season_slug: "s3" },
    rounds: [{ id: "a", code: "ST1" }],
    team_league: {
      own_teams: ["Lions Probe"],
      matchdays: [{
        round: { id: "a", code: "ST1", club_day: "2026-10-01", time: "20:00", state: "scored" },
        match: { opponent: "Fremd Adler", home: false, outcome: "win", score_for: 2, score_against: 1, points: 3, veto: [
          { name: "Nebelwerk", role: "banned", by: "opponent", played: false, image_url: IMG },
          { name: "Hafenkante", role: "picked", by: "own", picked: "own", played: true, score_for: 6, score_against: 3, outcome: "win", image_url: IMG },
          { name: "Glutsenke", role: "decider", picked: "decider", played: false },
        ] },
        others: [{ home: "Fremd Bären", away: "Fremd Wölfe", home_score: 2, away_score: 0 }],
      }],
      table: { rows: [{ key: "Lions Probe", team: "Lions Probe", rank: 1, points: 3, played: 1, own: true }] },
      lineup: { round_ids: ["a"], players: [{ key: "p1", name: "Mira Stahl", club_member: true, guest: false, round_ids: ["a"], appearances: 1, of: 1, all_seasons: 9 }] },
      map_stats: [{ name: "Hafenkante", image_url: IMG, map_id: "hafen", played: 1, won: 1, picked_own: 1 }],
    },
    map_pool: { modes: [{ mode: null, label: "Alle Maps", maps: [{ map_id: "hafen", name: "Hafenkante", image_url: IMG }] }] },
  } });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("pl", "s3")} />);
  await waitFor(() => expect(screen.getByTestId("season-matchday-a")).toBeTruthy());
  const day = screen.getByTestId("season-matchday-a");
  expect(within(day).getByText("gegen Fremd Adler · Auswärts")).toBeTruthy();
  expect(within(day).getByLabelText("Sieg 2:1, 3 Punkte")).toBeTruthy();
  const veto = within(day).getByTestId("season-veto");
  expect(within(veto).getByLabelText("Bann · Gegner, Nebelwerk")).toBeTruthy();
  expect(within(veto).getByLabelText("Unsere Wahl, Hafenkante, 6:3, gewonnen")).toBeTruthy();
  expect(within(veto).getByLabelText("Decider, Glutsenke, nicht gespielt")).toBeTruthy();
  expect(within(day).queryByText("Fremd Wölfe")).toBeNull();
  await fireEvent.press(within(day).getByTestId("season-matchday-others-a"));
  expect(within(day).getByLabelText("Fremd Bären 2:0 Fremd Wölfe")).toBeTruthy();

  await fireEvent.press(screen.getByRole("tab", { name: "Kader" }));
  expect(screen.getByTestId("season-squad-p1").props.accessibilityLabel).toBe("Mira Stahl, Verein, Einsätze 1 von 1, 9 über alle Saisons");
  await fireEvent.press(screen.getByRole("tab", { name: "Maps" }));
  expect(screen.getByTestId("season-map-stat-hafen").props.accessibilityLabel).toBe("Hafenkante, Gespielt 1, Siege 1, Unsere Wahl 1");
  expect(within(screen.getByTestId("season-map-pool")).getByLabelText("Hafenkante")).toBeTruthy();
});

test("„Im Web öffnen“ führt zur Serienseite im Web", async () => {
  mockGet.mockResolvedValue({ data: RACING });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByTestId("season-open-web")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("season-open-web"));
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/references\/series\/prl\/2026$/));
  open.mockRestore();
});

test("unbekannte Saison oder alter Server: Hinweis mit Weg ins Web, kein Absturz", async () => {
  mockGet.mockRejectedValue(Object.assign(new Error("404"), { isAxiosError: true, response: { status: 404, data: {} } }));
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "weg")} />);
  await waitFor(() => expect(screen.getByText("Saison nicht gefunden")).toBeTruthy());
  expect(screen.getByTestId("season-open-web")).toBeTruthy();

  // Ohne Adresse (Fehlbedienung) fragt der Screen gar nicht erst.
  mockGet.mockClear();
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor(undefined, undefined)} />);
  await waitFor(() => expect(screen.getByText("Saison nicht gefunden")).toBeTruthy());
  expect(mockGet).not.toHaveBeenCalled();

  // Eine Antwort ohne die erwarteten Teile (alter Server): leere Abschnitte, kein Absturz.
  mockGet.mockResolvedValue({ data: [] });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByText("Noch keine Termine.")).toBeTruthy());
});
