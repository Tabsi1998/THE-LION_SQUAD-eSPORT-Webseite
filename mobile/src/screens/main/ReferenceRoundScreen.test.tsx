import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ReferenceRoundScreen } from "./ReferenceRoundScreen";

// Ergebnis einer Runde in der App (#1950, #1974): Kopf mit Land, Zusammenfassung ohne fremde Namen, Reiter je Lauf,
// Ergebnisliste wie beim Veranstalter mit hochzählenden Zeiten (mit „Bewegung reduzieren“ sofort), Sonderregeln am Lauf
// (#1960) und ein alter Server ohne Rundenseite. Erfundene Namen.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reanimated = require("react-native-reanimated");

const navigation = { navigate: jest.fn(), replace: jest.fn(), setOptions: jest.fn() };
const routeFor = (params: Record<string, unknown>) => ({ key: "round", name: "ReferenceRound", params }) as never;

const row = (key: string, place: number | null, extra: Record<string, unknown> = {}) => ({
  key, place, status: "finished", name: `Fahrer ${key}`, name_hidden: false, club_member: false, own: false, team: null, team_color: null,
  marks: [], fastest_lap: false, driver_of_the_day: false, points: null, time: null, gap: null, ...extra,
});

const PAGE = {
  lineage: { title: "Probe Racing League", slug: "prl", kind: "racing" },
  series: { season: "2026", season_slug: "2026", status: "active" },
  own_teams: ["Löwen Racing"],
  round: { number: 3, total: 24, code: "R3", venue: "Baku City Circuit", country_code: "AZ", club_day: "2026-10-08", kind: "regular" },
  previous: { number: 2, code: "R2", country_code: "SG" },
  next: { number: 4, code: "R4", venue: "Monza" },
  main: "rennen",
  club_drivers: ["mira"],
  summary: { winner: { key: "ext", session: "rennen", grid: 2 }, pole: { key: "ext", time: "1:41.233", session: "qualifying" }, fastest_lap: { key: "mira", session: "rennen", time: "1:44.002" } },
  sessions: [
    { id: "q", key: "qualifying", label: "Qualifying", kind: "qualifying", state: "scored", time: "19:30", has_result: true, columns: ["time", "gap"],
      rows: [row("ext", 1, { time: "1:41.233", team: "Team Nord", team_color: "#00d2be" }), row("mira", 2, { gap: "+0.261", own: true, club_member: true, team: "Löwen Racing" })] },
    { id: "s", key: "sprint", label: "Sprint", kind: "sprint", state: "scored", time: "19:50", has_result: true, columns: ["grid", "time", "gap", "points"], grid_source: "reverse_qualifying", reverse_top: 8,
      rows: [row("mira", 1, { time: "15:02.100", grid: 1, points: 8, own: true, club_member: true, team: "Löwen Racing" })] },
    { id: "r", key: "rennen", label: "Rennen", kind: "race", state: "scored", time: "20:30", has_result: true, columns: ["start_number", "grid", "time", "gap", "points"], best_club: "mira",
      rows: [
        row("ext", 1, { time: "31:55.056", grid: 2, points: 25, team: "Team Nord", team_color: "#00d2be", start_number: "44", marks: ["pole"] }),
        row("mira", 2, { gap: "+6.197", grid: 5, points: 18, own: true, club_member: true, team: "Löwen Racing", start_number: "7", fastest_lap: true, penalty_seconds: 5 }),
        row("hid", 3, { name: null, name_hidden: true, gap: "+1 Runde", points: 15 }),
        row("out", null, { status: "dnf", points: 0 }),
      ] },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

test("Kopf, Zusammenfassung ohne fremde Namen und das Hauptrennen mit hochzählenden Zeiten", async () => {
  mockGet.mockResolvedValue({ data: PAGE });
  await render(<ReferenceRoundScreen navigation={navigation as never} route={routeFor({ lineage: "prl", season: "2026", round: 3 })} />);
  await waitFor(() => expect(screen.getByText("Aserbaidschan")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/reference-series/public/prl/2026/rounds/3");
  expect(screen.getByTestId("round-eyebrow").props.children).toBe("Runde 3 von 24");
  expect(screen.getByTestId("round-subline").props.children).toBe("R3 · Do., 08.10.2026 · Baku City Circuit");

  // Ein fremder Sieger steht nur mit seinem Team da, ein öffentlicher Vereinsfahrer mit Namen.
  const winner = screen.getByTestId("round-fact-winner");
  expect(within(winner).getByText("Team Nord")).toBeTruthy();
  expect(within(winner).queryByText("Fahrer ext")).toBeNull();
  expect(within(screen.getByTestId("round-fact-fastest_lap")).getByText("Fahrer mira")).toBeTruthy();
  expect(within(screen.getByTestId("round-fact-best_club")).getByText("Fahrer mira · P2")).toBeTruthy();

  // Ohne „Bewegung reduzieren“ zählt die Zeit von null hoch - Vorleser hören den Endwert.
  expect(screen.getByRole("tab", { name: "Rennen, 20:30" }).props.accessibilityState).toEqual({ selected: true });
  const time = screen.getByLabelText("31:55,056");
  expect(within(time).getByDisplayValue("00:00,000", { includeHiddenElements: true })).toBeTruthy();
  const mira = screen.getByTestId("round-row-mira");
  expect(mira.props.accessibilityLabel).toContain("Verein");
  expect(within(mira).getByText("Beste Runde")).toBeTruthy();
  expect(within(mira).getByText("+5 s Strafe")).toBeTruthy();
  expect(within(mira).getByText("18 P")).toBeTruthy();
  expect(within(screen.getByTestId("round-row-ext")).getByText("Pole")).toBeTruthy();
  // Ausgeblendeter Name als Hinweis; Wörter zählen nicht hoch; Ausfall mit DNF.
  const hidden = screen.getByTestId("round-row-hid");
  expect(within(hidden).getByText("Name ausgeblendet")).toBeTruthy();
  expect(within(hidden).getByText("+1 Runde")).toBeTruthy();
  expect(within(screen.getByTestId("round-row-out")).getByText("Ausfall")).toBeTruthy();
  expect(screen.getByTestId("round-own-teams").props.children).toBe("Vereinsteams hervorgehoben: Löwen Racing");
});

test("„Bewegung reduzieren“: alle Zeiten stehen sofort da", async () => {
  jest.spyOn(reanimated, "useReducedMotion").mockReturnValue(true);
  mockGet.mockResolvedValue({ data: PAGE });
  await render(<ReferenceRoundScreen navigation={navigation as never} route={routeFor({ lineage: "prl", season: "2026", round: 3 })} />);
  await waitFor(() => expect(screen.getByText("31:55,056")).toBeTruthy());
  expect(screen.getByText("+6,197")).toBeTruthy();
  expect(within(screen.getByTestId("round-fact-pole")).getByText("1:41,233")).toBeTruthy();
  expect(screen.queryByDisplayValue("00:00,000", { includeHiddenElements: true })).toBeNull();
});

test("Reiter je Lauf: Lauf aus der Adresse, umgekehrte Startaufstellung als Hinweis, Wechsel per Tippen", async () => {
  jest.spyOn(reanimated, "useReducedMotion").mockReturnValue(true);
  mockGet.mockResolvedValue({ data: PAGE });
  await render(<ReferenceRoundScreen navigation={navigation as never} route={routeFor({ lineage: "prl", season: "2026", round: 3, session: "sprint" })} />);
  await waitFor(() => expect(screen.getByTestId("round-results-sprint")).toBeTruthy());
  expect(screen.getByTestId("round-session-grid").props.children).toBe("Start in umgekehrter Quali-Reihenfolge (Top 8)");
  // Vorn steht hier Startplatz 1, keine Pole.
  expect(within(screen.getByTestId("round-results-sprint")).queryByText("Pole")).toBeNull();

  await fireEvent.press(screen.getByTestId("round-tab-qualifying"));
  expect(screen.getByTestId("round-results-qualifying")).toBeTruthy();
  expect(within(screen.getByTestId("round-results-qualifying")).getByText("1:41,233")).toBeTruthy();
  expect(screen.queryByTestId("round-session-grid")).toBeNull();
});

test("Pfeile führen zur vorigen und nächsten Runde, „Im Web öffnen“ zur Runde mit Lauf", async () => {
  mockGet.mockResolvedValue({ data: PAGE });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<ReferenceRoundScreen navigation={navigation as never} route={routeFor({ lineage: "prl", season: "2026", round: 3, session: "sprint" })} />);
  await waitFor(() => expect(screen.getByTestId("round-prev")).toBeTruthy());
  expect(screen.getByTestId("round-prev").props.accessibilityLabel).toBe("Vorige Runde: R2 Singapur");
  await fireEvent.press(screen.getByTestId("round-next"));
  expect(navigation.replace).toHaveBeenCalledWith("ReferenceRound", { lineage: "prl", season: "2026", round: 4 });
  await fireEvent.press(screen.getByTestId("round-open-web"));
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/references\/series\/prl\/2026\/runde\/3\?lauf=sprint$/));
});

test("Saison abgebrochen (#1960): Hinweis über der Zusammenfassung", async () => {
  mockGet.mockResolvedValue({ data: { ...PAGE, series: { ...PAGE.series, status: "cancelled", cancelled_on: "2026-11-20", cancel_reason: "Neustart mit anderem Auto" } } });
  await render(<ReferenceRoundScreen navigation={navigation as never} route={routeFor({ lineage: "prl", season: "2026", round: 3 })} />);
  await waitFor(() => expect(screen.getByTestId("series-season-notice")).toBeTruthy());
  expect(screen.getByText("Saison abgebrochen am 20.11.2026 – Neustart mit anderem Auto. Die gefahrenen Ergebnisse bleiben stehen – ohne Meister.")).toBeTruthy();
});

test("alter Server ohne Rundenseite oder ohne Felder: Hinweis bzw. leerer Lauf, kein Absturz", async () => {
  mockGet.mockRejectedValue(Object.assign(new Error("404"), { isAxiosError: true, response: { status: 404, data: {} } }));
  const first = await render(<ReferenceRoundScreen navigation={navigation as never} route={routeFor({ lineage: "prl", season: "2026", round: 3 })} />);
  await waitFor(() => expect(screen.getByText("Runde nicht gefunden")).toBeTruthy());
  expect(screen.getByTestId("round-open-web")).toBeTruthy();
  await first.unmount();

  mockGet.mockResolvedValue({ data: {} });
  await render(<ReferenceRoundScreen navigation={navigation as never} route={routeFor({ lineage: "prl", season: "2026", round: 3 })} />);
  await waitFor(() => expect(screen.getByText("Für diese Runde gibt es noch keine Läufe.")).toBeTruthy());
  expect(screen.getByRole("header", { name: "Runde 3" })).toBeTruthy();
  expect(screen.queryByTestId("round-summary")).toBeNull();
  expect(screen.queryByTestId("round-tabs")).toBeNull();
});
