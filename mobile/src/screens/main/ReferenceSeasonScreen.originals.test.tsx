import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ReferenceSeasonScreen } from "./ReferenceSeasonScreen";

// Original-Bilder des Veranstalters (#1933) auf der Saison: im Kalender je Runde (alle Läufe, mit Lauf beschriftet) und
// an der Spieltag-Karte der Team-Liga. Ein älterer Server schickt `originals` nicht - dann gibt es keinen Knopf.
// Erfundene Namen.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (url: string) => url,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn(), push: jest.fn(), setOptions: jest.fn() } as never;
const routeFor = (lineage: string, season: string) => ({ key: "season", name: "ReferenceSeason", params: { lineage, season } }) as never;
const pic = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, url: `/api/reference-series/public/prl/2026/originals/${id}`, width: 1200, height: 800, ...extra });

const lauf = (id: string, session: string | null, kind: string, extra: Record<string, unknown> = {}) => ({
  id, code: "R3", session, session_kind: kind, weekend: 3, club_day: "2026-10-08", state: "scored", kind: "regular", counts: kind !== "qualifying", venue: "Baku", ...extra,
});
const RACING = {
  lineage: { title: "Probe Racing League", slug: "prl", kind: "racing" },
  series: { season: "2026", title: "PRL 35 · Season 2026", season_slug: "2026" },
  rounds: [lauf("q3", "Qualifying", "qualifying"), lauf("s3", "Sprint", "sprint"), lauf("r3", "Rennen", "race"), { id: "r4", code: "R4", venue: "Monza", club_day: "2026-10-15", state: "planned", kind: "regular" }],
  standings: { rows: [] },
  racing: { club_drivers: [], club_teams: [], drivers: {}, teams: { rows: [] } },
};

const fetchMock = jest.fn(async () => ({ ok: true, text: async () => "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 3 2\"/>" }));

beforeEach(() => {
  jest.clearAllMocks();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

test("Kalender: „Original ansehen“ je Runde mit allen Läufen, beschriftet mit Lauf - Runden ohne Bilder ohne Knopf", async () => {
  mockGet.mockResolvedValue({ data: { ...RACING, originals: { q3: [pic("o1", "qualifying")], s3: [pic("o2", "race")], r3: [pic("o3", "scoreboard", { map: 1 })] } } });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByTestId("season-round-originals-q3")).toBeTruthy());
  expect(screen.getByTestId("season-round-originals-q3").props.accessibilityLabel).toBe("Original ansehen, 3 Bilder");
  expect(screen.queryByTestId("season-round-originals-r4")).toBeNull();

  await fireEvent.press(screen.getByTestId("season-round-originals-q3"));
  expect(screen.getByText("R3 · Baku")).toBeTruthy();
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Qualifying");
  await fireEvent.press(screen.getByTestId("original-viewer-next"));
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Sprint · Rennen");
  await fireEvent.press(screen.getByTestId("original-viewer-next"));
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Rennen · Scoreboard · Map 1");
});

test("Team-Liga: „Original ansehen“ an der Spieltag-Karte mit Gegner als Überschrift", async () => {
  mockGet.mockResolvedValue({ data: {
    lineage: { title: "Probe Liga", slug: "pl", kind: "team_league" },
    series: { season: "S3", season_slug: "s3" },
    rounds: [],
    originals: { a: [pic("o9", "scoreboard", { map: 2 })] },
    team_league: {
      matchdays: [
        { round: { id: "a", code: "ST1", club_day: "2026-10-01", state: "scored" }, match: { opponent: "Fremd Adler", home: true, outcome: "win", score_for: 3, score_against: 1, maps: [] } },
        { round: { id: "b", code: "ST2", club_day: "2026-10-08", state: "planned", opponent: "Fremd Bären" }, match: null },
      ],
      table: { rows: [] },
    },
  } });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("pl", "s3")} />);
  await waitFor(() => expect(screen.getByTestId("season-matchday-a")).toBeTruthy());
  const button = within(screen.getByTestId("season-matchday-a")).getByTestId("season-matchday-originals-a");
  expect(button.props.accessibilityLabel).toBe("Original ansehen");
  expect(screen.queryByTestId("season-matchday-originals-b")).toBeNull();
  await fireEvent.press(button);
  expect(screen.getByText("ST1 · gegen Fremd Adler")).toBeTruthy();
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Scoreboard · Map 2");
});

test("älterer Server ohne `originals`: kein Knopf, kein Absturz", async () => {
  mockGet.mockResolvedValue({ data: RACING });
  await render(<ReferenceSeasonScreen navigation={navigation} route={routeFor("prl", "2026")} />);
  await waitFor(() => expect(screen.getByTestId("season-round-q3")).toBeTruthy());
  expect(screen.queryByText("Original ansehen")).toBeNull();
  expect(screen.queryByText(/Original ansehen/)).toBeNull();
});
