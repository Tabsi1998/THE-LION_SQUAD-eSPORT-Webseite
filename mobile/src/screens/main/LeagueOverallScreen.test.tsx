import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LeagueOverallScreen } from "./LeagueOverallScreen";

// Gesamtwertung in der App (F.5, #2215; App: #2173): je Liga N Co-Teams und Spieler, Punkte je Season zum Aufklappen, Streichergebnis,
// Gesamtsieger nur bei Endstand mit ganzer Sicht. Erfundene Namen.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("../../seasons/anchors", () => ({ useSeasonOverlay: () => null, SeasonPerch: () => null, SeasonAnchor: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigate = jest.fn();
const navigation = { navigate, setOptions: jest.fn() } as never;
const route = (params: Record<string, unknown> = {}) => ({ key: "overall", name: "LeagueOverall", params: { league: "cod", season: "season-2", ...params } }) as never;

const cells = (first: Record<string, unknown>, second: Record<string, unknown>) => [{ season_id: "s1", ...first }, { season_id: "s2", ...second }];
const VIEW = (level1: Record<string, unknown> = {}) => ({
  period: { id: "p1", name: "2027" },
  seasons: [{ id: "s1", name: "Season 1" }, { id: "s2", name: "Season 2" }],
  levels: [
    {
      level: 1, label: "Liga 1", closed: true, complete: true, final: { version: 1, closed_at: "2027-03-01T19:00:00Z" }, season_ids: ["s1", "s2"],
      settings: { points_mode: "teams", champion_bonus: 2, counting: "best", best_count: 1 },
      teams: [
        { key: "squad:a", name: "Löwen", team_id: "team-a", place: 1, total: 10, climbed: false,
          seasons: cells({ played: true, points: 10, place: 1, of: 8, champion: true, counted: true }, { played: true, points: 4, place: 5, of: 8, counted: false }) },
        { key: "squad:b", name: "Falken", team_id: null, place: 2, total: 7, climbed: true,
          seasons: cells({ played: false }, { played: true, points: 7, place: 2, of: 8, counted: true }) },
      ],
      players: [
        { key: "u1", name: "NeonFalke", username: "neonfalke", place: 1, total: 10, seasons: cells({ played: true, points: 10, place: 1, of: 8, counted: true }, { played: false }) },
        { key: null, name: "Spieler mit privatem Profil", username: null, private: true, place: 2, total: 7, seasons: cells({ played: false }, { played: true, points: 7, place: 2, of: 8, counted: true }) },
      ],
      ...level1,
    },
    { level: 2, label: "Liga 2", closed: false, complete: false, season_ids: ["s1", "s2"], teams: [], players: [] },
  ],
});

beforeEach(() => jest.clearAllMocks());

test("Endstand mit ganzer Sicht: Gesamtsieger, Plätze, Summen und je Season aufklappbar mit Streichergebnis", async () => {
  mockGet.mockResolvedValue({ data: VIEW() });
  await render(<LeagueOverallScreen navigation={navigation} route={route()} />);
  await waitFor(() => expect(screen.getByTestId("overall-period")).toHaveTextContent("2027"));
  expect(mockGet).toHaveBeenCalledWith("/leagues/cod/season-2/overall");
  expect(screen.getByTestId("overall-1-winner")).toHaveTextContent(/Gesamtsieger.*Löwen/);
  expect(screen.getByTestId("overall-1-state")).toHaveTextContent("Endstand seit 01.03.2027");
  expect(screen.getByTestId("overall-1-rules")).toHaveTextContent(/Es zählen die besten 1 Seasons\./);
  expect(screen.getByTestId("overall-row-1-up")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("overall-row-0-toggle"));
  expect(screen.getByTestId("overall-row-0-cell-s1").props.accessibilityLabel).toBe("Season 1: 10 Punkte · Platz 1 von 8 · Staffelsieg");
  expect(screen.getByTestId("overall-row-0-cell-s2").props.accessibilityLabel).toBe("Season 2: 4 Punkte · Platz 5 von 8 · Streichergebnis");
  expect(screen.getByTestId("overall-row-0-cell-s2")).toHaveTextContent(/Streichergebnis/);
  await fireEvent.press(screen.getByTestId("overall-row-0-open"));
  expect(navigate).toHaveBeenCalledWith("TeamDetail", { id: "team-a" });
  // Ohne Team kein Weg dorthin.
  await fireEvent.press(screen.getByTestId("overall-row-1-toggle"));
  expect(screen.queryByTestId("overall-row-1-open")).toBeNull();
});

test("Spieler: öffentliche mit Weg zum Profil, private ohne Namen und ohne Link", async () => {
  mockGet.mockResolvedValue({ data: VIEW() });
  await render(<LeagueOverallScreen navigation={navigation} route={route()} />);
  await waitFor(() => expect(screen.getByText("Spieler")).toBeTruthy());
  await fireEvent.press(screen.getByText("Spieler"));
  expect(screen.getByText("Spieler mit privatem Profil")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("overall-row-0-toggle"));
  await fireEvent.press(screen.getByTestId("overall-row-0-open"));
  expect(navigate).toHaveBeenCalledWith("PublicProfile", { username: "neonfalke" });
  await fireEvent.press(screen.getByTestId("overall-row-1-toggle"));
  expect(screen.queryByTestId("overall-row-1-open")).toBeNull();
});

test("kein Gesamtsieger, wenn eine Season der Fassung nicht sichtbar ist (complete false) oder die Wertung läuft", async () => {
  mockGet.mockResolvedValue({ data: VIEW({ complete: false }) });
  await render(<LeagueOverallScreen navigation={navigation} route={route()} />);
  await waitFor(() => expect(screen.getByTestId("overall-1-state")).toHaveTextContent("Endstand ohne nicht öffentliche Seasons · abgeschlossen am 01.03.2027"));
  expect(screen.queryByTestId("overall-1-winner")).toBeNull();
  await fireEvent.press(screen.getByText("Liga 2"));
  expect(screen.getByTestId("overall-2-state")).toHaveTextContent(/^Laufende Wertung/);
  expect(screen.queryByTestId("overall-2-winner")).toBeNull();
  expect(screen.getByText("Noch niemand in der Wertung.")).toBeTruthy();
});

test("ohne Gesamtwertung (404) ein klarer Satz statt einer leeren Seite", async () => {
  mockGet.mockRejectedValue(Object.assign(new Error("404"), { isAxiosError: true, response: { status: 404, data: { detail: "Nicht gefunden" } } }));
  await render(<LeagueOverallScreen navigation={navigation} route={route()} />);
  await waitFor(() => expect(screen.getByTestId("overall-missing")).toBeTruthy());
  expect(screen.getByText("Für diese Season gibt es keine Gesamtwertung.")).toBeTruthy();
});
