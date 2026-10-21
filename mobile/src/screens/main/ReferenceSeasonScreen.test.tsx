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

const navigation = { navigate: jest.fn(), setOptions: jest.fn() } as never;
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
