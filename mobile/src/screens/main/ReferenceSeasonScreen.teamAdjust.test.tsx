import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ReferenceSeasonScreen } from "./ReferenceSeasonScreen";

// Fahrer-Anpassung zählt fürs Team (#2000) in der App, wie im Web: in der Teamwertung „−5 (Fahrer)“ unter der Teamsumme
// und in der Liste der Anpassungen, im Fahrer-Detail „zählt auch fürs Team“. Namen nur aus der Fahrerwertung (ein
// ausgeblendeter bleibt ausgeblendet). Ein älterer Server schickt die Felder nicht - dann sieht alles aus wie bisher.
// Erfundene Namen.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (url: string) => url,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn(), push: jest.fn(), setOptions: jest.fn() } as never;
const route = { key: "season", name: "ReferenceSeason", params: { lineage: "prl", season: "2026" } } as never;
const minus = { points: -5, reason: "Video fehlt", day: "2026-11-02", round_id: "r9" };

const PAGE = {
  lineage: { title: "Probe Racing League", slug: "prl", kind: "racing" },
  series: { season: "2026", title: "PRL 35 · Season 2026", season_slug: "2026" },
  rounds: [{ id: "r9", code: "R9", venue: "Barcelona", club_day: "2026-10-29", state: "scored", kind: "regular" }],
  standings: { rows: [
    { key: "mira", rank: 1, points: 20, name: "Mira Stahl", club_member: true, results: [], adjustment_points: -5,
      adjustments: [{ ...minus, counts_for_team: true, credited_team: "TLS-Lions" }] },
    { key: "geheim", rank: 2, points: 18, name: null, name_hidden: true, club_member: false, results: [] },
  ] },
  racing: {
    club_drivers: ["mira"], club_teams: ["TLS-Lions"], drivers: { mira: { team: "TLS-Lions" } },
    teams: { rows: [
      { team: "TLS-Lions", rank: 1, points: 33, driver_adjustment_points: -5, driver_adjustments: [{ ...minus, counts_for_team: true, credited_team: "TLS-Lions", driver: "mira" }] },
      { team: "Fremd Rot", rank: 2, points: 30, driver_adjustment_points: 2, driver_adjustments: [{ points: 2, reason: "Korrektur", day: "2026-11-08", round_id: null, counts_for_team: true, credited_team: "Fremd Rot", driver: "geheim" }] },
    ] },
  },
};

beforeEach(() => jest.clearAllMocks());

test("Teamwertung: „−5 (Fahrer)“ unter der Teamsumme, ausgeblendeter Name bleibt ausgeblendet, Liste mit Grund", async () => {
  mockGet.mockResolvedValue({ data: PAGE });
  await render(<ReferenceSeasonScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("PRL 35 · Season 2026")).toBeTruthy());
  await fireEvent.press(screen.getByRole("tab", { name: "Tabelle" }));
  await fireEvent.press(screen.getByTestId("season-table-scope-teams"));

  const lions = screen.getByTestId("season-table-TLS-Lions");
  expect(within(lions).getByText("−5 (Mira Stahl)")).toBeTruthy();
  expect(lions.props.accessibilityLabel).toContain("Anpassung −5 · Video fehlt · R9 · 02.11.2026 – Mira Stahl, zählt auch fürs Team");
  expect(within(screen.getByTestId("season-table-Fremd Rot")).getByText("+2 (Name ausgeblendet)")).toBeTruthy();
  expect(screen.queryByText(/Geheim/)).toBeNull();

  const list = screen.getByTestId("series-adjustments");
  expect(within(list).getByText("TLS-Lions · Mira Stahl (Fahrer) · Video fehlt · R9 · 02.11.2026")).toBeTruthy();
  expect(within(list).getByText("Fremd Rot · Name ausgeblendet (Fahrer) · Korrektur · 08.11.2026")).toBeTruthy();

  // In der Fahrerwertung keine Fahrer-Marken unter den Punkten.
  await fireEvent.press(screen.getByTestId("season-table-scope-drivers"));
  expect(screen.queryByTestId("season-table-driver-adjustment")).toBeNull();
});

test("Fahrer-Detail: „zählt auch fürs Team · TLS-Lions“ unter der Anpassung", async () => {
  mockGet.mockResolvedValue({ data: PAGE });
  await render(<ReferenceSeasonScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("PRL 35 · Season 2026")).toBeTruthy());
  await fireEvent.press(screen.getByRole("tab", { name: "Fahrer" }));
  const adjustments = screen.getByTestId("season-driver-adjustments-mira");
  expect(within(adjustments).getByText("Video fehlt · R9 · 02.11.2026")).toBeTruthy();
  expect(within(adjustments).getByTestId("season-driver-adjustment-team")).toHaveTextContent("zählt auch fürs Team · TLS-Lions");
});

test("älterer Server ohne die neuen Felder: Teamsumme ohne Fahrer-Marken, Fahrer-Detail ohne Team-Zeile", async () => {
  const old = JSON.parse(JSON.stringify(PAGE));
  old.standings.rows[0].adjustments = [minus];
  old.racing.teams.rows = old.racing.teams.rows.map(({ team, rank, points }: { team: string; rank: number; points: number }) => ({ team, rank, points }));
  mockGet.mockResolvedValue({ data: old });
  await render(<ReferenceSeasonScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("PRL 35 · Season 2026")).toBeTruthy());
  await fireEvent.press(screen.getByRole("tab", { name: "Fahrer" }));
  expect(within(screen.getByTestId("season-driver-adjustments-mira")).getByText("Video fehlt · R9 · 02.11.2026")).toBeTruthy();
  expect(screen.queryByTestId("season-driver-adjustment-team")).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "Tabelle" }));
  await fireEvent.press(screen.getByTestId("season-table-scope-teams"));
  expect(screen.queryByTestId("season-table-driver-adjustment")).toBeNull();
  expect(screen.queryByTestId("series-adjustments")).toBeNull();
});
