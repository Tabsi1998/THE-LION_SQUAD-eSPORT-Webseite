import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TeamDetailScreen } from "./TeamDetailScreen";

// Teamseite (#2173, Web: TeamsPage.jsx #2425, #2215): Reiter „Übersicht“ und „Trophäen“, Titel und Embleme neben dem Namen, Teambanner,
// Rankingbanner und Platz in der Gesamtwertung. Ohne die neuen Felder (ältere Server) bleibt die Seite wie bisher. Erfundene Namen.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
jest.mock("../../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (url: string) => url,
}));
const LEADER = { id: "u-1", username: "paula" };
const VISITOR = { id: "u-2", username: "gast" };
const mockAuth: { user: Record<string, unknown> } = { user: LEADER };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: jest.fn(), navigateToUrl: jest.fn(() => true) }));
jest.mock("../../seasons/anchors", () => ({ useSeasonOverlay: () => null, SeasonPerch: () => null, SeasonAnchor: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

const navigation = { navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn(), goBack: jest.fn(), canGoBack: () => true } as never;
const route = (params: Record<string, unknown> = {}) => ({ key: "team", name: "TeamDetail", params: { id: "t1", ...params } }) as never;

const emblem = (id: string, name: string) => ({
  id, kind: "trophy", rank: 1, rank_label: "1. Platz", date: "2026-11-12T20:00:00Z", tournament: { id: "staffel", title: "CoD-Liga · Season 1" },
  reward: { kind: "emblem", name, art: { season: "Season 1", metal: "gold" } },
});
const cup = { id: "c1", kind: "trophy", rank: 1, rank_label: "1. Platz", date: "2026-03-14T18:00:00Z", tournament: { id: "x", slug: "herbst", title: "Herbst-Cup" } };
const BASE = { id: "t1", name: "Lions", tag: "TLS", members: [], member_ids: ["u-1"], is_member: true, leader_id: "u-1" };
const FULL = {
  ...BASE,
  awards: [cup, emblem("e1", "Wappen"), emblem("e2", "Schild")],
  featured_award: cup,
  featured_emblems: [emblem("e1", "Wappen")],
  rank_banners: [{ key: "s1", league: "CoD-Liga", season: "Season 1", name: "Lions", division: "Liga 1", image_url: "/api/leagues/cod/season-1/teams/q1/banner.png" }],
  league_overall: [{ league_name: "CoD-Liga", period_name: "2027", division_label: "Liga 1", level: 1, place: 2, of: 6, points: 14, closed: false, complete: false, url: null, name: "Lions" }],
};

function serve(team: Record<string, unknown>) {
  mockGet.mockImplementation((path: string) => {
    if (path.endsWith("/squads")) return Promise.resolve({ data: [] });
    if (path.endsWith("/overview") || path.endsWith("/level")) return Promise.resolve({ data: null });
    if (path === "/me/league-applications") return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: team });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = LEADER;
  mockPost.mockResolvedValue({ data: {} });
  mockPut.mockResolvedValue({ data: {} });
  mockDelete.mockResolvedValue({ data: {} });
});

test("Teamleitung: Reiter Trophäen mit Vitrine; Embleme wählen geht über PUT /teams/{id}/awards/emblems", async () => {
  serve(FULL);
  await render(<TeamDetailScreen navigation={navigation} route={route()} />);
  await waitFor(() => expect(screen.getByTestId("team-featured-emblems")).toBeTruthy());
  expect(screen.getByTestId("team-featured-emblems").props.accessibilityLabel).toBe("Embleme: Wappen");
  // Übersicht: Gesamtwertung und Rankingbanner, die Vitrine erst im Reiter.
  expect(screen.getByTestId("team-league-overall")).toBeTruthy();
  expect(screen.getByTestId("team-rank-banners")).toBeTruthy();
  expect(screen.queryByTestId("team-trophies")).toBeNull();
  await fireEvent.press(screen.getByText("Trophäen (3)"));
  expect(screen.getByTestId("team-trophies")).toBeTruthy();
  expect(screen.queryByTestId("team-rank-banners")).toBeNull();
  expect(screen.getByTestId("trophy-banner-c1")).toHaveTextContent("Banner ✓");
  await fireEvent.press(screen.getByTestId("trophy-emblem-e2"));
  await waitFor(() => expect(mockPut).toHaveBeenCalledWith("/teams/t1/awards/emblems", { award_ids: ["e1", "e2"] }));
  await waitFor(() => expect(screen.getByText("Embleme gespeichert.")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("trophy-banner-c1"));
  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("/teams/t1/awards/feature"));
});

test("Kennungen kommen kodiert in den Pfad (idSegment)", async () => {
  serve({ ...FULL, id: "löwen team", awards: [{ ...cup, id: "c 1" }], featured_award: null });
  await render(<TeamDetailScreen navigation={navigation} route={route({ id: "löwen team", tab: "trophies" })} />);
  await waitFor(() => expect(screen.getByTestId("trophy-banner-c 1")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("trophy-banner-c 1"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/teams/l%C3%B6wen%20team/awards/c%201/feature"));
});

test("Doppeltipp schickt eine Wahl nur einmal", async () => {
  serve(FULL);
  let finish: (value: unknown) => void = () => undefined;
  mockPut.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(<TeamDetailScreen navigation={navigation} route={route({ tab: "trophies" })} />);
  await waitFor(() => expect(screen.getByTestId("team-trophies")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("trophy-emblem-e2"));
  await fireEvent.press(screen.getByTestId("trophy-emblem-e2"));
  expect(mockPut).toHaveBeenCalledTimes(1);
  finish({ data: {} });
  await waitFor(() => expect(screen.getByTestId("trophy-emblem-e2").props.accessibilityState).toEqual(expect.objectContaining({ busy: false })));
});

test("Besucher: Reiter nur mit Inhalt, ohne Knöpfe zum Wählen", async () => {
  mockAuth.user = VISITOR;
  serve({ ...FULL, member_ids: [], is_member: false });
  await render(<TeamDetailScreen navigation={navigation} route={route({ tab: "trophies" })} />);
  await waitFor(() => expect(screen.getByTestId("team-trophies")).toBeTruthy());
  expect(screen.queryByTestId("trophy-banner-c1")).toBeNull();
  expect(screen.queryByTestId("trophy-emblem-e2")).toBeNull();
  serve({ ...BASE, member_ids: [], is_member: false, awards: [] });
  await render(<TeamDetailScreen navigation={navigation} route={route({ id: "t2" })} />);
  await waitFor(() => expect(screen.getByText("Lions")).toBeTruthy());
  expect(screen.queryByText(/^Trophäen/)).toBeNull();
});

test("ohne die neuen Felder (älterer Server) wie bisher: keine Embleme, kein Teambanner, keine Gesamtwertung, keine Rankingbanner", async () => {
  mockAuth.user = VISITOR;
  serve({ ...BASE, member_ids: [], is_member: false });
  await render(<TeamDetailScreen navigation={navigation} route={route()} />);
  await waitFor(() => expect(screen.getByText("Team-Chat öffnen")).toBeTruthy());
  expect(screen.queryByTestId("team-featured")).toBeNull();
  expect(screen.queryByTestId("team-featured-emblems")).toBeNull();
  expect(screen.queryByTestId("team-league-overall")).toBeNull();
  expect(screen.queryByTestId("team-rank-banners")).toBeNull();
  expect(screen.queryByText(/^Trophäen/)).toBeNull();
  expect(screen.queryByTestId("team-trophies")).toBeNull();
});
